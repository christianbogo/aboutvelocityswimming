import "server-only";

import type { Race } from "@/components/collection/times-data";
import type { StandardSet } from "@/features/swim-resources/types/schema";
import type { Database } from "@/lib/supabase/database.types";
import type { serverClient } from "@/lib/supabase/server";
import { buildDraftingSnapshot } from "./data";
import { competitiveTrainingGroups } from "./types";

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

/** Exact totals, stable ordering and short-page handling avoid silently truncated
 * inventories when PostgREST caps a response below the requested page size. */
async function allPages<T extends { id: string | null }>(
  read: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: { message: string; code?: string } | null;
    count: number | null;
  }>,
) {
  const rows: T[] = [];
  const ids = new Set<string>();
  let total: number | undefined;
  do {
    const { data, error, count } = await read(rows.length, rows.length + 999);
    if (error)
      throw Object.assign(new Error("Drafting data could not be read."), {
        code: error.code,
      });
    if (
      count == null ||
      data == null ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      (total !== undefined && count !== total) ||
      (!data.length && rows.length < count)
    )
      throw new Error(
        "Drafting data coverage could not be confirmed. Please refresh.",
      );
    total = count;
    for (const row of data) {
      if (!row.id || ids.has(row.id))
        throw new Error(
          "Drafting data changed during this read. Please refresh.",
        );
      ids.add(row.id);
    }
    rows.push(...data);
    if (rows.length > total)
      throw new Error("Inconsistent drafting data coverage.");
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

/** Caller verifies the owner and staff role. Reads retain that user's RLS. */
export async function readDraftingSnapshot(
  client: Client,
  asOf: string,
  signal: AbortSignal,
) {
  const [roster, standardRows] = await Promise.all([
    allPages<RosterRow>((from, to) =>
      client
        .from("workshare_athletes")
        .select(
          "id,full_name,training_group,times_athlete_id,workshare_accounts!inner(is_archived)",
          { count: "exact" },
        )
        .eq("is_archived", false)
        .eq("workshare_accounts.is_archived", false)
        .in("training_group", [...competitiveTrainingGroups])
        .order("id")
        .range(from, to)
        .abortSignal(signal),
    ),
    allPages<StandardRow>((from, to) =>
      client
        .from("standards")
        .select("id,data", { count: "exact" })
        .eq("data->>category", "motivational")
        .order("id")
        .range(from, to)
        .abortSignal(signal),
    ),
  ]);
  const athleteIds = [
    ...new Set(
      roster.flatMap((entry) =>
        entry.times_athlete_id ? [entry.times_athlete_id] : [],
      ),
    ),
  ];
  const batches: string[][] = [];
  for (let start = 0; start < athleteIds.length; start += 50)
    batches.push(athleteIds.slice(start, start + 50));
  const nextDay = new Date(`${asOf}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const before = nextDay.toISOString().slice(0, 10);
  const raceBatches: Race[][] = new Array(batches.length);
  let index = 0;
  async function worker() {
    while (index < batches.length) {
      signal.throwIfAborted();
      const current = index++;
      const rows = await allPages<SwimRow>((from, to) =>
        client
          .from("unflagged_times_swims")
          .select(swimProjection, { count: "exact" })
          .in("athlete_id", batches[current])
          .eq("times_relay", false)
          .is("times_leg", null)
          .eq("times_split", false)
          .eq("times_status", "OK")
          .gt("times_time", 0)
          .lt("swim_date", before)
          .order("id")
          .range(from, to)
          .abortSignal(signal),
      );
      raceBatches[current] = rows.map(race);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(3, batches.length) }, worker),
  );
  signal.throwIfAborted();
  return buildDraftingSnapshot({
    asOf,
    roster: roster.map((entry) => ({
      id: entry.id,
      athleteId: entry.times_athlete_id,
      name: entry.full_name,
      trainingGroup: entry.training_group,
    })),
    races: raceBatches.flat(),
    standards: standardRows.map((row) => ({
      ...(row.data as unknown as StandardSet),
      id: row.id,
    })),
  });
}
