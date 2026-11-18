import { diagnosticCode } from "@/lib/request-diagnostics";
import { serverClient } from "@/lib/supabase/server";
import {
  parseTeamMapQuery,
  readTeamMap,
  TeamMapQueryError,
} from "@/lib/team-map/server";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

function respond(body: object, status = 200) {
  return Response.json(body, { status, headers });
}

export async function GET(request: Request) {
  try {
    const client = await serverClient();
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError || !user)
      return respond({ error: "Sign in to view Team Map." }, 401);
    const { data: staff, error: staffError } = await client.rpc("is_staff");
    if (staffError || !staff)
      return respond({ error: "Staff access is required." }, 403);
    const asOf = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Los_Angeles",
    });
    const selection = parseTeamMapQuery(
      new URL(request.url).searchParams,
      asOf,
    );
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(45000),
    ]);
    return respond({ data: await readTeamMap(client, selection, signal) });
  } catch (error) {
    if (error instanceof TeamMapQueryError)
      return respond({ error: error.message }, 400);
    console.error("[velocity:team-map] read failed", {
      code: diagnosticCode(error),
    });
    return respond(
      { error: "Team Map is unavailable. Please try again." },
      503,
    );
  }
}
