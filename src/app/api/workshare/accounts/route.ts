import { AccountValidationError, parseAccountWrite } from "@/features/workshare/lib/accounts-validation";
import { parseWorkshareId } from "@/features/workshare/lib/tickets-validation";
import { sameOrigin } from "@/lib/same-origin";
import type { Json } from "@/lib/supabase/database.types";
import { serverClient } from "@/lib/supabase/server";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const maxBodyBytes = 1024 * 1024;

function respond(body: object, status = 200) {
  return Response.json(body, { status, headers });
}

async function staffClient() {
  const client = await serverClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user)
    return { response: respond({ error: "Sign in to manage accounts and roster." }, 401) };
  if (user.is_anonymous || !user.email_confirmed_at)
    return { response: respond({ error: "Verified staff access is required." }, 403) };
  const { data: staff, error: staffError } = await client.rpc("is_workshare_staff");
  if (staffError || !staff)
    return { response: respond({ error: "Staff access is required." }, 403) };
  return { client };
}

function databaseError(error: { code: string; message: string }) {
  if (error.code === "40001")
    return respond({ error: "This account changed since you opened it. Reload the latest account before saving." }, 409);
  if (error.code === "42501") return respond({ error: "Staff access is required." }, 403);
  if (error.code === "P0002") return respond({ error: error.message }, 404);
  if (error.code === "23505") return respond({ error: error.message }, 409);
  if (["22023", "22P02", "23502", "23503", "23505", "23514"].includes(error.code))
    return respond({ error: error.message }, 400);
  return respond({ error: "Accounts and roster are unavailable. Please try again." }, 503);
}

export async function GET(request: Request) {
  try {
    const access = await staffClient();
    if (access.response) return access.response;
    const seasonId = new URL(request.url).searchParams.get("seasonId");
    const { data, error } = seasonId !== null
      ? await access.client.rpc("list_workshare_account_summaries", { season_id: parseWorkshareId(seasonId, "Season") })
      : await access.client.rpc("list_workshare_accounts");
    if (error) return databaseError(error);
    return respond({ data });
  } catch (cause) {
    if (cause instanceof AccountValidationError) return respond({ error: cause.message }, 400);
    return respond({ error: "Accounts and roster are unavailable. Please try again." }, 503);
  }
}

async function save(request: Request, mode: "create" | "update") {
  if (!sameOrigin(request)) return respond({ error: "Invalid request origin." }, 403);
  try {
    const access = await staffClient();
    if (access.response) return access.response;
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes)
      return respond({ error: "Account requests must be 1 MB or smaller." }, 413);
    const body = await request.text();
    if (body.length > maxBodyBytes || new TextEncoder().encode(body).byteLength > maxBodyBytes)
      return respond({ error: "Account requests must be 1 MB or smaller." }, 413);
    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      return respond({ error: "Send a valid JSON account." }, 400);
    }
    const account = parseAccountWrite(input, mode);
    const { data, error } = await access.client.rpc("save_workshare_account", {
      input: account as unknown as Json,
    });
    if (error) return databaseError(error);
    return respond({ data }, mode === "create" ? 201 : 200);
  } catch (error) {
    if (error instanceof AccountValidationError) return respond({ error: error.message }, 400);
    return respond({ error: "Could not confirm this save. Reload the account before trying again." }, 503);
  }
}

export async function POST(request: Request) {
  return save(request, "create");
}

export async function PUT(request: Request) {
  return save(request, "update");
}
