import { NextResponse } from "next/server";
import {
  getToolsSignInDestination,
  isToolsAdmin,
  isToolsPage,
} from "@/lib/tools-access";
import { serverClient } from "@/lib/supabase/server";
export async function GET(request: Request) {
  const url = new URL(request.url),
    code = url.searchParams.get("code"),
    candidate = url.searchParams.get("next") ?? "/tools";
  const next =
    candidate.startsWith("/") &&
    !candidate.startsWith("//") &&
    !candidate.includes("\\") &&
    !/[\r\n\t]/.test(candidate)
      ? candidate
      : "/tools";
  if (code) {
    try {
      const client = await serverClient();
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (!error) {
        let destination = next;
        if (isToolsPage(next.split(/[?#]/, 1)[0])) {
          const {
            data: { user },
            error: userError,
          } = await client.auth.getUser();
          if (userError || !user || user.is_anonymous)
            throw new Error("Sign-in could not be verified.");
          let staff = false;
          const verified = Boolean(user.email_confirmed_at);
          if (verified && !isToolsAdmin(user.email, verified)) {
            const result = await client.rpc("is_workshare_staff");
            if (result.error)
              throw new Error("Staff access could not be verified.");
            staff = result.data === true;
          }
          destination = getToolsSignInDestination(
            {
              email: user.email,
              emailVerified: verified,
              staff,
            },
            next,
            url.searchParams.get("flow") === "link",
          );
        }
        return NextResponse.redirect(new URL(destination, url.origin));
      }
    } catch {
      // Keep failed identity or staff checks in the sign-in flow.
    }
  }
  const failure =
    url.searchParams.get("flow") === "link"
      ? "/tools?account-link=error"
      : "/login?error=callback";
  return NextResponse.redirect(new URL(failure, url.origin));
}
