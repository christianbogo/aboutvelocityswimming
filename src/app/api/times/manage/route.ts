import { createHash } from "node:crypto";
import { sameOrigin } from "@/lib/same-origin";
import { invalidateTimes } from "@/lib/times/server";
import {
  dataOwner,
  reply,
  databaseError,
  boundedBody,
} from "@/lib/results/server";
import { object, validateRecord } from "@/lib/results/validate";
import { recordKinds, type RecordKind } from "@/lib/results/types";
import type { Json } from "@/lib/supabase/database.types";
export const maxDuration = 60;
export async function GET(request: Request) {
  const auth = await dataOwner();
  if (auth.denied) return auth.denied;
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind") as RecordKind;
  if (!recordKinds.includes(kind))
    return reply({ error: "Unknown record type." }, 400);
  const input = {
    action: params.has("id") ? "get" : "list",
    kind,
    id: params.get("id"),
    parentRelayId: params.get("parentRelayId"),
    search: params.get("search") ?? "",
    offset: Number(params.get("offset") ?? 0),
  };
  const { data, error } = await auth.client.rpc("manage_result_records", {
    input,
  });
  return error ? databaseError(error) : reply(data);
}
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return reply({ error: "Invalid request origin." }, 403);
  const auth = await dataOwner();
  if (auth.denied) return auth.denied;
  try {
    const input = object(await boundedBody(request)),
      kind = input.kind as RecordKind;
    const body = object(input.data);
    if (
      kind === "athlete" &&
      typeof input.memberId === "string" &&
      input.memberId.trim()
    ) {
      if (!/^[a-zA-Z0-9-]{4,40}$/.test(input.memberId.trim()))
        throw new Error("Enter a valid source swimmer ID.");
      body.sourceObservation = {
        ...((body.sourceObservation as object) ?? {}),
        memberIdHash: createHash("sha256")
          .update(input.memberId.trim())
          .digest("hex")
          .slice(0, 24),
      };
    }
    const validated = validateRecord(kind, body);
    const related =
      input.related === undefined
        ? undefined
        : (() => {
            if (
              kind !== "relay" ||
              !Array.isArray(input.related) ||
              input.related.length > 10
            )
              throw new Error("Invalid linked first-leg corrections.");
            return input.related.map((item) => {
              const r = object(item);
              return {
                data: validateRecord("swim", object(r.data)),
                version: r.version,
              };
            });
          })();
    const { data, error } = await auth.client.rpc("manage_result_records", {
      input: {
        action: "save",
        kind,
        id: validated.id,
        data: validated,
        version: input.version,
        ...(related ? { related } : {}),
      } as Json,
    });
    if (error) return databaseError(error);
    invalidateTimes();
    return reply(data);
  } catch (e) {
    return reply(
      { error: e instanceof Error ? e.message : "Unable to save." },
      400,
    );
  }
}
