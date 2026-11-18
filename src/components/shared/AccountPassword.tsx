"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { KeyRound, LoaderCircle } from "lucide-react";
import { useUpdateBlocker } from "@/hooks/useUpdateBlocker";
import {
  accountSecurityError,
  saveAccountPassword,
} from "@/lib/account-security";
import { Button } from "./Button";
import { Input } from "./Input";

export default function AccountPassword({
  emailVerified,
}: {
  emailVerified: boolean;
}) {
  const id = useId();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const busy = useRef(false);
  useUpdateBlocker(saving || password.length > 0 || confirmation.length > 0);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !emailVerified) return;
    setError("");
    setSaved(false);
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    if (password !== confirmation) {
      setError("Your passwords don’t match. Please enter them again.");
      return;
    }
    busy.current = true;
    setSaving(true);
    try {
      await saveAccountPassword(password);
      setPassword("");
      setConfirmation("");
      setSaved(true);
    } catch (cause) {
      setError(
        accountSecurityError(
          cause,
          "Your password couldn’t be saved. Please try again.",
        ),
      );
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void save(event)}
      aria-label="Set account password"
      className="mt-5 rounded-xl border border-border bg-bg/50 p-4"
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <KeyRound className="size-4 text-accent" aria-hidden="true" />
        Password
      </h3>
      <p id={`${id}-hint`} className="mt-1 text-sm text-text-secondary">
        Set or change your password to sign in with your email address. Use at
        least 8 characters.
      </p>
      <fieldset
        disabled={saving || !emailVerified}
        className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2"
      >
        <legend className="sr-only">Your new password</legend>
        <div>
          <label
            htmlFor={`${id}-password`}
            className="mb-1.5 block text-sm font-medium"
          >
            New password
          </label>
          <Input
            id={`${id}-password`}
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            aria-describedby={`${id}-hint`}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setSaved(false);
            }}
          />
        </div>
        <div>
          <label
            htmlFor={`${id}-confirmation`}
            className="mb-1.5 block text-sm font-medium"
          >
            Confirm password
          </label>
          <Input
            id={`${id}-confirmation`}
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirmation}
            onChange={(event) => {
              setConfirmation(event.target.value);
              setSaved(false);
            }}
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="justify-self-start"
          disabled={saving || !password || !confirmation}
        >
          {saving && (
            <LoaderCircle
              className="mr-2 size-4 animate-spin"
              aria-hidden="true"
            />
          )}
          {saving ? "Saving password…" : "Save password"}
        </Button>
      </fieldset>
      {!emailVerified && (
        <p className="mt-3 text-sm text-text-secondary">
          Verify your email to set a password.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="mt-3 text-sm text-accent">
          Password saved. You can now sign in with your email and password.
        </p>
      )}
    </form>
  );
}
