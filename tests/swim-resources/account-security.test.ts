import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  linkIdentity: vi.fn(), signInWithOAuth: vi.fn(), registerPasskey: vi.fn(), signInWithPasskey: vi.fn(),
  getUserIdentities: vi.fn(), updateUser: vi.fn(), list: vi.fn(), release: vi.fn(), addEventListener: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  browserClient: () => ({ auth: { ...mocks, passkey: { list: mocks.list } } }),
}));
vi.mock("@/lib/update-safety", () => ({
  holdUpdates: () => mocks.release,
  withUpdateHold: (fn: () => Promise<unknown>) => fn(),
}));
import {
  accountProviders, accountSecurityError, createAccountPasskey, linkAccountProvider, saveAccountPassword,
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
  it("offers only Google as a linked OAuth sign-in", () => {
    expect(accountProviders).toEqual([{ id: "google", name: "Google" }]);
  });
  it("uses Google OAuth sign-in for a returning user without initiating a link", async () => {
    await signInWithAccountProvider("google");
    expect(mocks.signInWithOAuth).toHaveBeenCalledExactlyOnceWith({
      provider: "google", options: {
        redirectTo: "https://velocity.example/auth/callback?next=%2Ftools",
        queryParams: { prompt: "select_account" },
      },
    });
    expect(mocks.linkIdentity).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.addEventListener).toHaveBeenCalledWith("pageshow", mocks.release, { once: true });
  });
  it("links Google to the current account and returns through the account callback", async () => {
    await linkAccountProvider("google");
    expect(mocks.linkIdentity).toHaveBeenCalledExactlyOnceWith({
      provider: "google", options: {
        redirectTo: "https://velocity.example/auth/callback?next=%2Ftools&flow=link",
        queryParams: { prompt: "select_account" },
      },
    });
    expect(mocks.signInWithOAuth).not.toHaveBeenCalled();
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
    await expect(linkAccountProvider("google")).rejects.toThrow("did not return a link");
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("releases the update hold when Google sign-in is rejected", async () => {
    const error = { code: "provider_disabled" };
    mocks.signInWithOAuth.mockResolvedValue({ data: {}, error });
    await expect(signInWithAccountProvider("google")).rejects.toEqual(error);
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("requires a redirect before treating Google sign-in as started", async () => {
    mocks.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: null });
    await expect(signInWithAccountProvider("google")).rejects.toThrow("did not return a link");
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("does not interpret a failed identity lookup as an empty linked account list", async () => {
    mocks.getUserIdentities.mockResolvedValue({ data: null, error: new Error("offline") });
    await expect(loadAccountIdentities()).rejects.toThrow("offline");
  });
});

describe("account password", () => {
  it("sets a password on the authenticated account without changing profile or identity data", async () => {
    mocks.updateUser.mockResolvedValue({ data: { user: { id: "current-account" } }, error: null });
    await expect(saveAccountPassword("Test-only password 42!")).resolves.toBeUndefined();
    expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({ password: "Test-only password 42!" });
  });
  it("rejects short passwords before contacting the backend", async () => {
    await expect(saveAccountPassword("short")).rejects.toThrow("at least 8 characters");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
  it("does not claim a password was saved after backend rejection or a missing user", async () => {
    const error = { code: "reauthentication_needed" };
    mocks.updateUser.mockResolvedValue({ data: { user: null }, error });
    await expect(saveAccountPassword("Test-only password 42!")).rejects.toEqual(error);
    expect(accountSecurityError(error, "fallback")).toContain("sign in again");
    mocks.updateUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(saveAccountPassword("Test-only password 42!")).rejects.toThrow("could not be saved");
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
