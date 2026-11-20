import type { Database } from "@/lib/supabase/database.types";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  isStaffToolsPath,
  isSignedInToolsPath,
  isToolsAdmin,
  isToolsApi,
  isToolsPage,
} from "@/lib/tools-access";
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const toolPage = isToolsPage(request.nextUrl.pathname);
  const toolApi = isToolsApi(request.nextUrl.pathname);
  const restricted = toolPage || toolApi;
  function finish(result: NextResponse) {
    if (restricted) result.headers.set("Cache-Control", "private, no-store");
    return result;
  }
  function deny(status: number) {
    const denied =
      toolPage && status !== 503
        ? NextResponse.redirect(new URL("/login", request.url))
        : NextResponse.json(
            {
              error:
                status === 503
                  ? "Tools are temporarily unavailable."
                  : "This account does not have access to this tool.",
            },
            { status },
          );
    response.cookies.getAll().forEach((cookie) => denied.cookies.set(cookie));
    return finish(denied);
  }
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
    return restricted ? deny(503) : response;
  const client = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values) {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          values.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          response.headers.set("Cache-Control", "private, no-store");
        },
      },
    },
  );
  if (restricted) {
    try {
      // Read the current, server-confirmed identity rather than trusting cookie data
      // or user-editable metadata. Use the same cookie-bound identity as the
      // management and staff route handlers.
      const staffPath = isStaffToolsPath(request.nextUrl.pathname);
      const {
        data: { user },
        error,
      } = await client.auth.getUser();
      if (error || !user) return deny(401);
      if (user.is_anonymous || !user.email_confirmed_at) return deny(403);
      if (
        !isToolsAdmin(user.email, true) &&
        !isSignedInToolsPath(request.nextUrl.pathname)
      ) {
        if (!staffPath) return deny(403);
        const { data: staff, error: staffError } =
          await client.rpc("is_workshare_staff");
        if (staffError) return deny(503);
        if (staff !== true) return deny(403);
      }
    } catch {
      return deny(503);
    }
  } else {
    await client.auth.getClaims();
  }
  return finish(response);
}
export const config = {
  matcher: [
    "/tools/:path*",
    "/login",
    "/account",
    "/auth/:path*",
    "/api/data/:path*",
    "/api/attendance/:path*",
    "/api/workshare/:path*",
    "/api/times/:path*",
  ],
};
