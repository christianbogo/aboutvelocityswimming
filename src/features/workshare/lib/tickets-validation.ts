import { AccountValidationError } from "./accounts-validation";

export const ticketCategories = ["general", "starlight", "apple_capital"] as const;
type TicketCategory = (typeof ticketCategories)[number];

function fail(message: string): never { throw new AccountValidationError(message); }
function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Send a JSON object.");
  const input = value as Record<string, unknown>;
  const unknown = Object.keys(input).find((field) => !fields.includes(field));
  if (unknown) fail(`Unsupported field: ${unknown}.`);
  return input;
}
function text(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    fail(`${label} must contain 1 to ${max} characters.`);
  return value.trim();
}
export function parseWorkshareId(value: unknown, label = "ID") {
  const id = text(value, label, 36).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) fail(`${label} must be a UUID.`);
  return id;
}
export function parseWorkshareDate(value: unknown, label = "Date") {
  const date = text(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000")
    || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
    fail(`${label} must be a valid date in YYYY-MM-DD format.`);
  return date;
}
function version(value: unknown) {
  const timestamp = text(value, "Version", 100);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)
    || !Number.isFinite(Date.parse(timestamp))) fail("Use the exact version returned by the API.");
  return timestamp;
}
function category(value: unknown): TicketCategory {
  if (!ticketCategories.includes(value as TicketCategory)) fail("Select General, Starlight, or Apple Capital.");
  return value as TicketCategory;
}
function hours(value: unknown, allowNull: boolean) {
  if (allowNull && value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value > 10000
    || value < 0 || (!allowNull && value === 0) || Number(value.toFixed(2)) !== value)
    fail(allowNull ? "Required hours must be blank or 0 to 10,000 with at most two decimal places."
      : "Ticket hours must be greater than 0 and at most 10,000 with at most two decimal places.");
  return value;
}
export function parseSeasonCreate(value: unknown) {
  const input = object(value, ["id", "name", "startsOn", "endsOn", "copyFromSeasonId"]);
  const startsOn = parseWorkshareDate(input.startsOn, "Season start");
  const endsOn = parseWorkshareDate(input.endsOn, "Season end");
  if (startsOn > endsOn) fail("Season end must be on or after its start.");
  return { id: parseWorkshareId(input.id), name: text(input.name, "Season name", 100), startsOn, endsOn,
    copyFromSeasonId: input.copyFromSeasonId === null ? null : parseWorkshareId(input.copyFromSeasonId, "Source season") };
}
export function parseRequirements(value: unknown) {
  const input = object(value, ["seasonId", "updatedAt", "generalHoursRequired", "starlightHoursRequired", "appleCapitalHoursRequired"]);
  return { seasonId: parseWorkshareId(input.seasonId, "Season"), updatedAt: input.updatedAt === null ? null : version(input.updatedAt),
    generalHoursRequired: hours(input.generalHoursRequired, true), starlightHoursRequired: hours(input.starlightHoursRequired, true),
    appleCapitalHoursRequired: hours(input.appleCapitalHoursRequired, true) };
}
function ticketFields(input: Record<string, unknown>) {
  return { completedOn: parseWorkshareDate(input.completedOn, "Ticket date"), description: text(input.description, "Description", 500),
    category: category(input.category), hours: hours(input.hours, false) };
}
export function parseTicketCreate(value: unknown) {
  const input = object(value, ["id", "accountId", "seasonId", "completedOn", "description", "category", "hours"]);
  return { id: parseWorkshareId(input.id), accountId: text(input.accountId, "Account", 1500), seasonId: parseWorkshareId(input.seasonId, "Season"), ...ticketFields(input) };
}
export function parseTicketUpdate(value: unknown) {
  const input = object(value, ["updatedAt", "completedOn", "description", "category", "hours"]);
  return { updatedAt: version(input.updatedAt), ...ticketFields(input) };
}
export function parseTicketDelete(value: unknown) {
  return { updatedAt: version(object(value, ["updatedAt"]).updatedAt) };
}
export function parseAccountPathId(value: unknown) { return text(value, "Account", 1500); }
export function parseTicketFilters(params: URLSearchParams) {
  const allowed = ["seasonId", "accountId", "category", "from", "to", "q", "page"];
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length > 1) fail(`Unsupported or duplicate filter: ${key}.`);
  }
  const from = params.has("from") ? parseWorkshareDate(params.get("from"), "From date") : undefined;
  const to = params.has("to") ? parseWorkshareDate(params.get("to"), "To date") : undefined;
  if (from && to && from > to) fail("From date must be on or before To date.");
  const rawPage = params.get("page") ?? "1";
  if (!/^[1-9]\d*$/.test(rawPage) || Number(rawPage) > 1000000) fail("Page must be a positive whole number up to 1,000,000.");
  const q = params.get("q")?.trim();
  if (q && q.length > 200) fail("Search must be 200 characters or fewer.");
  return { seasonId: parseWorkshareId(params.get("seasonId"), "Season"), page: Number(rawPage),
    ...(params.has("accountId") ? { accountId: text(params.get("accountId"), "Account", 1500) } : {}),
    ...(params.has("category") ? { category: category(params.get("category")) } : {}),
    ...(from ? { from } : {}), ...(to ? { to } : {}), ...(q ? { q } : {}) };
}
