import type { WorkshareAccount } from "./accounts";
import { withUpdateHold } from "@/lib/update-safety";

export const ticketCategories = [
  ["general", "General"],
  ["starlight", "Starlight"],
  ["apple_capital", "Apple Capital"],
] as const;
export type TicketCategory = (typeof ticketCategories)[number][0];
export const categoryLabels: Record<TicketCategory, string> = {
  general: "General",
  starlight: "Starlight",
  apple_capital: "Apple Capital",
};
export interface WorkshareSeason {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
}
export interface SeasonRequirements {
  accountId: string;
  seasonId: string;
  generalHoursRequired: number | null;
  starlightHoursRequired: number | null;
  appleCapitalHoursRequired: number | null;
  updatedAt: string | null;
}
export interface CompletedHours {
  general: number;
  starlight: number;
  appleCapital: number;
}
export interface AccountSeasonSummary {
  account: WorkshareAccount;
  requirements: SeasonRequirements;
  completed: CompletedHours;
}
export interface TicketFields {
  completedOn: string;
  description: string;
  category: TicketCategory;
  hours: number;
}
export interface WorkshareTicket extends TicketFields {
  id: string;
  accountId: string;
  seasonId: string;
  createdAt: string;
  updatedAt: string;
}
export interface TicketQuery {
  seasonId: string;
  accountId?: string;
  category?: TicketCategory | "";
  from?: string;
  to?: string;
  q?: string;
  page?: number;
}
export interface TicketPage {
  tickets: WorkshareTicket[];
  total: number;
  page: number;
  pageSize: number;
}
export interface SeasonInput {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  copyFromSeasonId: string | null;
}
export interface TicketInput extends TicketFields {
  id: string;
  accountId: string;
  seasonId: string;
}
export class WorkshareRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WorkshareRequestError";
  }
}

async function data<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const body = await response.json();
  if (!response.ok)
    throw new WorkshareRequestError(
      body.error || "Unable to process this change.",
      response.status,
    );
  return body.data as T;
}
function read<T>(path: string, signal?: AbortSignal) {
  return fetch(path, { cache: "no-store", signal }).then(data<T>);
}
function write<T>(path: string, method: string, body: unknown) {
  return withUpdateHold(async () =>
    data<T>(
      await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  );
}
export const loadSeasons = (signal?: AbortSignal) =>
  read<WorkshareSeason[]>("/api/workshare/seasons", signal);
export const createSeason = (input: SeasonInput) =>
  write<WorkshareSeason>("/api/workshare/seasons", "POST", input);
export const loadAccountSummaries = (seasonId: string, signal?: AbortSignal) =>
  read<AccountSeasonSummary[]>(
    `/api/workshare/accounts?seasonId=${encodeURIComponent(seasonId)}`,
    signal,
  );
export const saveRequirements = (input: SeasonRequirements) =>
  write<SeasonRequirements>(
    `/api/workshare/accounts/${encodeURIComponent(input.accountId)}/requirements`,
    "PUT",
    {
      seasonId: input.seasonId,
      updatedAt: input.updatedAt,
      generalHoursRequired: input.generalHoursRequired,
      starlightHoursRequired: input.starlightHoursRequired,
      appleCapitalHoursRequired: input.appleCapitalHoursRequired,
    },
  );
export function loadTickets(query: TicketQuery, signal?: AbortSignal) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return read<TicketPage>(`/api/workshare/tickets?${params}`, signal);
}
export const createTicket = (input: TicketInput) =>
  write<WorkshareTicket>("/api/workshare/tickets", "POST", input);
export const saveTicket = (input: WorkshareTicket) =>
  write<WorkshareTicket>(
    `/api/workshare/tickets/${encodeURIComponent(input.id)}`,
    "PUT",
    {
      updatedAt: input.updatedAt,
      completedOn: input.completedOn,
      description: input.description,
      category: input.category,
      hours: input.hours,
    },
  );
export const deleteTicket = (input: WorkshareTicket) =>
  write<void>(
    `/api/workshare/tickets/${encodeURIComponent(input.id)}`,
    "DELETE",
    { updatedAt: input.updatedAt },
  );

export function todayDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function dateInSeason(date: string, season: WorkshareSeason) {
  return date >= season.startsOn && date <= season.endsOn;
}
export function defaultTicketDate(season: WorkshareSeason) {
  const today = todayDate();
  return dateInSeason(today, season) ? today : "";
}
export function defaultSeason(seasons: WorkshareSeason[], today = todayDate()) {
  const ordered = [...seasons].sort((a, b) =>
    a.startsOn.localeCompare(b.startsOn),
  );
  return (
    ordered.find((season) => dateInSeason(today, season)) ??
    ordered.filter((season) => season.startsOn <= today).at(-1) ??
    ordered[0]
  );
}
export function validateTicketFields(
  ticket: TicketFields,
  season: WorkshareSeason,
): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(ticket.completedOn) ||
    !Number.isFinite(Date.parse(ticket.completedOn)) ||
    new Date(ticket.completedOn).toISOString().slice(0, 10) !==
      ticket.completedOn
  )
    return "Enter a valid work date.";
  if (!dateInSeason(ticket.completedOn, season))
    return "The work date must fall within the selected season.";
  if (!ticket.description.trim() || ticket.description.trim().length > 500)
    return "Enter a description of 1 to 500 characters.";
  if (!ticketCategories.some(([category]) => category === ticket.category))
    return "Choose a category.";
  if (
    !Number.isFinite(ticket.hours) ||
    ticket.hours <= 0 ||
    ticket.hours > 10000 ||
    Number(ticket.hours.toFixed(2)) !== ticket.hours
  )
    return "Hours must be greater than 0 and no more than 10,000, with at most two decimal places.";
  return "";
}
export function validateRequirements(input: SeasonRequirements) {
  for (const [key, label] of [
    ["generalHoursRequired", "General"],
    ["starlightHoursRequired", "Starlight"],
    ["appleCapitalHoursRequired", "Apple Capital"],
  ] as const) {
    const value = input[key];
    if (
      value !== null &&
      (!Number.isFinite(value) ||
        value < 0 ||
        value > 10000 ||
        Number(value.toFixed(2)) !== value)
    )
      return `${label} required hours must be blank or between 0 and 10,000, with at most two decimal places.`;
  }
  return "";
}
