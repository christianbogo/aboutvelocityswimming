import type { Json } from "@/lib/supabase/database.types";

export const MEET_QUEUE_PAGE_SIZE = 30;
export const IMPORT_STATES = ["not_started", "prepared", "partially_approved", "complete"] as const;
export const MEET_CATEGORIES = ["sanctioned", "approved", "observed", "unknown"] as const;
export type AcquisitionState = "unchecked" | "available" | "downloaded" | "unavailable";
export type MeetImportState = typeof IMPORT_STATES[number];
export type MeetCategory = typeof MEET_CATEGORIES[number];
export type ParticipationCoverage = "unknown" | "partial" | "complete";
export type IesParticipation = "confirmed" | "unknown" | "none";
export interface MeetParticipantEvidence {
  sourceUrl: string;
  sha256?: string;
  member?: string;
  line?: number;
  kind?: string;
  status?: string;
}
export interface MeetParticipant {
  id: string;
  name: string;
  clubCode: string;
  lscCode: string;
  catalogTeamId?: string;
  operationalTeamId?: string;
  basis: "planned" | "entered" | "recorded";
  representation: "club" | "school" | "unattached";
  evidence: MeetParticipantEvidence[];
}
export interface MeetQueueRow {
  id: string;
  title: string;
  startsOn: string | null;
  endsOn: string | null;
  sourceUrl: string;
  data: Record<string, Json | undefined>;
  participants: MeetParticipant[];
  teamCoverage: ParticipationCoverage;
  iesParticipation: IesParticipation;
  selected: boolean;
  priority: number;
  blockers: string[];
  acquisitionState: AcquisitionState;
  importState: MeetImportState;
  importedSwims: number;
}
export interface MeetQueueResponse {
  rows: MeetQueueRow[];
  total: number;
  hasNext: boolean;
  facets: { years: number[]; teams: { id: string; name: string }[] };
}
export interface MeetQueueQuery {
  search: string;
  year: number | null;
  team: string;
  ies: IesParticipation | "";
  category: MeetCategory | "";
  selected: boolean | null;
  progress: MeetImportState | "blocked" | "";
  offset: number;
}
const safeId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
function choice<T extends string>(value: string, choices: readonly T[], label: string): T | "" {
  if (!value) return "";
  if (!choices.includes(value as T)) throw new Error(`Invalid ${label}.`);
  return value as T;
}
export function parseMeetQueueQuery(params: URLSearchParams): MeetQueueQuery {
  const search = (params.get("search") ?? "").trim();
  if (search.length > 200) throw new Error("Search must be 200 characters or fewer.");
  const yearValue = params.get("year") ?? "";
  if (yearValue && (!/^\d{4}$/.test(yearValue) || Number(yearValue) < 1900 || Number(yearValue) > 2200)) throw new Error("Invalid meet year.");
  const offsetValue = params.get("offset") ?? "0";
  if (!/^\d+$/.test(offsetValue) || Number(offsetValue) > 1000000) throw new Error("Invalid page offset.");
  const team = params.get("team") ?? "";
  if (team && !safeId(team)) throw new Error("Invalid team.");
  const selectedValue = params.get("selected") ?? "";
  if (selectedValue && !["true", "false"].includes(selectedValue)) throw new Error("Invalid selection filter.");
  return {
    search, year: yearValue ? Number(yearValue) : null, team,
    ies: choice(params.get("ies") ?? "", ["confirmed", "unknown", "none"], "IES participation filter"),
    category: choice(params.get("category") ?? "", MEET_CATEGORIES, "meet category"),
    selected: selectedValue ? selectedValue === "true" : null,
    progress: choice(params.get("progress") ?? "", [...IMPORT_STATES, "blocked"], "progress filter"),
    offset: Number(offsetValue),
  };
}
