import { dataOwner } from "@/lib/results/server";
export const maxDuration = 60;
import { sameOrigin } from "@/lib/same-origin";
import { invalidateTimes } from "@/lib/times/server";
import { moderationReasons } from "@/features/swimming/domain/moderation";

const headers = { "Cache-Control": "private, no-store" };
const response = (body: unknown, status = 200) =>
  Response.json(body, { status, headers });
function failure(code: string) {
  if (["PGRST202", "42P01", "42883"].includes(code))
    return response(
      {
        code: "MODERATION_NOT_INSTALLED",
        error:
          "Result review is not installed on this database yet. The moderation database migration must be applied.",
      },
      503,
    );
  if (code === "40001")
    return response(
      { error: "This result changed. Refresh before reviewing it again." },
      409,
    );
  if (code === "P0002") return response({ error: "Result not found." }, 404);
  if (code === "42501")
    return response({ error: "Only the data owner can review results." }, 403);
  if (code === "22023")
    return response(
      { error: "Check the result, reason, and explanation." },
      400,
    );
  return response(
    { error: "Could not complete the review. Please try again." },
    503,
  );
}
function validReference(kind: unknown, id: unknown): kind is "swim" | "relay" {
  return (
    (kind === "swim" || kind === "relay") &&
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= 200
  );
}
export async function GET(request: Request) {
  const auth = await dataOwner();
  if (auth.denied) return auth.denied;
  const params = new URL(request.url).searchParams;
  const kind = params.get("resultType"),
    id = params.get("resultId");
  if (kind !== null || id !== null) {
    if (!validReference(kind, id))
      return response({ error: "Choose a valid result." }, 400);
    const { data, error } = await auth.client.rpc("read_result_moderation", {
      result_type: kind,
      result_id: id!,
    });
    return error ? failure(error.code) : response(data);
  }
  const offset = Number(params.get("offset") ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0)
    return response({ error: "Invalid page." }, 400);
  const { data, error } = await auth.client.rpc("list_result_moderation", {
    page_from: offset,
    page_size: 25,
    include_restored: params.get("includeRestored") === "true",
  });
  return error ? failure(error.code) : response(data);
}
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return response({ error: "Invalid request origin." }, 403);
  const auth = await dataOwner();
  if (auth.denied) return auth.denied;
  let body;
  try {
    body = await request.json();
  } catch {
    return response({ error: "Invalid request." }, 400);
  }
  if (
    !validReference(body?.resultType, body?.resultId) ||
    !["flag", "restore"].includes(body?.action) ||
    !Number.isSafeInteger(body?.expectedVersion) ||
    body.expectedVersion < 0 ||
    typeof body?.note !== "string" ||
    body.note.length > 4000 ||
    (body.action === "flag" &&
      !moderationReasons.some(([key]) => key === body.reason)) ||
    ((body.action === "restore" || body.reason === "other") &&
      !body.note.trim())
  ) {
    return response(
      {
        error:
          "Choose a reason and provide any required explanation (up to 4,000 characters).",
      },
      400,
    );
  }
  const { data, error } = await auth.client.rpc("moderate_result", {
    result_type: body.resultType,
    result_id: body.resultId,
    action: body.action,
    reason: body.action === "flag" ? body.reason : "",
    note: body.note.trim(),
    expected_version: body.expectedVersion,
  });
  if (error) return failure(error.code);
  invalidateTimes();
  return response(data);
}
