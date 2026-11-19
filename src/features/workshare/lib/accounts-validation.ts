export interface WorkshareAthleteInput {
  id?: string;
  fullName: string;
  trainingGroup: string;
  timesAthleteId: string | null;
  isArchived: boolean;
}

export interface WorkshareAccountInput {
  id?: string;
  fullName: string;
  emails: string[];
  athletes: WorkshareAthleteInput[];
  requireWorkshare?: boolean;
  workshareNote?: string;
  currentSeason: string | null;
  generalHoursRequired: number | null;
  starlightHoursRequired: number | null;
  appleCapitalHoursRequired: number | null;
  isArchived: boolean;
  updatedAt?: string;
}

export class AccountValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountValidationError";
  }
}

function fail(message: string): never {
  throw new AccountValidationError(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function knownFields(value: Record<string, unknown>, allowed: string[], label: string) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) fail(`${label} has an unknown field: ${unknown}.`);
}

function text(value: unknown, label: string, limit: number, required = false): string {
  if (typeof value !== "string") fail(`${label} must be text.`);
  const trimmed = value.trim();
  if (required && !trimmed) fail(`${label} is required.`);
  if (trimmed.length > limit) fail(`${label} must be ${limit} characters or fewer.`);
  return trimmed;
}

function identifier(value: unknown, label: string): string {
  return text(value, label, 1500, true);
}

function archived(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label} must be true or false.`);
  return value;
}

function hours(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)
    || value < 0 || value > 10000 || Number(value.toFixed(2)) !== value)
    fail(`${label} must be blank or a number from 0 to 10,000 with at most two decimal places.`);
  return value;
}

function parseAthlete(value: unknown, index: number): WorkshareAthleteInput {
  const label = `Athlete ${index + 1}`;
  const athlete = record(value, label);
  knownFields(athlete, ["id", "fullName", "trainingGroup", "timesAthleteId", "isArchived"], label);
  return {
    ...(athlete.id === undefined ? {} : { id: identifier(athlete.id, `${label} ID`) }),
    fullName: text(athlete.fullName, `${label} full name`, 200, true),
    trainingGroup: text(athlete.trainingGroup, `${label} training group`, 100),
    timesAthleteId: athlete.timesAthleteId === null
      ? null : identifier(athlete.timesAthleteId, `${label} Times athlete ID`),
    isArchived: archived(athlete.isArchived, `${label} archived status`),
  };
}

/** A complete account write. Updates require the exact version returned by the API. */
export function parseAccount(
  value: unknown,
  mode: "create" | "update" = "create",
): WorkshareAccountInput {
  const account = record(value, "Account");
  knownFields(account, [
    "id", "fullName", "emails", "athletes", "currentSeason", "generalHoursRequired",
    "starlightHoursRequired", "appleCapitalHoursRequired", "isArchived", "updatedAt", "requireWorkshare", "workshareNote",
  ], "Account");

  let version: { id?: string; updatedAt?: string } = {};
  if (mode === "create") {
    if (account.id !== undefined || account.updatedAt !== undefined)
      fail("New accounts must omit id and updatedAt.");
  } else {
    const id = identifier(account.id, "Account ID");
    const updatedAt = text(account.updatedAt, "Account version", 100, true);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(updatedAt)
      || !Number.isFinite(Date.parse(updatedAt)))
      fail("Account version must be the timestamp returned by the API.");
    version = { id, updatedAt };
  }

  if (!Array.isArray(account.emails) || account.emails.length > 100)
    fail("Emails must be a list of at most 100 email addresses.");
  const emails = [...new Set(account.emails.map((value, index) => {
    const email = text(value, `Email ${index + 1}`, 254, true).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      fail(`Email ${index + 1} must be a valid email address.`);
    return email;
  }))];

  if (!Array.isArray(account.athletes) || account.athletes.length > 100)
    fail("Athletes must be a list of at most 100 athletes.");
  const athletes = account.athletes.map(parseAthlete);
  const ids = athletes.flatMap((athlete) => athlete.id ? [athlete.id] : []);
  if (new Set(ids).size !== ids.length) fail("An athlete ID cannot appear more than once in an account.");
  if (mode === "create" && ids.length) fail("New athletes must omit id.");

  const currentSeason = account.currentSeason === null
    ? null : text(account.currentSeason, "Current season", 100) || null;
  return {
    ...version,
    fullName: text(account.fullName, "Account full name", 200, true),
    emails,
    athletes,
    ...(account.requireWorkshare === undefined ? {} : { requireWorkshare: archived(account.requireWorkshare, "Require Workshare") }),
    ...(account.workshareNote === undefined ? {} : { workshareNote: text(account.workshareNote, "Note to Account", 2000) }),
    currentSeason,
    generalHoursRequired: hours(account.generalHoursRequired, "General hours required"),
    starlightHoursRequired: hours(account.starlightHoursRequired, "Starlight hours required"),
    appleCapitalHoursRequired: hours(account.appleCapitalHoursRequired, "Apple Capital hours required"),
    isArchived: archived(account.isArchived, "Account archived status"),
  };
}

/** Core edits deliberately omit season quotas and computed ticket totals. */
export function parseAccountWrite(value: unknown, mode: "create" | "update") {
  const account = record(value, "Account");
  const legacy = ["currentSeason", "generalHoursRequired", "starlightHoursRequired", "appleCapitalHoursRequired"];
  if (legacy.some((field) => Object.hasOwn(account, field))) return parseAccount(value, mode);
  const parsed = parseAccount({
    ...account,
    currentSeason: null,
    generalHoursRequired: null,
    starlightHoursRequired: null,
    appleCapitalHoursRequired: null,
  }, mode);
  return Object.fromEntries(Object.entries(parsed).filter(([field]) => !legacy.includes(field)));
}
