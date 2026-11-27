import "server-only";
import { VELOCITY_TEAM_ID } from "@/features/swim-resources/lib/domain/entities";
import { createClient } from "@supabase/supabase-js";
import { unstable_cache, revalidateTag } from "next/cache";
import type { Database } from "@/lib/supabase/database.types";
import type {
  TimesInput,
  TimesKind,
  TimesResponse,
} from "@/features/swimming/domain/times-query";
import { timesExpiry } from "@/features/swimming/domain/cache-policy";
import { diagnosticCode } from "@/lib/request-diagnostics";
const tag = "ies-times";
let generation = 0;
class InvalidatedTimesRead extends Error {}
const pending = new Map<string, Promise<Omit<TimesResponse, "expiresAt">>>();
const pendingCached = new Map<
  string,
  Promise<Omit<TimesResponse, "expiresAt">>
>();
export function invalidateTimes() {
  generation++;
  revalidateTag(tag, { expire: 0 });
}
const readCached = unstable_cache(
  async (url: string, key: string, kind: TimesKind, serialized: string) => {
    const startedGeneration = generation;
    const requestKey = JSON.stringify([
      url,
      key,
      kind,
      serialized,
      startedGeneration,
    ]);
    let read = pending.get(requestKey);
    if (!read) {
      read = readDatabase(url, key, kind, serialized);
      pending.set(requestKey, read);
    }
    try {
      const result = await read;
      // Reject an in-flight read started in this worker before invalidation.
      // Shared Next cache tags handle invalidation across worker instances.
      if (startedGeneration !== generation) throw new InvalidatedTimesRead();
      return result;
    } finally {
      if (pending.get(requestKey) === read) pending.delete(requestKey);
    }
  },
  ["velocity-times-v7"],
  { tags: [tag], revalidate: 60 },
);
async function readDatabase(
  url: string,
  key: string,
  kind: TimesKind,
  serialized: string,
): Promise<Omit<TimesResponse, "expiresAt">> {
  const client = createClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }),
    },
  });
  const input = JSON.parse(serialized);
  const started = performance.now();
  let query;
  switch (kind) {
    case "my_times":
      query = client.rpc(
        input.rankPeriod === "all" ? "ies_my_times_all_time" : "ies_my_times",
        { input },
      );
      break;
    case "my_times_bests":
      query = client.rpc("ies_my_times_bests", { input });
      break;
    case "ranking_years":
      query = client.rpc("ies_times_ranking_years", { input });
      break;
    case "records_board":
      query = client.rpc("ies_team_records_board", { input });
      break;
    default:
      query =
        kind === "rankings" && input.mode === "recent"
          ? client.rpc("ies_times_recent", { input })
          : client.rpc("ies_times_query", { query_kind: kind, input });
  }
  const { data, error, status } = await query;
  const timing = {
    kind,
    durationMs: Math.round(performance.now() - started),
    status,
  };
  if (error) {
    console.error("[velocity:times] database read failed", {
      ...timing,
      code: diagnosticCode(error),
    });
    throw Object.assign(new Error("Times query failed"), {
      code: error.code,
    });
  }
  console.info("[velocity:times] database read completed", timing);
  return data as unknown as Omit<TimesResponse, "expiresAt">;
}
export async function readTimes(
  kind: TimesKind,
  input: TimesInput,
): Promise<TimesResponse> {
  input = Object.fromEntries(
    Object.entries({ ...input, team: VELOCITY_TEAM_ID }).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  );
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Times database is not configured.");
  for (let attempt = 0; attempt < 2; attempt++) {
    const startedGeneration = generation;
    const serialized = JSON.stringify(input);
    const requestKey = JSON.stringify([
      url,
      key,
      kind,
      serialized,
      startedGeneration,
    ]);
    let read = pendingCached.get(requestKey);
    if (!read) {
      read = readCached(url, key, kind, serialized);
      pendingCached.set(requestKey, read);
    }
    try {
      const result = await read;
      if (startedGeneration !== generation) throw new InvalidatedTimesRead();
      // The refresh deadline belongs to this response, not the cached database
      // value. A stale-while-revalidate hit must not trigger a one-second loop.
      return { ...result, expiresAt: timesExpiry() };
    } catch (error) {
      if (!(error instanceof InvalidatedTimesRead) || attempt > 0) throw error;
    } finally {
      if (pendingCached.get(requestKey) === read)
        pendingCached.delete(requestKey);
    }
  }
  throw new InvalidatedTimesRead();
}
