import { browserClient } from "./supabase/client";
import { withUpdateHold } from "./update-safety";

export interface AccountAthlete {
  id: string;
  name: string;
  teamName: string | null;
}

export interface AccountAthletePreferences {
  primaryAthlete: AccountAthlete | null;
  favoriteAthletes: AccountAthlete[];
}

const preferenceSnapshots = new Map<string, AccountAthletePreferences>();
export const accountAthletesChangedEvent = "velocity-account-athletes-changed";
function preferenceKey(userId: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}|${userId}`;
}
export function cachedAccountAthletes(userId: string) {
  return preferenceSnapshots.get(preferenceKey(userId));
}
function rememberPreferences(userId: string, value: AccountAthletePreferences) {
  preferenceSnapshots.set(preferenceKey(userId), value);
  if (preferenceSnapshots.size > 8)
    preferenceSnapshots.delete(preferenceSnapshots.keys().next().value!);
  return value;
}

export const maxFavoriteAthletes = 100;

interface AthleteRow {
  id: string;
  name: string;
  team_name: string | null;
}

function athlete(row: AthleteRow): AccountAthlete {
  return { id: row.id, name: row.name, teamName: row.team_name };
}

function preferences(
  rows: (AthleteRow & { is_primary: boolean })[],
): AccountAthletePreferences {
  const primary = rows.find((row) => row.is_primary);
  return {
    primaryAthlete: primary ? athlete(primary) : null,
    favoriteAthletes: rows.filter((row) => !row.is_primary).map(athlete),
  };
}

export async function loadAccountAthletes(
  userId: string,
): Promise<AccountAthletePreferences> {
  const { data, error } = await browserClient().rpc("get_account_athletes", {
    account_user_id: userId,
  });
  if (error) throw error;
  return rememberPreferences(userId, preferences(data ?? []));
}

export async function searchAccountAthletes(
  query: string,
  signal?: AbortSignal,
): Promise<AccountAthlete[]> {
  const search = query.trim();
  if (search.length < 2) return [];
  if (search.length > 100)
    throw new Error("Use 100 characters or fewer to search.");
  const request = browserClient().rpc("search_account_athletes", {
    search_text: search,
  });
  const { data, error } = await (signal
    ? request.abortSignal(signal)
    : request);
  if (error) throw error;
  return (data ?? []).map(athlete);
}

export async function saveAccountAthletes(
  userId: string,
  selection: AccountAthletePreferences,
): Promise<AccountAthletePreferences> {
  const favorites = selection.favoriteAthletes.map(({ id }) => id);
  const primary = selection.primaryAthlete?.id;
  if (
    favorites.length > maxFavoriteAthletes ||
    new Set(favorites).size !== favorites.length ||
    (primary !== undefined && favorites.includes(primary))
  ) {
    throw new Error(
      `Choose up to ${maxFavoriteAthletes} distinct favorites, separate from your primary athlete.`,
    );
  }
  // Labels are always read from public athlete records; only stable IDs are saved.
  if (
    [...favorites, ...(primary === undefined ? [] : [primary])].some(
      (id) => !id.trim() || id.length > 1500,
    )
  )
    throw new Error("Choose an athlete from the search results.");

  return withUpdateHold(async () => {
    const { data, error } = await browserClient().rpc("save_account_athletes", {
      account_user_id: userId,
      primary_id: primary,
      favorite_ids: favorites,
    });
    if (error) throw error;
    const next = rememberPreferences(userId, preferences(data ?? []));
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event(accountAthletesChangedEvent));
    return next;
  });
}
