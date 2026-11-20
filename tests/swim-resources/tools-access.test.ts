import { readdirSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getClaims: vi.fn(),
  createClient: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createClient }));
import { config, proxy } from "@/proxy";
import {
  canAccessToolsPath,
  getToolsCapabilities,
  getToolsHome,
  getToolsSignInDestination,
  isToolsAdmin,
} from "@/lib/tools-access";

const admin = {
  email: "christiancutter02@gmail.com",
  email_confirmed_at: "2026-10-01T00:00:00Z",
};
function request(path: string, headers?: HeadersInit) {
  return new NextRequest("https://velocity.test" + path, { headers });
}
function toolPages(directory = "src/app"): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(
    (entry): string[] => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return toolPages(path);
      if (entry.name !== "page.tsx") return [];
      const route = path
        .replace(/^src\/app/, "")
        .replace(/\/\([^/]+\)/g, "")
        .replace(/\/page.tsx$/, "")
        .replace(/\[\[?\.\.\.[^\]]+\]\]?/g, "example/nested")
        .replace(/\[[^\]]+\]/g, "example");
      return route === "/tools" || route.startsWith("/tools/") ? [route] : [];
    },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://backend.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-key");
  mocks.createClient.mockReturnValue({
    auth: { getUser: mocks.getUser, getClaims: mocks.getClaims },
    rpc: mocks.rpc,
  });
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  mocks.rpc.mockResolvedValue({ data: false, error: null });
});

describe("temporary tools lock", () => {
  it.each(toolPages())(
    "blocks signed-out direct access to %s",
    async (path) => {
      expect(
        unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: path }),
      ).toBe(true);
      const response = await proxy(request(path));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "https://velocity.test/login",
      );
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(mocks.getClaims).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      email: "coach@velocity-swimming.com",
      email_confirmed_at: admin.email_confirmed_at,
      app_metadata: { staff: true },
    },
    { ...admin, email_confirmed_at: null },
    { ...admin, is_anonymous: true },
    {
      email: "other@example.test",
      email_confirmed_at: admin.email_confirmed_at,
      user_metadata: { email: admin.email },
    },
  ])(
    "rejects other accounts, unverified identities, and editable metadata: %j",
    async (user) => {
      mocks.getUser.mockResolvedValue({ data: { user }, error: null });
      const response = await proxy(request("/tools/review"));
      expect(response.headers.get("location")).toBe(
        "https://velocity.test/login",
      );
    },
  );

  it("allows only the verified admin and keeps responses private", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: admin }, error: null });
    const response = await proxy(request("/tools/review"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(isToolsAdmin("CHRISTIANCUTTER02@gmail.com", true)).toBe(true);
  });

  it.each([
    "/api/times/moderation",
    "/api/times/team-map",
    "/api/times/manage",

    "/api/data",
    "/api/attendance",
    "/api/workshare",
    "/api/times/import",
  ])("locks the backing endpoint %s", async (path) => {
    expect(
      unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: path }),
    ).toBe(true);
    const response = await proxy(request(path));
    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    mocks.getUser.mockResolvedValue({
      data: { user: { ...admin, email: "other@example.test" } },
      error: null,
    });
    expect((await proxy(request(path))).status).toBe(403);
  });

  it("requires cookie identity for file imports", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: admin }, error: null });
    const response = await proxy(
      request("/api/times/import", {
        authorization: "Bearer admin-token",
      }),
    );
    expect(mocks.getUser).toHaveBeenCalledWith();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("also locks prefetch and React Server Component requests", async () => {
    const response = await proxy(
      request("/tools/times?_rsc=test", {
        rsc: "1",
        "next-router-prefetch": "1",
      }),
    );
    expect(response.status).toBe(307);
  });

  it("fails closed without configuration or when auth fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect((await proxy(request("/tools"))).status).toBe(503);
    expect(mocks.createClient).not.toHaveBeenCalled();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://backend.test");
    mocks.getUser.mockRejectedValue(new Error("Auth unavailable"));
    expect((await proxy(request("/tools/workshare/guest"))).status).toBe(503);
    mocks.getUser.mockResolvedValue({
      data: { user: admin },
      error: new Error("Invalid session"),
    });
    expect((await proxy(request("/api/times"))).status).toBe(401);
  });

  it("preserves refreshed cookies even when access is denied", async () => {
    mocks.createClient.mockImplementation((_url, _key, options) => {
      options.cookies.setAll([
        {
          name: "session",
          value: "refreshed",
          options: { httpOnly: true, path: "/" },
        },
      ]);
      return { auth: { getUser: mocks.getUser } };
    });
    const response = await proxy(request("/tools"));
    expect(response.cookies.get("session")?.value).toBe("refreshed");
  });

  it.each([
    "/",
    "/schedule",
    "/store",
    "/api/calendar",
    "/api/checkout",
    "/api/webhook",
  ])("keeps the public route outside the lock: %s", (path) => {
    expect(
      unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: path }),
    ).toBe(false);
  });

  it.each(["/login", "/auth/callback", "/account"])(
    "keeps auth navigation available: %s",
    async (path) => {
      const response = await proxy(request(path));
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(mocks.getUser).not.toHaveBeenCalled();
      expect(mocks.getClaims).toHaveBeenCalled();
    },
  );
});

