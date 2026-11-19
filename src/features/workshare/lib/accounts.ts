import { withUpdateHold } from "@/lib/update-safety";

export interface RosterAthlete {
  id?: string;
  fullName: string;
  trainingGroup: string;
  timesAthleteId: string | null;
  isArchived: boolean;
}

export interface WorkshareAccount {
  id?: string;
  fullName: string;
  emails: string[];
  athletes: RosterAthlete[];
  requireWorkshare?: boolean;
  workshareNote?: string;
  currentSeason: string | null;
  generalHoursRequired: number | null;
  starlightHoursRequired: number | null;
  appleCapitalHoursRequired: number | null;
  isArchived: boolean;
  updatedAt?: string;
}

export function emptyAccount(): WorkshareAccount {
  return {
    fullName: "",
    emails: [],
    athletes: [],
    requireWorkshare: true,
    workshareNote: "",
    currentSeason: null,
    generalHoursRequired: null,
    starlightHoursRequired: null,
    appleCapitalHoursRequired: null,
    isArchived: false,
  };
}

async function responseData<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || "Unable to process account changes.");
  return body.data as T;
}

export async function loadWorkshareAccounts(signal?: AbortSignal) {
  return responseData<WorkshareAccount[]>(
    await fetch("/api/workshare/accounts", {
      cache: "no-store",
      signal,
    }),
  );
}

export class WorkshareAccountSaveError extends Error {
  constructor(
    message: string,
    readonly mayHaveSaved: boolean,
  ) {
    super(message);
    this.name = "WorkshareAccountSaveError";
  }
}

export function saveWorkshareAccount(account: WorkshareAccount) {
  return withUpdateHold(async () => {
    let response: Response;
    try {
      response = await fetch("/api/workshare/accounts", {
        method: account.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(account.id ? { id: account.id, updatedAt: account.updatedAt } : {}),
          fullName: account.fullName,
          emails: account.emails,
          athletes: account.athletes.map((athlete) => ({
            ...(athlete.id ? { id: athlete.id } : {}),
            fullName: athlete.fullName,
            trainingGroup: athlete.trainingGroup,
            timesAthleteId: athlete.timesAthleteId,
            isArchived: athlete.isArchived,
          })),
          isArchived: account.isArchived,
          ...(account.requireWorkshare === undefined ? {} : { requireWorkshare: account.requireWorkshare }),
          ...(account.workshareNote === undefined ? {} : { workshareNote: account.workshareNote }),
        }),
      });
    } catch {
      throw new WorkshareAccountSaveError(
        "Could not confirm this save. Reload the account before trying again.",
        true,
      );
    }
    try {
      return await responseData<WorkshareAccount>(response);
    } catch (cause) {
      throw new WorkshareAccountSaveError(
        cause instanceof Error ? cause.message : "Unable to save changes.",
        response.ok || response.status >= 500 || response.status === 408,
      );
    }
  });
}

export function exportWorkshareAccounts(accounts: WorkshareAccount[]) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(accounts, null, 2)], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "velocity-accounts-roster.json";
  link.click();
  URL.revokeObjectURL(url);
}
