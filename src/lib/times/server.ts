import "server-only";
import { VELOCITY_TEAM_ID } from "@/features/swim-resources/lib/domain/entities";
import { createClient } from "@supabase/supabase-js";
import { unstable_cache, revalidateTag } from "next/cache";
import type { Database } from "@/lib/supabase/database.types";
import type {
  TimesInput,
  TimesKind,
  TimesResponse,
} from "@/components/collection/times-api";
import { timesBucket, timesExpiry } from "@/components/collection/times-cache";
import { athletePages } from "./athlete-pages";
import { diagnosticCode } from "@/lib/request-diagnostics";
const tag = "ies-times";
export function invalidateTimes() {
  revalidateTag(tag, { expire: 0 });
}
const readCached = unstable_cache(
  async (
    url: string,
    key: string,
    kind: TimesKind,
    serialized: string,
    bucket: number,
  ) => {
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
    const { data, error, status } = await (kind === "my_times"
      ? client.rpc("ies_my_times", { input })
      : kind === "rankings" && input.mode === "recent"
        ? client.rpc("ies_times_recent", { input })
        : client.rpc("ies_times_query", { query_kind: kind, input }));
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
    const result = data as unknown as TimesResponse;
    return { ...result, expiresAt: timesExpiry(bucket) };
  },
  ["velocity-times-v5"],
  { tags: [tag], revalidate: 60 },
);
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
  if (kind === "athletes") {
    // Cache the database's complete scoring result; serve each requested list page.
    const result = await readCached(
      url,
      key,
      kind,
      JSON.stringify({
        team: input.team,
        course: input.course,
        period: input.period,
      }),
      timesBucket(),
    );
    return { ...result, groups: athletePages(result.groups ?? [], input) };
  }
  const result = await readCached(
    url,
    key,
    kind,
    JSON.stringify(input),
    timesBucket(),
  );
  return {
    ...result,
    groups: result.groups ? athletePages(result.groups, input) : undefined,
  };
}
