"use client";

import {
  Check,
  Fingerprint,
  KeyRound,
  Link2,
  LoaderCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useUpdateBlocker } from "@/hooks/useUpdateBlocker";
import {
  accountProviders,
  accountSecurityError,
  createAccountPasskey,
  linkAccountProvider,
  loadAccountIdentities,
  loadAccountPasskeys,
  supportsPasskeys,
  type AccountIdentity,
  type AccountPasskey,
  type AccountProvider,
} from "@/lib/account-security";
import { Button } from "./Button";
import AccountPassword from "./AccountPassword";

export default function AccountSignInMethods({
  userId,
  emailVerified,
}: {
  userId: string;
  emailVerified: boolean;
}) {
  const [identities, setIdentities] = useState<AccountIdentity[]>();
  const [passkeys, setPasskeys] = useState<AccountPasskey[]>();
  const [identityError, setIdentityError] = useState("");
  const [passkeyError, setPasskeyError] = useState("");
  const [actionError, setActionError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState<AccountProvider | "passkey" | null>(null);
  const [supported, setSupported] = useState<boolean>();
  const [attempt, setAttempt] = useState(0);
  const action = useRef<AbortController | null>(null);
  useUpdateBlocker(busy !== null);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      loadAccountIdentities(),
      loadAccountPasskeys(),
    ]).then(([linked, keys]) => {
      if (!active) return;
      setSupported(supportsPasskeys());
      if (linked.status === "fulfilled") {
        setIdentities(linked.value);
        setIdentityError("");
      } else {
        setIdentityError(
          "Your linked sign-ins couldn’t be loaded. Please try again.",
        );
      }
      if (keys.status === "fulfilled") {
        setPasskeys(keys.value);
        setPasskeyError("");
      } else {
        setPasskeyError(
          accountSecurityError(
            keys.reason,
            "Your passkeys couldn’t be loaded. Please try again.",
          ),
        );
      }
      const params = new URLSearchParams(window.location.search);
      if (params.get("account-link") === "error") {
        setActionError("The sign-in option wasn’t linked. Please try again.");
      }
    });
    return () => {
      active = false;
      action.current?.abort();
    };
  }, [userId, attempt]);

  async function link(provider: AccountProvider) {
    if (busy) return;
    setBusy(provider);
    setActionError("");
    setSuccess("");
    try {
      await linkAccountProvider(provider);
    } catch (error) {
      setActionError(
        accountSecurityError(
          error,
          "This sign-in option couldn’t be linked. Please try again.",
        ),
      );
      setBusy(null);
    }
  }

  async function createPasskey() {
    if (busy) return;
    const controller = new AbortController();
    action.current = controller;
    setBusy("passkey");
    setActionError("");
    setSuccess("");
    try {
      const passkey = await createAccountPasskey(controller.signal);
      if (controller.signal.aborted) return;
      setPasskeys((current) => [...(current ?? []), passkey]);
      setPasskeyError("");
      setSuccess("Passkey created. You can now use it to sign in.");
    } catch (error) {
      if (!controller.signal.aborted) {
        setActionError(
          accountSecurityError(
            error,
            "Your passkey couldn’t be created. Please try again.",
          ),
        );
      }
    } finally {
      if (!controller.signal.aborted) setBusy(null);
      if (action.current === controller) action.current = null;
    }
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-text-primary">
        Sign-in methods
      </h2>
      <p className="mt-1 text-sm text-text-secondary">
        Link another way to sign in to the same Velocity account.
      </p>
      <div className="mt-4 grid max-w-sm gap-3">
        {accountProviders.map((provider) => {
          const linked = identities?.find(
            (identity) => identity.provider === provider.id,
          );
          return (
            <Button
              key={provider.id}
              type="button"
              variant="outline"
              className="h-auto min-h-12 justify-between gap-3 py-3"
              disabled={busy !== null || !identities || Boolean(linked)}
              onClick={() => void link(provider.id)}
              aria-label={
                linked ? `${provider.name} linked` : `Link ${provider.name}`
              }
            >
              <span>{provider.name}</span>
              <span className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                {busy === provider.id ? (
                  <LoaderCircle
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : linked ? (
                  <Check className="size-4 text-accent" aria-hidden="true" />
                ) : (
                  <Link2 className="size-4" aria-hidden="true" />
                )}
                {linked ? "Linked" : busy === provider.id ? "Linking…" : "Link"}
              </span>
            </Button>
          );
        })}
      </div>
      <p className="mt-3 max-w-sm text-xs leading-relaxed text-text-secondary">
        Linking Google shares your basic profile and email to identify this
        account.{" "}
        <Link href="/privacy#google-user-data" className="underline">
          Google data use, access revocation, and deletion
        </Link>
        .
      </p>
      {!identities && !identityError && (
        <p className="mt-2 text-xs text-text-secondary" role="status">
          Loading linked sign-ins…
        </p>
      )}
      {identityError && (
        <p className="mt-3 text-sm text-text-secondary" role="alert">
          {identityError}
        </p>
      )}
      <AccountPassword emailVerified={emailVerified} />
      <div className="mt-5 rounded-xl border border-border bg-bg/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Fingerprint
              className="mt-0.5 size-5 shrink-0 text-accent"
              aria-hidden="true"
            />
            <div>
              <h3 className="text-sm font-semibold">Passkeys</h3>
              <p className="mt-1 text-sm text-text-secondary">
                Sign in with your fingerprint, face, or device PIN.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy !== null || supported !== true || !emailVerified}
            onClick={() => void createPasskey()}
          >
            {busy === "passkey" ? (
              <LoaderCircle
                className="mr-2 size-4 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <KeyRound className="mr-2 size-4" aria-hidden="true" />
            )}
            {busy === "passkey" ? "Creating passkey…" : "Create passkey"}
          </Button>
        </div>
        {!emailVerified && (
          <p className="mt-3 text-xs text-text-secondary">
            Verify your email to create a passkey.
          </p>
        )}
        {supported === false && (
          <p className="mt-3 text-xs text-text-secondary">
            Passkeys are not supported in this browser or on this address.
          </p>
        )}
        {passkeys && passkeys.length > 0 && (
          <ul
            className="mt-4 space-y-2 border-t border-border pt-3"
            aria-label="Your passkeys"
          >
            {passkeys.map((passkey) => (
              <li
                key={passkey.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="flex items-center gap-2">
                  <Check className="size-4 text-accent" aria-hidden="true" />
                  {passkey.friendly_name || "Passkey"}
                </span>
                <span className="text-xs text-text-secondary">
                  Ready to use
                </span>
              </li>
            ))}
          </ul>
        )}
        {passkeys?.length === 0 && (
          <p className="mt-3 text-xs text-text-secondary">
            No passkeys added yet.
          </p>
        )}
        {!passkeys && !passkeyError && (
          <p className="mt-3 text-xs text-text-secondary" role="status">
            Loading passkeys…
          </p>
        )}
        {passkeyError && (
          <p className="mt-3 text-xs text-text-secondary" role="status">
            {passkeyError}
          </p>
        )}
      </div>
      {(identityError || passkeyError) && (
        <Button
          className="mt-3"
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy !== null}
          onClick={() => setAttempt((value) => value + 1)}
        >
          Retry sign-in methods
        </Button>
      )}
      {actionError && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {actionError}
        </p>
      )}
      {success && (
        <p className="mt-3 text-sm text-accent" role="status">
          {success}
        </p>
      )}
    </div>
  );
}
