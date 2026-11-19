import type {
  TicketFields,
  WorkshareSeason,
} from "@/features/workshare/lib/tickets";

export interface AccountWorkshareSummary {
  id: string;
  fullName: string;
  requireWorkshare?: boolean;
  workshareNote?: string;
  isArchived: boolean;
  emails: string[];
  athletes: {
    id: string;
    fullName: string;
    trainingGroup: string;
    isArchived: boolean;
  }[];
  tickets: (TicketFields & { id: string })[];
  requirements: {
    generalHoursRequired: number | null;
    starlightHoursRequired: number | null;
    appleCapitalHoursRequired: number | null;
  };
  completed: {
    general: number;
    starlight: number;
    appleCapital: number;
  };
}

export interface AccountWorkshareData {
  seasons: WorkshareSeason[];
  seasonId: string | null;
  accounts: AccountWorkshareSummary[];
}

export async function loadAccountWorkshare(
  seasonId?: string,
  signal?: AbortSignal,
): Promise<AccountWorkshareData> {
  const query = seasonId
    ? `?${new URLSearchParams({ seasonId }).toString()}`
    : "";
  const response = await fetch(`/api/account/workshare${query}`, {
    cache: "no-store",
    signal,
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      body.error || "Your Workshare information couldn’t be loaded.",
    );
  return body.data as AccountWorkshareData;
}

export function workshareHours(completed: number, required: number | null) {
  const format = (hours: number) =>
    hours.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `${format(completed)}/${required === null ? "-" : format(required)}`;
}
