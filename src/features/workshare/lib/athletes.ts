import { withUpdateHold } from "@/lib/update-safety";
import type { WorkshareAccount } from "./accounts";

export interface TrainingGroup {
  id: string;
  name: string;
  coach: string;
  updated_at: string;
  sort_order: number;
}
export interface AthleteRoster {
  groups: TrainingGroup[];
  accounts: WorkshareAccount[];
}
export type RosterAction =
  | { action: "reorderGroups"; groups: { id: string; updatedAt: string }[] }
  | { action: "createGroup"; name: string; coach: string }
  | {
      action: "updateGroup";
      id: string;
      updatedAt: string;
      name: string;
      coach: string;
    }
  | {
      action: "removeGroup";
      id: string;
      updatedAt: string;
      destinationId: string;
      athleteIds: string[];
    }
  | {
      action: "move";
      destinationId: string;
      athletes: { id: string; updatedAt: string }[];
    };

async function result<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || "Unable to update the roster.");
  return body.data as T;
}
export async function loadAthleteRoster(signal?: AbortSignal) {
  return result<AthleteRoster>(
    await fetch("/api/workshare/athletes", { cache: "no-store", signal }),
  );
}
export async function loadTrainingGroups(signal?: AbortSignal) {
  return result<TrainingGroup[]>(
    await fetch("/api/workshare/athletes?groupsOnly=1", {
      cache: "no-store",
      signal,
    }),
  );
}
export function saveRosterAction(action: RosterAction) {
  return withUpdateHold(async () => {
    await result(
      await fetch("/api/workshare/athletes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      }),
    );
  });
}
