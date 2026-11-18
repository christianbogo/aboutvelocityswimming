import { serverClient } from "@/lib/supabase/server";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
function respond(body: object, status = 200) {
  return Response.json(body, { status, headers });
}

/** Read-only account totals; the database resolves ownership from the session. */
export async function GET(request: Request) {
  try {
    const client = await serverClient();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user)
      return respond({ error: "Sign in to view Workshare Tracking." }, 401);
    if (!user.email_confirmed_at || user.is_anonymous)
      return respond({ error: "Verify your sign-in email to view Workshare Tracking." }, 403);

    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => key !== "seasonId") || params.getAll("seasonId").length > 1)
      return respond({ error: "Choose a valid season." }, 400);
    const seasonId = params.get("seasonId");
    if (seasonId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seasonId))
      return respond({ error: "Choose a valid season." }, 400);

    const { data, error } = await client.rpc("read_my_workshare_summary", {
      ...(seasonId ? { season_id: seasonId } : {}),
    });
    if (error) {
      if (error.code === "42501")
        return respond({ error: "Verify your sign-in email to view Workshare Tracking." }, 403);
      if (error.code === "P0002")
        return respond({ error: "This season is no longer available. Reload to choose another." }, 404);
      return respond({ error: "Workshare Tracking is unavailable. Please try again." }, 503);
    }
    return respond({ data });
  } catch {
    return respond({ error: "Workshare Tracking is unavailable. Please try again." }, 503);
  }
}
