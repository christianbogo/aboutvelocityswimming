import "server-only";

import {
  buildTeamMap,
  type TeamMapRosterEntry,
} from "@/components/collection/team-map-data";
import type { Race } from "@/components/collection/times-data";
import type { StandardSet } from "@/features/swim-resources/types/schema";
import { VELOCITY_TEAM_ID } from "@/features/swim-resources/lib/domain/entities";
import type { Database } from "@/lib/supabase/database.types";
import type { serverClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof serverClient>>;
type SwimRow = Omit<
  Database["public"]["Views"]["unflagged_times_swims"]["Row"],
  "data"
>;
type RosterRow = Pick<
  Database["public"]["Tables"]["workshare_athletes"]["Row"],
  "id" | "full_name" | "training_group" | "times_athlete_id"
>;
type StandardRow = Database["public"]["Tables"]["standards"]["Row"];

export interface TeamMapSelection {
  year: number;
  course: "" | "SCY" | "LCM" | "SCM";
  asOf: string;
}

export class TeamMapQueryError extends Error {}

export function parseTeamMapQuery(
  params: URLSearchParams,
  asOf: string,
): TeamMapSelection {
  const currentYear = Number(asOf.slice(0, 4));
  const rawYear = params.get("year") ?? String(currentYear);
  const course = params.get("course") ?? "";
  if (
    !/^\d{4}$/.test(rawYear) ||
    Number(rawYear) < 1900 ||
    Number(rawYear) > currentYear
  )
    throw new TeamMapQueryError(`Choose a year from 1900 to ${currentYear}.`);
  if (!["", "SCY", "LCM", "SCM"].includes(course))
    throw new TeamMapQueryError("Choose SCY, LCM, SCM, or all courses.");
  return {
    year: Number(rawYear),
    course: course as TeamMapSelection["course"],
    asOf,
  };
}

interface Page<T> {
  data: T[] | null;
  error: { message: string; code?: string } | null;
  count: number | null;
}

/** Count every page so a server-side row cap never looks like a complete list. */
async function allPages<T>(
  read: (from: number, to: number) => PromiseLike<Page<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  let total: number | undefined;
  do {
    const { data, error, count } = await read(rows.length, rows.length + 999);
    if (error)
      throw Object.assign(new Error("Team Map data could not be read."), {
        code: error.code,
      });
    if (
      count == null ||
      data == null ||
      !Number.isSafeInteger(count) ||
      count < 0
    )
      throw new Error("Team Map could not confirm complete data coverage.");
    if (total !== undefined && count !== total)
      throw new Error(
        "Team Map data changed during this read. Please refresh.",
      );
    total = count;
    if (!data.length && rows.length < total)
      throw new Error("Team Map returned an incomplete page.");
    rows.push(...data);
    if (rows.length > total)
      throw new Error("Team Map returned inconsistent page counts.");
  } while (rows.length < total);
  return rows;
}

const swimProjection =
  "id,athlete_id,swim_date,times_course,times_event,times_time,times_gender,times_age,times_official,times_meet,times_meet_name,times_status,times_team,times_relay,times_leg,times_split";

function race(row: SwimRow): Race {
  if (!row.id || !row.athlete_id || !row.swim_date)
    throw new Error("A published swim is missing its identity or date.");
  return {
    id: row.id,
    athleteId: row.athlete_id,
    date: row.swim_date,
    event: row.times_event ?? "",
    course: row.times_course ?? "",
    time: row.times_time ?? 0,
    status: row.times_status ?? "",
    round: "",
    team: row.times_team ?? "",
    gender: row.times_gender ?? undefined,
    ageAtSwim: row.times_age,
    official: row.times_official,
    relay: row.times_relay === true,
    relayLeg: row.times_leg,
    split: row.times_split === true,
    meetId: row.times_meet ?? "",
    meet: row.times_meet_name ?? "",
    moderationStatus: "clear",
    calculationEligible: true,
  };
}

/** The caller authenticates staff first. This client retains the user's RLS. */
export async function readTeamMap(
  client: Client,
  selection: TeamMapSelection,
  signal: AbortSignal,
) {
  const [rosterRows, standardRows] = await Promise.all([
    allPages<RosterRow>((from, to) =>
      client
        .from("workshare_athletes")
        .select(
          "id,full_name,training_group,times_athlete_id,workshare_accounts!inner(is_archived)",
          { count: "exact" },
        )
        .eq("is_archived", false)
        .eq("workshare_accounts.is_archived", false)
        .order("id")
        .range(from, to)
        .abortSignal(signal),
    ),
    allPages<StandardRow>((from, to) =>
      client
        .from("standards")
        .select("id,data", { count: "exact" })
        .order("id")
        .range(from, to)
        .abortSignal(signal),
    ),
  ]);
  const roster: TeamMapRosterEntry[] = rosterRows.map((row) => ({
    athleteId: row.times_athlete_id,
    name: row.full_name,
    trainingGroup: row.training_group,
  }));
  const athleteIds = [
    ...new Set(
      rosterRows.flatMap((row) =>
        row.times_athlete_id ? [row.times_athlete_id] : [],
      ),
    ),
  ];
  const batches: string[][] = [];
  for (let start = 0; start < athleteIds.length; start += 50)
    batches.push(athleteIds.slice(start, start + 50));

  const nextDay = new Date(`${selection.asOf}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const before = nextDay.toISOString().slice(0, 10);
  const raceBatches: Race[][] = new Array(batches.length);
  let index = 0;
  async function worker() {
    while (index < batches.length) {
      signal.throwIfAborted();
      const current = index++;
      const rows = await allPages<SwimRow>((from, to) => {
        let query = client
          .from("unflagged_times_swims")
          .select(swimProjection, { count: "exact" })
          .in("athlete_id", batches[current])
          .eq("times_team", VELOCITY_TEAM_ID)
          .eq("times_relay", false)
          .is("times_leg", null)
          .eq("times_split", false)
          .eq("times_status", "OK")
          .gt("times_time", 0)
          .lt("swim_date", before);
        if (selection.course)
          query = query.eq("times_course", selection.course);
        return query.order("id").range(from, to).abortSignal(signal);
      });
      raceBatches[current] = rows.map(race);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(3, batches.length) }, worker),
  );
  const standards = standardRows.map((row) => ({
    ...(row.data as unknown as StandardSet),
    id: row.id,
  }));
  return buildTeamMap({
    ...selection,
    roster,
    races: raceBatches.flat(),
    standards,
  });
}
