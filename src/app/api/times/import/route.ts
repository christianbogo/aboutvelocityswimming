import { sameOrigin } from "@/lib/same-origin";
import { invalidateTimes } from "@/lib/times/server";
import {
  dataOwner,
  reply,
  databaseError,
  boundedBody,
} from "@/lib/results/server";
import { object, validId, validateFileRow } from "@/lib/results/validate";
import type { ImportOutcome } from "@/lib/results/types";
import type { Json } from "@/lib/supabase/database.types";
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return reply({ error: "Invalid request origin." }, 403);
  const auth = await dataOwner();
  if (auth.denied) return auth.denied;
  try {
    const input = object(await boundedBody(request));
    if (
      !Array.isArray(input.rows) ||
      input.rows.length > 100 ||
      (input.meetId && !validId(input.meetId))
    )
      throw new Error("Send up to 100 results and an optional meet selection.");
    const rows = [],
      outcomes: ImportOutcome[] = [];
    for (const row of input.rows) {
      try {
        rows.push(validateFileRow(row));
      } catch (e) {
        outcomes.push({
          filename: String(row?.source?.filename ?? ""),
          line: Number(row?.source?.line ?? 0),
          status: "error",
          message: e instanceof Error ? e.message : "Invalid row.",
        });
      }
    }
    if (!rows.length) return reply({ outcomes, saved: 0 });
    const { data, error } = await auth.client.rpc("import_meet_results", {
      input: {
        rows,
        meetId: input.meetId ?? null,
        includeHistoricalCuda: input.includeHistoricalCuda === true,
      } as unknown as Json,
    });
    if (error) return databaseError(error);
    const result = data as unknown as {
      outcomes: ImportOutcome[];
      saved: number;
    };
    if (result.saved) invalidateTimes();
    return reply({ ...result, outcomes: [...result.outcomes, ...outcomes] });
  } catch (e) {
    return reply(
      { error: e instanceof Error ? e.message : "Unable to import." },
      400,
    );
  }
}
