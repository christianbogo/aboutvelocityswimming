import { browserClient } from "./supabase/client";
import type { PublicAthlete } from "@/features/swim-resources/lib/domain/athlete";
import type {
  AthleteBest,
  StandardSet,
} from "@/features/swim-resources/types/schema";

/** Public projections only: private athlete identity details never enter these reads. */
export async function loadPublicAthleteBests(
  name: string,
  signal: AbortSignal,
) {
  const client = browserClient();
  const { data: match, error: athleteError } = await client
    .from("public_athletes")
    .select("id, data")
    .contains("data", { aliases: [name] })
    .order("id")
    .limit(1)
    .abortSignal(signal)
    .maybeSingle();
  if (athleteError) throw athleteError;
  if (!match) return { athlete: null, bests: [] as AthleteBest[] };
  const { data, error } = await client
    .from("athlete_bests")
    .select("data")
    .eq("athlete_id", match.id)
    .order("event_code")
    .abortSignal(signal);
  if (error) throw error;
  return {
    athlete: { ...(match.data as unknown as PublicAthlete), id: match.id },
    bests: (data ?? []).map((row) => row.data as unknown as AthleteBest),
  };
}

export async function loadPublicStandards(
  signal: AbortSignal,
): Promise<StandardSet[]> {
  const { data, error } = await browserClient()
    .from("standards")
    .select("id, data")
    .order("id")
    .abortSignal(signal);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...(row.data as unknown as StandardSet),
    id: row.id,
  }));
}
