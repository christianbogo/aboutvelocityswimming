import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  serverClient: async () => ({ auth: mocks, rpc: mocks.rpc }),
}));
import { GET } from "@/app/auth/callback/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
  mocks.getUser.mockResolvedValue({
    data: {
      user: {
        email: "christiancutter02@gmail.com",
        email_confirmed_at: "2026-11-18T00:00:00Z",
      },
    },
    error: null,
  });
  mocks.rpc.mockResolvedValue({ data: false, error: null });
});

describe("account linking callback", () => {
  it("returns a successful Google sign-in to tools after exchanging its code", async () => {
    const response = await GET(
      new Request(
        "https://velocity.example/auth/callback?code=google-code&next=%2Ftools",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://velocity.example/tools",
    );
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith(
      "google-code",
    );
  });
  it("returns a failed Google sign-in to login with an error", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      error: new Error("expired code"),
    });
    const response = await GET(
      new Request(
        "https://velocity.example/auth/callback?code=expired&next=%2Ftools",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://velocity.example/login?error=callback",
    );
  });
  it("returns cancelled Google sign-in to login without exchanging a code", async () => {
    const response = await GET(
      new Request(
        "https://velocity.example/auth/callback?error=access_denied&error_description=Cancelled",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://velocity.example/login?error=callback",
    );
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });
  it("preserves the account page after successful identity linking", async () => {
    const response = await GET(
      new Request(
        "https://velocity.example/auth/callback?code=test-code&flow=link&next=%2Ftools",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://velocity.example/tools",
    );
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("test-code");
  });
  it("returns linking failures to account management with an error", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      error: new Error("invalid code"),
    });
    const response = await GET(
      new Request("https://velocity.example/auth/callback?code=bad&flow=link"),
    );
    expect(response.headers.get("location")).toBe(
      "https://velocity.example/tools?account-link=error",
    );
  });
  it("keeps a cancelled linking flow on account management", async () => {
    const response = await GET(
      new Request(
        "https://velocity.example/auth/callback?flow=link&error=access_denied",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://velocity.example/tools?account-link=error",
    );
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });
  it.each([
    "https://outside.example",
    "//outside.example",
    "/\\outside.example",
    "/\t/outside.example",
  ])("does not redirect outside the site for next=%s", async (next) => {
    const response = await GET(
      new Request(
        `https://velocity.example/auth/callback?code=test-code&next=${encodeURIComponent(next)}`,
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://velocity.example/tools",
    );
  });
});

describe("staff OAuth landing", () => {
  it("lands domain staff on Admin while preserving account-link returns", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          email: "coach@velocity-swimming.com",
          email_confirmed_at: "2026-11-18T00:00:00Z",
        },
      },
      error: null,
    });
    mocks.rpc.mockImplementation(async (name: string) => ({
      data: name === "is_workshare_staff",
      error: null,
    }));
    const response = await GET(
      new Request(
        "https://velocity.example/auth/callback?code=domain-code&next=%2Ftools",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://velocity.example/tools",
    );
    const linking = await GET(
      new Request(
        "https://velocity.example/auth/callback?code=domain-code&flow=link&next=%2Ftools",
      ),
    );
    expect(linking.headers.get("location")).toBe(
      "https://velocity.example/tools",
    );
  });
  beforeEach(() => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          email: "approved@example.test",
          email_confirmed_at: "2026-11-18T00:00:00Z",
        },
      },
      error: null,
    });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
  });
  it.each(["/tools", "/tools/review", "/tools/rankings?event=50free"])(
    "lands staff on Admin after sign-in instead of %s",
    async (next) => {
      const response = await GET(
        new Request(
          `https://velocity.example/auth/callback?code=staff-code&next=${encodeURIComponent(next)}`,
        ),
      );
      expect(response.headers.get("location")).toBe(
        "https://velocity.example" +
          (next.startsWith("/tools/rankings") ? next : "/tools"),
      );
      expect(mocks.rpc).toHaveBeenCalledWith("is_workshare_staff");
    },
  );
  it("preserves account settings when staff link an identity", async () => {
    const response = await GET(
      new Request(
        "https://velocity.example/auth/callback?code=staff-code&flow=link&next=%2Ftools",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://velocity.example/tools",
    );
  });
  it("preserves an explicit safe public destination", async () => {
    const response = await GET(
      new Request(
        "https://velocity.example/auth/callback?code=staff-code&next=%2Fschedule",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://velocity.example/schedule",
    );
  });
  it("does not grant unapproved users or unverified staff tool access", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(
      (
        await GET(
          new Request("https://velocity.example/auth/callback?code=code"),
        )
      ).headers.get("location"),
    ).toBe("https://velocity.example/tools");
    mocks.getUser.mockResolvedValue({
      data: {
        user: { email: "approved@example.test", email_confirmed_at: null },
      },
      error: null,
    });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    expect(
      (
        await GET(
          new Request("https://velocity.example/auth/callback?code=code"),
        )
      ).headers.get("location"),
    ).toBe("https://velocity.example/login");
  });
  it("fails closed when identity or staff verification is unavailable", async () => {
    mocks.rpc.mockResolvedValue({
      data: true,
      error: new Error("Unavailable"),
    });
    expect(
      (
        await GET(
          new Request("https://velocity.example/auth/callback?code=code"),
        )
      ).headers.get("location"),
    ).toBe("https://velocity.example/login?error=callback");
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error("Unavailable"),
    });
    expect(
      (
        await GET(
          new Request("https://velocity.example/auth/callback?code=code"),
        )
      ).headers.get("location"),
    ).toBe("https://velocity.example/login?error=callback");
  });
});
