import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  linkIdentity: vi.fn(), signInWithOAuth: vi.fn(), registerPasskey: vi.fn(), signInWithPasskey: vi.fn(),
  getUserIdentities: vi.fn(), list: vi.fn(), release: vi.fn(), addEventListener: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  browserClient: () => ({ auth: { ...mocks, passkey: { list: mocks.list } } }),
}));
vi.mock("@/lib/update-safety", () => ({
  holdUpdates: () => mocks.release,
  withUpdateHold: (fn: () => Promise<unknown>) => fn(),
}));
import {
  accountSecurityError, createAccountPasskey, linkAccountProvider,
  loadAccountIdentities, loadAccountPasskeys, signInWithAccountPasskey, signInWithAccountProvider,
} from "@/lib/account-security";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", {
    location: { origin: "https://velocity.example" }, isSecureContext: true,
    PublicKeyCredential: class {}, addEventListener: mocks.addEventListener,
  });
  vi.stubGlobal("navigator", { credentials: { create: vi.fn() } });
  mocks.linkIdentity.mockResolvedValue({ data: { url: "https://provider.example/authorize" }, error: null });
  mocks.signInWithOAuth.mockResolvedValue({ data: { url: "https://provider.example/authorize" }, error: null });
});
afterEach(() => vi.unstubAllGlobals());

describe("account sign-in linking", () => {
  it.each(["google", "apple", "azure"] as const)("uses OAuth sign-in for a returning %s user", async (provider) => {
    await signInWithAccountProvider(provider);
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({
      provider, options: expect.objectContaining({
        redirectTo: "https://velocity.example/auth/callback?next=%2Ftools",
      }),
    }));
    expect(mocks.linkIdentity).not.toHaveBeenCalled();
  });
  it("links the provider to the current account and returns through the account callback", async () => {
    await linkAccountProvider("azure");
    expect(mocks.linkIdentity).toHaveBeenCalledWith({
      provider: "azure", options: {
        scopes: "email",
        redirectTo: "https://velocity.example/auth/callback?next=%2Ftools&flow=link",
      },
    });
    expect(mocks.release).not.toHaveBeenCalled();
    const onPageShow = mocks.addEventListener.mock.calls[0][1];
    onPageShow();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("releases the update hold on backend rejection instead of claiming a linked identity", async () => {
    const error = { code: "manual_linking_disabled" };
    mocks.linkIdentity.mockResolvedValue({ data: {}, error });
    await expect(linkAccountProvider("google")).rejects.toEqual(error);
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("does not report success when the provider returns no redirect", async () => {
    mocks.linkIdentity.mockResolvedValue({ data: { url: null }, error: null });
    await expect(linkAccountProvider("apple")).rejects.toThrow("did not return a link");
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("does not interpret a failed identity lookup as an empty linked account list", async () => {
    mocks.getUserIdentities.mockResolvedValue({ data: null, error: new Error("offline") });
    await expect(loadAccountIdentities()).rejects.toThrow("offline");
  });
});

describe("native passkeys", () => {
  it("returns the server-verified passkey only after registration succeeds", async () => {
    const key = { id: "key-1", friendly_name: "Password manager", created_at: "2026-11-16T12:00:00Z" };
    const signal = new AbortController().signal;
    mocks.registerPasskey.mockResolvedValue({ data: key, error: null });
    await expect(createAccountPasskey(signal)).resolves.toEqual(key);
    expect(mocks.registerPasskey).toHaveBeenCalledWith({ options: { signal } });
    mocks.registerPasskey.mockResolvedValue({ data: null, error: new Error("verification failed") });
    await expect(createAccountPasskey()).rejects.toThrow("verification failed");
  });
  it("keeps disabled passkeys distinct from an empty passkey list", async () => {
    const error = { code: "passkey_disabled" };
    mocks.list.mockResolvedValue({ data: null, error });
    await expect(loadAccountPasskeys()).rejects.toEqual(error);
    expect(accountSecurityError(error, "fallback")).toContain("not available yet");
  });
  it("rejects unsupported or insecure browsers before creating credentials", async () => {
    vi.stubGlobal("window", { isSecureContext: false, PublicKeyCredential: class {} });
    await expect(createAccountPasskey()).rejects.toThrow("passkey_browser_unsupported");
    expect(mocks.registerPasskey).not.toHaveBeenCalled();
  });
  it("requires a confirmed session for passkey sign-in success", async () => {
    mocks.signInWithPasskey.mockResolvedValue({ data: { session: null }, error: null });
    await expect(signInWithAccountPasskey()).rejects.toThrow("could not be confirmed");
    mocks.signInWithPasskey.mockResolvedValue({ data: { session: { access_token: "test-session" } }, error: null });
    await expect(signInWithAccountPasskey()).resolves.toBeUndefined();
  });
  it("shows actionable cancellation feedback without leaking raw backend errors", () => {
    expect(accountSecurityError({ code: "ERROR_CEREMONY_ABORTED" }, "fallback")).toContain("cancelled");
    expect(accountSecurityError({ code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", cause: new DOMException("cancelled", "NotAllowedError") }, "fallback")).toContain("cancelled");
    expect(accountSecurityError({ code: "ERROR_INVALID_RP_ID" }, "fallback")).toContain("not available on this address");
    expect(accountSecurityError(new Error("sensitive upstream detail"), "Please try again.")).toBe("Please try again.");
  });
});
