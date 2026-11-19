export type RecordKind = "swim" | "relay" | "athlete" | "meet" | "standard";
export type DataRecord = Record<string, unknown>;
export const recordCollections = {
  swim: "swims",
  relay: "relay_results",
  athlete: "athletes",
  meet: "meets",
  standard: "standards",
} as const;
export const recordKinds = Object.keys(recordCollections) as RecordKind[];
export type Course = "SCY" | "SCM" | "LCM";
export type Round = "F" | "P" | "S" | "TT";
export interface FileAthlete {
  first: string;
  last: string;
  gender: string;
  dob?: string;
  memberHash?: string;
}
export interface FileMeet {
  name: string;
  startsOn: string;
  endsOn: string;
}
export interface FileSource {
  filename: string;
  sha256: string;
  line: number;
  format: "hy3" | "cl2" | "sd3";
  companion?: { filename: string; sha256: string; line: number };
}
export interface FileResult {
  kind: "swim" | "relay";
  source: FileSource;
  meet: FileMeet;
  team: { clubCode: string; lscCode: string; name: string };
  athlete?: FileAthlete;
  members?: Array<{ leg: number; athlete: FileAthlete; timeMs?: number }>;
  eventNumber: string;
  distance: number;
  stroke: string;
  course: Course;
  gender: string;
  date: string;
  round: Round;
  status: string;
  timeMs: number;
  ageAtSwim?: number;
  ageGroup?: string;
  relayName?: string;
  splits: Array<{ distance: number; cumulativeMs: number; lapMs?: number }>;
  splitCoverage: "complete" | "partial" | "unavailable";
  issue?: string;
}
export interface ImportOutcome {
  filename: string;
  line: number;
  status: "saved" | "duplicate" | "skipped" | "error";
  message: string;
  id?: string;
}
export interface ParsedFile {
  rows: FileResult[];
  issues: ImportOutcome[];
}
export interface ManagedRecord {
  id: string;
  data: DataRecord;
  version: string;
}
