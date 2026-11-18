import { AccountValidationError } from "./accounts-validation";
import { sameOrigin } from "@/lib/same-origin";
import { serverClient } from "@/lib/supabase/server";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
class WorkshareHttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export function workshareResponse(body: object, status = 200) { return Response.json(body, { status, headers }); }
export function workshareDatabaseError(error: { code: string; message: string }) {
  if (error.code === "23P01")
    return workshareResponse({ error: "These dates overlap another season. Choose a different date range." }, 400);
  const status = error.code === "40001" || error.code === "23505" ? 409
    : error.code === "42501" ? 403 : error.code === "P0002" ? 404 : error.code === "P0410" ? 410
      : ["22023", "22P02", "22007", "22008", "23502", "23503", "23514", "23P01"].includes(error.code) ? 400 : 503;
  return workshareResponse({ error: status === 503 ? "Accounts and tickets are unavailable. Please try again." : error.message }, status);
}
export async function readWorkshareBody(request: Request): Promise<unknown> {
  const limit = 1024 * 1024;
  if (Number(request.headers.get("content-length")) > limit) throw new WorkshareHttpError("Requests must be 1 MB or smaller.", 413);
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > limit) throw new WorkshareHttpError("Requests must be 1 MB or smaller.", 413);
  try { return JSON.parse(body); } catch { throw new AccountValidationError("Send valid JSON."); }
}
export async function withWorkshareStaff(
  request: Request | undefined,
  write: boolean,
  action: (client: Awaited<ReturnType<typeof serverClient>>) => Promise<Response>,
) {
  if (write && (!request || !sameOrigin(request))) return workshareResponse({ error: "Invalid request origin." }, 403);
  try {
    const client = await serverClient();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return workshareResponse({ error: "Sign in to manage accounts and tickets." }, 401);
    if (user.is_anonymous || !user.email_confirmed_at)
      return workshareResponse({ error: "Verified staff access is required." }, 403);
    const { data: staff, error: staffError } = await client.rpc("is_workshare_staff");
    if (staffError || !staff) return workshareResponse({ error: "Staff access is required." }, 403);
    return await action(client);
  } catch (cause) {
    return workshareResponse({ error: cause instanceof WorkshareHttpError || cause instanceof AccountValidationError
      ? cause.message : "Could not confirm this request. Reload before trying again." },
      cause instanceof WorkshareHttpError ? cause.status : cause instanceof AccountValidationError ? 400 : 503);
  }
}
