import { diagnosticCode } from "@/lib/request-diagnostics";
import { serverClient } from "@/lib/supabase/server";
import { isToolsAdmin } from "@/lib/tools-access";
import { readDraftingSnapshot } from "@/lib/layout-drafting/server";

function respond(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request) {
  try {
    const client = await serverClient();
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError || !user)
      return respond({ error: "Sign in to use Layout Drafting." }, 401);
    if (
      user.is_anonymous ||
      !isToolsAdmin(user.email, !!user.email_confirmed_at)
    )
      return respond({ error: "Administrator access is required." }, 403);
    const { data: staff, error: staffError } = await client.rpc("is_staff");
    if (staffError || !staff)
      return respond({ error: "Staff access is required." }, 403);
    const asOf = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Los_Angeles",
    });
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(45000),
    ]);
    return respond({ data: await readDraftingSnapshot(client, asOf, signal) });
  } catch (error) {
    console.error("[velocity:layout-drafting] read failed", {
      code: diagnosticCode(error),
    });
    return respond(
      { error: "Layout Drafting is unavailable. Please try again." },
      503,
    );
  }
}
