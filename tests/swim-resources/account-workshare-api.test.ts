import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  serverClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }),
}));
import { GET } from "@/app/api/account/workshare/route";

const seasonId = "a67712e9-86a7-4e3c-804d-35be264c48fd";
function request(query = "") {
  return new Request(`https://velocity.example/api/account/workshare${query}`);
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "self", email_confirmed_at: "2026-11-18T00:00:00Z" } },
    error: null,
  });
  mocks.rpc.mockResolvedValue({ data: { seasons: [], seasonId: null, accounts: [] }, error: null });
});

describe("own-account Workshare summary API", () => {
  it("uses only the cookie identity and requests a private self-scoped summary", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getUser).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("read_my_workshare_summary", {});
    expect(await response.json()).toEqual({ data: { seasons: [], seasonId: null, accounts: [] } });
  });

  it("allows an explicit season without passing any claimed account identity", async () => {
    expect((await GET(request(`?seasonId=${seasonId}`))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("read_my_workshare_summary", { season_id: seasonId });
  });

  it.each([
    "?accountId=other", "?email=other@example.test", "?seasonId=invalid",
    `?seasonId=${seasonId}&seasonId=${seasonId}`, "?seasonId=",
  ])("rejects invalid scope/filter input %s", async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { id: "self", email_confirmed_at: null, user_metadata: { email_verified: true } },
    { id: "self", email_confirmed_at: "2026-11-18T00:00:00Z", is_anonymous: true },
  ])("rejects unverified or anonymous accounts before reading data", async (user) => {
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects signed-out and invalid sessions", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await GET(request())).status).toBe(401);
    mocks.getUser.mockResolvedValue({ data: { user: { id: "self" } }, error: new Error("Bad token") });
    expect((await GET(request())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([["42501", 403], ["P0002", 404], ["XX000", 503]])(
    "maps database errors without exposing private error detail: %s", async (code, status) => {
      mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "private database detail" } });
      const response = await GET(request());
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.text()).not.toContain("private database detail");
    },
  );

  it("handles an authentication outage without leaking errors", async () => {
    mocks.getUser.mockRejectedValue(new Error("private infrastructure error"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("infrastructure");
  });
});
