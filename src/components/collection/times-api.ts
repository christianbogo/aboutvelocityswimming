import { VELOCITY_TEAM_ID } from "@/features/swim-resources/lib/domain/entities";
import { timesAgeGroups, type Race } from "./times-data";
export const timesKinds = [
  "facets",
  "rankings",
  "ranking_years",
  "analysis",
  "race",
  "records",
  "records_board",
  "my_times",
  "my_times_bests",
] as const;
export type TimesKind = (typeof timesKinds)[number];
export interface MyTimesEvent {
  event: string;
  race: Race | null;
  rankRace: Race | null;
  allTimeRank: number | null;
  allTimeCount: number;
  rankAgeGroup: string | null;
  rankGender: string | null;
}
export interface MyTimesResponse {
  period: "all";
  athleteId: string;
  ages: number[];
  years: string[];
  /** Age at the latest unflagged individual swim; no date of birth is inferred. */
  latestAge: number | null;
  latestAgeGroup: string | null;
  events: MyTimesEvent[];
}
/** Retained for clients opened before the all-time ranking update. */
export interface LegacyMyTimesEvent {
  event: string;
  race: Race | null;
  seasonRace: Race | null;
  seasonRank: number | null;
  seasonCount: number;
  rankAgeGroup: string | null;
  rankGender: string | null;
}
export interface LegacyMyTimesResponse {
  period?: "season";
  athleteId: string;
  ages: number[];
  years: string[];
  seasonStart: string;
  seasonEnd: string;
  seasonLabel: string;
  /** Age at the latest unflagged individual swim; no date of birth is inferred. */
  seasonAge: number | null;
  seasonAgeGroup: string | null;
  events: LegacyMyTimesEvent[];
}
export interface TimesResponse {
  myTimes?: MyTimesResponse | LegacyMyTimesResponse;
  personalBests?: { event: string; race: Race }[];
  expiresAt: number;
  rows?: { race: Race; rank?: number }[];
  total?: number;
  events?: string[];
  years?: string[];
  relayAges?: string[];
  relayEvents?: string[];
  count?: number;
  races?: Race[];
  records?: Record<string, string[]>;
  recordsUpdatedAt?: string | null;
  stats?: {
    value: number;
    faster: number;
    tied: number;
    slower: number;
    count: number;
    rank: number;
  } | null;
}
export type TimesInput = Record<
  string,
  string | number | boolean | string[] | undefined
