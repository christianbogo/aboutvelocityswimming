import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  serverClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
  }),
}));
import { GET } from "@/app/api/times/team/route";
import { canAccessToolsPath } from "@/lib/tools-access";
const request = (query = "") =>
  new Request(`https://example.test/api/times/team${query}`);
beforeEach(() => vi.resetAllMocks());
it("allows the released page and endpoint for verified members", () => {
  const user = {
    email: "member@example.test",
    emailVerified: true,
    staff: false,
  };
  expect(canAccessToolsPath("/tools/team", user)).toBe(true);
  expect(canAccessToolsPath("/api/times/team", user)).toBe(true);
  expect(canAccessToolsPath("/api/times/team", null)).toBe(false);
});
it("authenticates before reading and rejects unverified and anonymous users", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  expect((await GET(request())).status).toBe(401);
  for (const user of [
    { email_confirmed_at: null },
    { email_confirmed_at: "today", is_anonymous: true },
  ]) {
    mocks.getUser.mockResolvedValue({ data: { user } });
    expect((await GET(request())).status).toBe(403);
  }
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("validates meets, keeps member data private, and hides database errors", async () => {
  expect((await GET(request("?meet="))).status).toBe(400);
  mocks.getUser.mockResolvedValue({
    data: { user: { email_confirmed_at: "today" } },
  });
  mocks.rpc.mockResolvedValue({ data: { roster: [] } });
  const response = await GET(request("?meet=abc"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.rpc).toHaveBeenCalledWith("team_dashboard_view", {
    selected_meet: "abc",
    meet_only: false,
  });
  mocks.rpc.mockResolvedValue({ error: { message: "internal details" } });
  const failed = await GET(request());
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain("internal details");
});

it("requests only meet data for a meet switch and validates the scope", async () => {
  expect((await GET(request("?scope=invalid"))).status).toBe(400);
  expect((await GET(request("?scope=meet"))).status).toBe(400);
  mocks.getUser.mockResolvedValue({
    data: { user: { email_confirmed_at: "today" } },
  });
  mocks.rpc.mockResolvedValue({ data: { meet: null, before: [], swims: [] } });
  expect((await GET(request("?scope=meet&meet=abc"))).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("team_dashboard_view", {
    selected_meet: "abc",
    meet_only: true,
  });
});
