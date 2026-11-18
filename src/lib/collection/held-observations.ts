import type { Json } from "@/lib/supabase/database.types";

export const heldObservationsHref = "/tools/review/held-observations";
export const heldObservationPageSize = 40;
export const heldObservationStatuses = {
  held: "Still held",
  ready: "Ready to stage",
  published: "Already published",
  pending: "Awaiting approval",
  accepted: "Accepted source only",
  outcome: "Source outcome",
} as const;

export type HeldStatus = keyof typeof heldObservationStatuses;
export type HeldView = "observations" | "identity" | "event";
export type HeldFacts = { [key: string]: Json | undefined };

export type HeldObservation = {
  id: string;
  sourceMeetId: string;
  workbookSha256: string;
  kind: "swim" | "relay";
  sourceRow: number;
  round: string;
  clubCode: string;
  holdReason: string;
  sourceStatus: string | null;
  memberIdHash: string | null;
  sourceUrl: string;
  capturedAt: string;
  observed: HeldFacts;
  status: HeldStatus;
  blocker: string | null;
  recordId: string | null;
  reviewBatchId: string | null;
};

export type HeldGroup = {
  label: string | null;
  count: number;
  anchorId: string;
  memberIdHash?: string | null;
  sourceMeetId?: string | null;
  workbookSha256?: string | null;
  eventCode?: string | null;
  round?: string | null;
};

export type HeldList = {
  rows: HeldObservation[];
  groups: HeldGroup[];
  counts: Record<HeldStatus, number>;
  total: number;
  hasNext: boolean;
};

export type HeldDecision = {
  id: string;
  scope: "row" | "identity" | "source";
  reason: string;
  evidenceUrl: string;
  createdAt: string;
  reviewerId: string | null;
  athleteId?: string | null;
  affected?: number;
  patch?: HeldFacts;
};

export type HeldDetail = HeldObservation & {
  current: HeldFacts | null;
  candidate: HeldFacts | null;
  decisions: HeldDecision[];
};

export type HeldAthlete = { id: string; label: string; category: string | null };

export type HeldChecked = Record<Exclude<HeldStatus, "accepted">, number> & {
  checked: number;
  hasNext: boolean;
  afterId: string | null;
};

export type HeldReceipt = {
  staged: number;
  duplicates: number;
  blocked: number;
  batchIds: string[];
  correctionBatchIds: string[];
};

export type HeldSwimmerApproval = {
  requestId: string;
  total: number;
  checked: number;
  approved: number;
  alreadyRecorded: number;
  stillHeld: number;
  outcomes: number;
  done: boolean;
};

export type HeldArchiveReceipt = {
  total: number;
  accepted: number;
  published: number;
  alreadyRecorded: number;
  sourceOnly: number;
  completed: boolean;
  publishedThisChunk?: number;
  hasUnaccepted?: boolean;
};

export function heldArchiveReceipt(value: unknown): HeldArchiveReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { total, accepted, published, alreadyRecorded, sourceOnly, completed, publishedThisChunk, hasUnaccepted } = value as Record<string, unknown>;
  const count = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  if (!count(total) || !count(accepted) || !count(published) || !count(alreadyRecorded) || !count(sourceOnly) ||
    typeof completed !== "boolean" || (publishedThisChunk !== undefined && !count(publishedThisChunk)) ||
    (hasUnaccepted !== undefined && typeof hasUnaccepted !== "boolean") ||
    accepted > total || published + alreadyRecorded + sourceOnly !== accepted || (completed && accepted !== total)) return null;
  return { total, accepted, published, alreadyRecorded, sourceOnly, completed, publishedThisChunk, hasUnaccepted };
}

export function heldText(value: Json | undefined) {
  return typeof value === "string" ? value : "";
}

export function heldFacts(value: Json | undefined): HeldFacts {
  return value && !Array.isArray(value) && typeof value === "object" ? value : {};
}

export function heldObservationLabel(row: HeldObservation) {
  return heldText(row.observed.name) || heldText(row.observed.relayName) || "Unnamed result";
}

export function heldObservationLink(params: URLSearchParams, changes: Record<string, string | null>) {
  const next = new URLSearchParams(params);
  for (const [name, value] of Object.entries(changes)) {
    if (value) next.set(name, value);
    else next.delete(name);
  }
  return next.size ? `${heldObservationsHref}?${next}` : heldObservationsHref;
}

export const heldUuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const heldRecordId = /^[A-Za-z0-9_-]{1,180}$/;

export function heldEvidenceLink(value: string) {
  const url = URL.parse(value);
  return url?.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
}