>;
export function timesUrl(kind: TimesKind, input: TimesInput = {}) {
  const params = new URLSearchParams({ view: kind });
  for (const key of Object.keys(input).sort()) {
    const value = input[key];
    if (key !== "team" && value !== undefined)
      params.set(
        key,
        Array.isArray(value) ? [...value].sort().join(",") : String(value),
      );
  }
  return "/api/times?" + params;
}
/** Only known fields enter cache keys or the parameterized database call. */
export function parseTimesQuery(params: URLSearchParams): {
  kind: TimesKind;
  input: TimesInput;
} {
  const kind = params.get("view") as TimesKind;
  if (!timesKinds.includes(kind)) throw new Error("Choose a valid times view.");
  const input: TimesInput = { team: VELOCITY_TEAM_ID };
  for (const key of [
    "course",
    "event",
    "year",
    "round",
    "official",
    "mode",
    "search",
    "athleteId",
    "raceId",
    "basis",
    "startDate",
    "endDate",
    "startYear",
    "endYear",
    "rankPeriod",
    "ageGroup",
  ]) {
    const value = params.get(key);
    if (value !== null) {
      if (value.length > (key === "search" ? 100 : 200))
        throw new Error("Filter is too long.");
      input[key] = key === "search" ? value.trim().toLowerCase() : value.trim();
    }
  }
  for (const [key, allowed] of Object.entries({
    course: ["", "SCY", "LCM", "SCM"],
    official: ["", "official", "unofficial"],
    mode: ["bests", "performances", "recent"],
    basis: ["bests", "swims"],
    round: ["", "F", "P", "S", "TT"],
    rankPeriod: ["all", "season"],
  })) {
    if (input[key] !== undefined && !allowed.includes(String(input[key])))
      throw new Error("Invalid " + key + ".");
  }
  for (const key of ["genders", "ageGroups"]) {
    if (params.has(key)) {
      const values = [
        ...new Set((params.get(key) || "").split(",").filter(Boolean)),
      ].sort();
      if (
        values.length > 20 ||
        values.some((v) => v.length > 30) ||
        (key === "genders" &&
          (!values.length || values.some((v) => !["F", "M", "X"].includes(v))))
      )
        throw new Error("Invalid " + key + ".");
      input[key] = values;
    }
  }
  for (const [key, fallback] of [
    ["offset", 0],
    ["limit", 25],
  ] as const) {
    const raw = params.get(key);
    const value = raw === null ? fallback : Number(raw);
    if (
      !Number.isSafeInteger(value) ||
      value < (key === "limit" ? 1 : 0) ||
      value > (key === "limit" ? 100 : 1000000)
    )
      throw new Error("Invalid pagination.");
    input[key] = value;
  }
  if (params.has("relay")) {
    if (!["true", "false"].includes(params.get("relay")!))
      throw new Error("Invalid relay filter.");
    input.relay = params.get("relay") === "true";
  }
  if (input.year && !/^\d{4}$/.test(String(input.year)))
    throw new Error("Invalid year.");
  for (const key of ["startDate", "endDate"]) {
    const value = input[key];
    if (!value) continue;
    const date = String(value);
    const parsed = new Date(date);
    if (
      !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date
    )
      throw new Error("Invalid date range.");
  }
  if (input.startDate && input.endDate && input.startDate > input.endDate)
    throw new Error("The start date must come before the end date.");
  const yearPattern =
    kind === "my_times_bests" ? /^[1-9]\d{3}$/ : /^(?!0000)\d{4}$/;
  for (const key of ["startYear", "endYear"]) {
    if (input[key] && !yearPattern.test(String(input[key])))
      throw new Error("Invalid year range.");
  }
  if (input.startYear && input.endYear && input.startYear > input.endYear)
    throw new Error("The start year must come before the end year.");
  if (kind === "my_times" || kind === "my_times_bests") {
    input.course ||= "SCY";
    if (
      input.ageGroup &&
      !timesAgeGroups.some(([key]) => key === input.ageGroup)
    )
      throw new Error("Invalid age group.");
    if (input.ageGroup && (kind !== "my_times" || input.rankPeriod !== "all"))
      throw new Error("Age ranges require all-time personal bests.");
    if (
      input.ageGroup &&
      (input.startYear || input.endYear || params.get("ageAtSwim"))
    )
      throw new Error("Choose an age range or a year range.");
    const rawAge = params.get("ageAtSwim");
    if (rawAge !== null && rawAge !== "") {
      if (!/^\d{1,3}$/.test(rawAge) || Number(rawAge) > 120)
        throw new Error("Invalid age at swim.");
      if (input.startYear || input.endYear)
        throw new Error("Choose an age or a year range.");
      input.ageAtSwim = Number(rawAge);
    }
  }
  if (
    kind === "my_times_bests" &&
    input.ageAtSwim === undefined &&
    (!input.startYear || !input.endYear)
  )
    throw new Error("Choose an age or both years.");
  if (kind === "rankings") {
    input.genders ??= ["F"];
    input.mode ??= "bests";
  }
  const required: Partial<Record<TimesKind, string[]>> = {
    analysis: ["raceId"],
    my_times: ["athleteId"],
    my_times_bests: ["athleteId"],
    race: ["raceId"],
  };
  if (required[kind]?.some((key) => !input[key]))
    throw new Error("Select a " + required[kind]!.join(" and ") + ".");
  return { kind, input };
}
