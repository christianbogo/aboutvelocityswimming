import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ exchangeCodeForSession: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ serverClient: async () => ({ auth: mocks }) }));
import { GET } from "@/app/auth/callback/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
});

describe("account linking callback", () => {
  it("preserves the account page after successful identity linking", async () => {
    const response = await GET(new Request("https://velocity.example/auth/callback?code=test-code&flow=link&next=%2Ftools"));
    expect(response.headers.get("location")).toBe("https://velocity.example/tools");
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("test-code");
  });
  it("returns linking failures to account management with an error", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: new Error("invalid code") });
    const response = await GET(new Request("https://velocity.example/auth/callback?code=bad&flow=link"));
    expect(response.headers.get("location")).toBe("https://velocity.example/tools?account-link=error");
  });
  it.each(["https://outside.example", "//outside.example", "/\\outside.example", "/\t/outside.example"])(
    "does not redirect outside the site for next=%s", async (next) => {
      const response = await GET(new Request(`https://velocity.example/auth/callback?code=test-code&next=${encodeURIComponent(next)}`));
      expect(response.headers.get("location")).toBe("https://velocity.example/tools");
    },
  );
});
