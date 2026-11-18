import { heldArchiveReceipt, heldRecordId, heldUuid } from "@/lib/collection/held-observations";
import { requestDiagnostics } from "@/lib/request-diagnostics";
import { sameOrigin } from "@/lib/same-origin";
import type { Json } from "@/lib/supabase/database.types";
import { serverClient } from "@/lib/supabase/server";
import { invalidateTimes } from "@/lib/times/server";

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function id(value: unknown): value is string {
  return typeof value === "string" && heldUuid.test(value);
}

function writeInput(body: unknown): Json | null {
  if (!object(body)) return null;
  if (body.action === "acceptOfficialArchive") {
    return Object.keys(body).length === 1 ? { action: "acceptOfficialArchive" } : null;
  }
  if (body.action === "linkAndApproveSwimmer") {
    const { id: observationId, athleteId, requestId, pageSize = 40 } = body;
    return id(observationId) && id(requestId) && typeof athleteId === "string" && heldRecordId.test(athleteId)
      && typeof pageSize === "number" && Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 40
      ? { action: "linkAndApproveSwimmer", id: observationId, athleteId, requestId, pageSize }
      : null;
  }
  if (body.action === "submit") {
    const { ids } = body;
    return Array.isArray(ids) && ids.length > 0 && ids.length <= 90 && ids.every(id)
      ? { action: "submit", ids }
      : null;
  }
  if (body.action === "revalidate") {
    const { decisionId, afterId } = body;
    return id(decisionId) && (afterId == null || id(afterId))
      ? { action: "revalidate", decisionId, ...(afterId ? { afterId } : {}) }
      : null;
  }
  if (body.action === "decision" && id(body.id) && id(body.requestId) &&
    (body.scope === "row" || body.scope === "identity" || body.scope === "source")) {
    // The database validates the scope, correction fields, and linkage.
    return body as Json;
  }
  if (body.action === "correction" && (body.kind === "swim" || body.kind === "relay") &&
    typeof body.recordId === "string" && heldRecordId.test(body.recordId)) return body as Json;
  return null;
}

async function run(diagnostic: ReturnType<typeof requestDiagnostics>, input: Json | null) {
  const respond = diagnostic.response;
  if (!input) return respond({ error: "Invalid observation review request." }, 400);
  const approvesSwimmer = object(input) && input.action === "linkAndApproveSwimmer";
  const acceptsArchive = object(input) && input.action === "acceptOfficialArchive";
  try {
    const client = await serverClient();
    const { data: { user }, error: authError } = await diagnostic.step("auth", () => client.auth.getUser());
    if (authError) diagnostic.failure("auth", authError);
    if (!user) return respond({ error: "Sign in to review held observations." }, 401);
    const { data, error } = await diagnostic.step("held-observations", () =>
      client.rpc("velocity_held_observations", { input }));
    if (error) {
      diagnostic.failure("held-observations", error);
      if (approvesSwimmer && error.code === "57014") {
        return respond({ error: "Approval timed out. Resume to continue checking this swimmer.", retrySmaller: true }, 503);
      }
      if (acceptsArchive && error.code === "57014") {
        return respond({ error: "Archive acceptance timed out. Resume to continue from the last saved batch." }, 503);
      }
      switch (error.code) {
        case "42501": return respond({ error: "Staff access is required." }, 403);
        case "22023": return respond({ error: error.message }, 400);
        case "22P02": return respond({ error: "Check the observation details and try again." }, 400);
        case "P0002": case "PT404": return respond({ error: "This observation or decision is unavailable." }, 404);
        case "PT409": case "40001": return respond({ error: error.message }, 409);
        default: return respond({ error: "The review request could not be confirmed. Refresh to check its status or retry." }, 503);
      }
    }
    if (!object(data)) return respond({ error: "The review request returned no results." }, 503);
    const archive = acceptsArchive ? heldArchiveReceipt(data) : null;
    if (acceptsArchive && !archive) return respond({ error: "The archive receipt could not be confirmed. Resume to try again." }, 503);
    if ((approvesSwimmer && typeof data.approved === "number" && data.approved > 0) ||
      (archive && ((archive.publishedThisChunk ?? 0) > 0 || (archive.completed && archive.published > 0)))) {
      try {
        invalidateTimes();
      } catch (error) {
        diagnostic.failure("invalidate-times", error);
      }
    }
    return respond(data);
  } catch (error) {
    diagnostic.failure("unexpected", error);
    return respond({ error: "The review request could not be confirmed. Refresh to check its status or retry." }, 503);
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const action = params.has("athletes") ? "athletes" : "meets";
  const search = params.get(action)?.trim();
  return run(requestDiagnostics("held-observations", request),
    search && search.length <= 150 ? { action, search } : null);
}

export async function POST(request: Request) {
  const diagnostic = requestDiagnostics("held-observations", request);
  if (!sameOrigin(request)) return diagnostic.response({ error: "Invalid request origin." }, 403);
  try {
    const content = await request.text();
    return run(diagnostic, content.length <= 100000 ? writeInput(JSON.parse(content)) : null);
  } catch {
    return diagnostic.response({ error: "Invalid observation review request." }, 400);
  }
}
