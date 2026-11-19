import "server-only";
import { serverClient } from "@/lib/supabase/server";
import { isToolsAdmin } from "@/lib/tools-access";
export const reply = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function dataOwner() {
  const client = await serverClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user)
    return { denied: reply({ error: "Sign in to manage data." }, 401) };
  if (user.is_anonymous || !isToolsAdmin(user.email, !!user.email_confirmed_at))
    return {
      denied: reply({ error: "Only the data owner can manage results." }, 403),
    };
  return { client };
}
export function databaseError(error: { code?: string; message: string }) {
  return reply(
    { error: error.message },
    error.code === "40001"
      ? 409
      : error.code === "42501"
        ? 403
        : error.code === "P0002"
          ? 404
          : 400,
  );
}
export async function boundedBody(request: Request) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 1_500_000)
    throw new Error("Request is too large.");
  return JSON.parse(raw);
}
