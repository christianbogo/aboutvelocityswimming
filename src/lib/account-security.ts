import type { PasskeyListItem, UserIdentity } from "@supabase/supabase-js";
import { browserClient } from "./supabase/client";
import { holdUpdates, withUpdateHold } from "./update-safety";

export const accountProviders = [
  { id: "google", name: "Google" },
] as const;
export type AccountProvider = (typeof accountProviders)[number]["id"];
export type AccountPasskey = PasskeyListItem;
export type AccountIdentity = Pick<
  UserIdentity,
  "id" | "provider" | "identity_data"
>;
export const configuredSignInProviders = accountProviders.filter(
  () => process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true",
);

export function supportsPasskeys() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator.credentials?.create === "function"
  );
}

export async function loadAccountIdentities(): Promise<AccountIdentity[]> {
  const { data, error } = await browserClient().auth.getUserIdentities();
  if (error) throw error;
  return data.identities;
}

export async function loadAccountPasskeys(): Promise<AccountPasskey[]> {
  const { data, error } = await browserClient().auth.passkey.list();
  if (error) throw error;
  return data;
}

async function redirectToProvider(provider: AccountProvider, link: boolean) {
  const release = holdUpdates();
  try {
    const auth = browserClient().auth;
    const credentials = {
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/tools")}${link ? "&flow=link" : ""}`,
        queryParams: { prompt: "select_account" },
      },
    };
    const { data, error } = await (link
      ? auth.linkIdentity(credentials)
      : auth.signInWithOAuth(credentials));
    if (error) throw error;
    if (!data.url)
      throw new Error("The sign-in provider did not return a link.");
    // Keep refresh blocked until OAuth takes the user away from the page.
    window.addEventListener("pageshow", release, { once: true });
  } catch (error) {
    release();
    throw error;
  }
}

export function linkAccountProvider(provider: AccountProvider) {
  return redirectToProvider(provider, true);
}

export function signInWithAccountProvider(provider: AccountProvider) {
  return redirectToProvider(provider, false);
}

export async function saveAccountPassword(password: string) {
  if (password.length < 8)
    throw new Error("Use at least 8 characters for your password.");
  return withUpdateHold(async () => {
    const { data, error } = await browserClient().auth.updateUser({ password });
    if (error) throw error;
    if (!data.user)
      throw new Error("Your password could not be saved. Please sign in again.");
  });
}

export async function createAccountPasskey(
  signal?: AbortSignal,
): Promise<AccountPasskey> {
  if (!supportsPasskeys()) throw new Error("passkey_browser_unsupported");
  return withUpdateHold(async () => {
    const { data, error } = await browserClient().auth.registerPasskey({
      options: { signal },
    });
    if (error) throw error;
    if (!data) throw new Error("Passkey creation could not be confirmed.");
    return data;
  });
}

export async function signInWithAccountPasskey(signal?: AbortSignal) {
  if (!supportsPasskeys()) throw new Error("passkey_browser_unsupported");
  return withUpdateHold(async () => {
    const { data, error } = await browserClient().auth.signInWithPasskey({
      options: { signal },
    });
    if (error) throw error;
    if (!data?.session)
      throw new Error("Passkey sign-in could not be confirmed.");
  });
}

export function accountSecurityError(error: unknown, fallback: string): string {
  const code =
    error && typeof error === "object" && "code" in error ? error.code : "";
  const message = error instanceof Error ? error.message : "";
  if (code === "passkey_disabled")
    return "Passkeys are not available yet. Please use another sign-in option.";
  if (
    code === "manual_linking_disabled" ||
    code === "provider_disabled" ||
    code === "unsupported_provider"
  ) {
    return "This sign-in option is not available yet. Please try another option.";
  }
  if (
    code === "identity_already_exists" ||
    code === "identity_already_linked"
  ) {
    return "This sign-in is already linked to an account. Try a different account with this provider.";
  }
  if (code === "email_not_confirmed")
    return "Verify your email before creating a passkey.";
  if (code === "weak_password")
    return "Choose a stronger password with at least 8 characters, including uppercase and lowercase letters, numbers, and symbols.";
  if (code === "same_password")
    return "Choose a different password from your current password.";
  if (code === "reauthentication_needed" || code === "reauthentication_not_valid")
    return "Please sign out and sign in again with Google or an email code, then save your password.";
  if (code === "too_many_passkeys")
    return "You have reached the limit for passkeys on this account.";
  if (
    code === "webauthn_credential_exists" ||
    code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED"
  ) {
    return "This passkey is already registered. Try another device or password manager.";
  }
  if (code === "ERROR_INVALID_DOMAIN" || code === "ERROR_INVALID_RP_ID") {
    return "Passkeys are not available on this address. Open Velocity at its usual web address and try again.";
  }
  const cause =
    error && typeof error === "object" && "cause" in error
      ? error.cause
      : undefined;
  if (
    code === "ERROR_CEREMONY_ABORTED" ||
    (cause instanceof Error && cause.name === "NotAllowedError") ||
    (error instanceof Error && error.name === "NotAllowedError")
  ) {
    return "The passkey request was cancelled or timed out. Please try again when you’re ready.";
  }
  if (message === "passkey_browser_unsupported") {
    return "Passkeys are not supported in this browser or on this address. Try a supported browser on a secure connection.";
  }
  return fallback;
}
