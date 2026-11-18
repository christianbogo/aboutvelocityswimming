"use client";

import { LogOut, Settings2, ShieldCheck } from "lucide-react";
import { useId, useState } from "react";
import { useAuth } from "@/features/workshare/contexts/auth";
import AccountAthletes from "./AccountAthletes";
import AccountSignInMethods from "./AccountSignInMethods";
import VelocityFamily, { familyPreview } from "./VelocityFamily";
import { Button } from "./Button";

export default function AccountProfile() {
  const { user, accountFamilyId, logout, loading } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsId = useId();
  if (loading) return <p role="status">Loading your account…</p>;
  if (!user) return null;

  async function signOut() {
    setSigningOut(true);
    setSignOutError(false);
    try {
      await logout();
    } catch {
      setSignOutError(true);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <section aria-label="Account management" className="min-w-0 space-y-6">
      <div className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <div
          role="group"
          aria-label="Signed-in account"
          className="flex flex-wrap items-start justify-between gap-4"
        >
          <div className="min-w-0">
            <p className="text-sm text-text-secondary">Signed in as</p>
            <p className="mt-1 break-all text-base font-semibold">
              {user.email ?? "Email unavailable"}
            </p>
            {user.emailVerified && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-text-secondary">
                <ShieldCheck
                  className="size-4 text-accent"
                  aria-hidden="true"
                />
                Email verified
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={signingOut}
              aria-expanded={settingsOpen}
              aria-controls={settingsId}
              onClick={() => setSettingsOpen((open) => !open)}
            >
              <Settings2 className="mr-2 size-4" aria-hidden="true" />
              Account Sign-in Settings
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={signingOut}
              onClick={() => void signOut()}
            >
              <LogOut className="mr-2 size-4" aria-hidden="true" />
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          </div>
          {signOutError && (
            <p role="alert" className="w-full text-sm text-text-secondary">
              Couldn’t sign out. Please try again.
            </p>
          )}
        </div>
        <section
          id={settingsId}
          aria-label="Account Sign-in Settings"
          hidden={!settingsOpen}
        >
          {settingsOpen && (
            <div className="mt-6 border-t border-border pt-6">
              <AccountSignInMethods
                key={user.uid}
                userId={user.uid}
                emailVerified={user.emailVerified}
              />
            </div>
          )}
        </section>
      </div>
      <VelocityFamily family={familyPreview(accountFamilyId, user.email)} />
      <AccountAthletes key={user.uid} userId={user.uid} />
    </section>
  );
}
