import { serverClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const reply = (body: unknown, status = 200) =>
    Response.json(body, {
      status,
      headers: { "Cache-Control": "private, no-store" },
    });
  const params = new URL(request.url).searchParams;
  const meet = params.get("meet");
  const scope = params.get("scope");
  if (scope !== null && scope !== "meet")
    return reply({ error: "Choose a valid Team view." }, 400);
  if (scope === "meet" && !meet)
    return reply({ error: "Choose a valid meet." }, 400);
  if (meet !== null && (!meet.trim() || meet.length > 1500))
    return reply({ error: "Choose a valid meet." }, 400);
  try {
    const client = await serverClient();
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError || !user)
      return reply({ error: "Sign in to view Team." }, 401);
    if (user.is_anonymous || !user.email_confirmed_at)
      return reply({ error: "Verify your email to view Team." }, 403);
    const { data, error } = await client.rpc("team_dashboard_view", {
      selected_meet: meet ?? undefined,
      meet_only: scope === "meet",
    });
    if (error) throw error;
    return reply(data);
  } catch {
    return reply({ error: "Couldn’t load Team. Please try again." }, 503);
  }
}
