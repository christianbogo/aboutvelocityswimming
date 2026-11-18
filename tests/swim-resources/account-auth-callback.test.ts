import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ exchangeCodeForSession: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ serverClient: async () => ({ auth: mocks }) }));
import { GET } from "@/app/auth/callback/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
});

describe("account linking callback", () => {
  it("returns a successful Google sign-in to tools after exchanging its code", async () => {
    const response = await GET(new Request("https://velocity.example/auth/callback?code=google-code&next=%2Ftools"));
    expect(response.headers.get("location")).toBe("https://velocity.example/tools");
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith("google-code");
  });
  it("returns a failed Google sign-in to login with an error", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: new Error("expired code") });
    const response = await GET(new Request("https://velocity.example/auth/callback?code=expired&next=%2Ftools"));
    expect(response.headers.get("location")).toBe("https://velocity.example/login?error=callback");
  });
  it("returns cancelled Google sign-in to login without exchanging a code", async () => {
    const response = await GET(new Request("https://velocity.example/auth/callback?error=access_denied&error_description=Cancelled"));
    expect(response.headers.get("location")).toBe("https://velocity.example/login?error=callback");
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });
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
  it("keeps a cancelled linking flow on account management", async () => {
    const response = await GET(new Request("https://velocity.example/auth/callback?flow=link&error=access_denied"));
    expect(response.headers.get("location")).toBe("https://velocity.example/tools?account-link=error");
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });
  it.each(["https://outside.example", "//outside.example", "/\\outside.example", "/\t/outside.example"])(
    "does not redirect outside the site for next=%s", async (next) => {
      const response = await GET(new Request(`https://velocity.example/auth/callback?code=test-code&next=${encodeURIComponent(next)}`));
      expect(response.headers.get("location")).toBe("https://velocity.example/tools");
    },
  );
});