const staffUser = { ...admin, email: "approved@example.test" };
const staffIdentity = {
  email: staffUser.email,
  emailVerified: true,
  staff: true,
};
const staffPaths = [
  "/tools/admin",
  "/tools/admin/tickets",
  "/api/workshare/accounts",
  "/api/workshare/accounts/example",
  "/api/workshare/seasons",
  "/api/workshare/tickets/example/credits",
];

describe("scoped staff Admin access", () => {
  it("keeps domain Admin authority separate from broad staff capabilities", () => {
    const domainIdentity = {
      email: "coach@velocity-swimming.com",
      emailVerified: true,
      staff: false,
      workshareStaff: true,
    };
    expect(getToolsCapabilities(domainIdentity)).toEqual({
      signedIn: true,
      allTools: false,
      staff: true,
    });
    expect(canAccessToolsPath("/tools/admin", domainIdentity)).toBe(true);
    expect(canAccessToolsPath("/tools", domainIdentity)).toBe(true);
    expect(canAccessToolsPath("/tools/review", domainIdentity)).toBe(false);
    expect(canAccessToolsPath("/api/times", domainIdentity)).toBe(true);
    expect(getToolsSignInDestination(domainIdentity)).toBe("/tools");
    expect(
      getToolsCapabilities({ ...domainIdentity, emailVerified: false }).staff,
    ).toBe(false);
    // Client navigation waits for database authority, never the email suffix alone.
    expect(
      getToolsCapabilities({ ...domainIdentity, workshareStaff: false }).staff,
    ).toBe(false);
  });

  it("requires the scoped database authority even for a verified domain email", async () => {
    const user = { ...admin, email: "coach@velocity-swimming.com" };
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    expect((await proxy(request("/tools/admin"))).status).toBe(307);
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    expect(
      (await proxy(request("/tools/admin"))).headers.get("x-middleware-next"),
    ).toBe("1");
    expect((await proxy(request("/api/times"))).status).toBe(200);
  });

  it.each(staffPaths)("allows approved verified staff at %s", async (path) => {
    mocks.getUser.mockResolvedValue({ data: { user: staffUser }, error: null });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const response = await proxy(request(path));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("is_workshare_staff");
    expect(canAccessToolsPath(path, staffIdentity)).toBe(true);
  });

  it.each([
    "/tools/review",
    "/tools/admin-other",
    "/tools/goals",
    "/tools/team-map",
    "/api/times/manage",
    "/api/workshare",
    "/api/workshare/accounts-other",
    "/api/workshare/tickets-other",
    "/api/workshare/seasons-other",
  ])(
    "keeps other tools and misleading prefixes restricted: %s",
    async (path) => {
      mocks.getUser.mockResolvedValue({
        data: { user: staffUser },
        error: null,
      });
      mocks.rpc.mockResolvedValue({ data: true, error: null });
      const response = await proxy(request(path));
      expect(response.status).toBe(path.startsWith("/api/") ? 403 : 307);
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(canAccessToolsPath(path, staffIdentity)).toBe(false);
    },
  );

  it.each([
    { ...staffUser, email_confirmed_at: null },
    { ...staffUser, is_anonymous: true },
  ])(
    "rejects unverified or anonymous identities even if a role is present",
    async (user) => {
      mocks.getUser.mockResolvedValue({ data: { user }, error: null });
      mocks.rpc.mockResolvedValue({ data: true, error: null });
      expect((await proxy(request("/api/workshare/accounts"))).status).toBe(
        403,
      );
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it("rejects unapproved users and editable metadata", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          ...staffUser,
          user_metadata: { staff: true },
          app_metadata: { staff: true },
        },
      },
      error: null,
    });
    expect((await proxy(request("/api/workshare/accounts"))).status).toBe(403);
  });

  it("fails closed on staff RPC failures", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: staffUser }, error: null });
    mocks.rpc.mockResolvedValue({
      data: true,
      error: new Error("Unavailable"),
    });
    expect((await proxy(request("/api/workshare/accounts"))).status).toBe(503);
    mocks.rpc.mockRejectedValue(new Error("Unavailable"));
    expect((await proxy(request("/tools/admin"))).status).toBe(503);
  });

  it("checks staff APIs with cookie identity without borrowing role from a bearer lookup", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: staffUser }, error: null });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    expect(
      (
        await proxy(
          request("/api/workshare/accounts", {
            authorization: "Bearer somebody-else",
          }),
        )
      ).headers.get("x-middleware-next"),
    ).toBe("1");
    expect(mocks.getUser).toHaveBeenCalledWith();
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(
      (
        await proxy(
          request("/api/workshare/accounts", {
            authorization: "Bearer staff-token",
          }),
        )
      ).status,
    ).toBe(401);
  });

  it("uses verified staff only for Admin capabilities and sign-in landing", () => {
    expect(getToolsCapabilities(staffIdentity)).toEqual({
      signedIn: true,
      allTools: false,
      staff: true,
    });
    expect(getToolsHome(staffIdentity)).toBe("/tools");
    expect(getToolsSignInDestination(staffIdentity)).toBe("/tools");
    expect(
      getToolsSignInDestination(staffIdentity, "/tools/review?batch=123"),
    ).toBe("/tools");
    expect(
      getToolsSignInDestination(
        staffIdentity,
        "/tools?account-link=success",
        true,
      ),
    ).toBe("/tools?account-link=success");
    expect(getToolsSignInDestination(staffIdentity, "/schedule")).toBe(
      "/schedule",
    );
    expect(getToolsHome({ ...staffIdentity, emailVerified: false })).toBe(
      "/login",
    );
    expect(getToolsHome({ ...staffIdentity, staff: false })).toBe("/tools");
    expect(getToolsHome(null)).toBe("/login");
    expect(getToolsHome({ ...staffIdentity, email: admin.email })).toBe(
      "/tools",
    );
  });
});

describe("released tools for any verified email", () => {
  const member = {
    email: "new@example.test",
    emailVerified: true,
    staff: false,
  };
  it.each([
    "/tools",
    "/tools/my-times",
    "/tools/rankings",
    "/tools/records",
    "/tools/standards",
    "/api/times",
  ])("allows %s without staff approval", async (path) => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          email: member.email,
          email_confirmed_at: admin.email_confirmed_at,
        },
      },
      error: null,
    });
    expect((await proxy(request(path))).status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(canAccessToolsPath(path, member)).toBe(true);
  });
  it.each([
    "/tools/review",
    "/tools/review/held-observations",
    "/tools/goals",
    "/tools/team-map",
    "/api/times/team-map",
    "/api/times/import",
  ])("restricts %s to the owner even for staff", async (path) => {
    mocks.getUser.mockResolvedValue({ data: { user: staffUser }, error: null });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    expect((await proxy(request(path))).status).toBe(
      path.startsWith("/api/") ? 403 : 307,
    );
    expect(canAccessToolsPath(path, staffIdentity)).toBe(false);
    expect(canAccessToolsPath(path, { ...member, email: admin.email })).toBe(
      true,
    );
  });
});
