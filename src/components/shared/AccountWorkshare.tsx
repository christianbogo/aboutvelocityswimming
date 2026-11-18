"use client";

import { useEffect, useId, useState } from "react";
import {
  loadAccountWorkshare,
  workshareHours,
  type AccountWorkshareData,
  type AccountWorkshareSummary,
} from "@/lib/account-workshare";
import { Button } from "./Button";

const categories = [
  ["General", "general", "generalHoursRequired"],
  ["Starlight", "starlight", "starlightHoursRequired"],
  ["Apple Capital", "appleCapital", "appleCapitalHoursRequired"],
] as const;

function AccountHours({ account }: { account: AccountWorkshareSummary }) {
  return (
    <article className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="break-words text-sm font-semibold">{account.fullName}</h3>
        {account.isArchived && (
          <span className="rounded-full bg-hover-bg px-2 py-0.5 text-xs text-text-secondary">
            Archived
          </span>
        )}
      </div>
      <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
        {categories.map(([label, completedKey, requiredKey]) => (
          <div
            key={completedKey}
            className="min-w-0 rounded-lg border border-border px-3.5 py-3"
          >
            <dt className="text-sm text-text-secondary">{label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              <span
                aria-label={`${account.completed[completedKey]} completed hours, ${account.requirements[requiredKey] === null ? "requirement unset" : `${account.requirements[requiredKey]} required hours`}`}
              >
                {workshareHours(
                  account.completed[completedKey],
                  account.requirements[requiredKey],
                )}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

type ReadResult = {
  userId: string;
  requestedSeasonId: string | undefined;
  attempt: number;
} & ({ data: AccountWorkshareData; failed?: false } | { failed: true; data?: never });

export default function AccountWorkshare({ userId }: { userId: string }) {
  const headingId = useId();
  const seasonInputId = useId();
  const [requestedSeasonId, setRequestedSeasonId] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<ReadResult>();
  const current =
    result?.userId === userId &&
    result.requestedSeasonId === requestedSeasonId &&
    result.attempt === attempt
      ? result
      : undefined;
  const seasons = result?.userId === userId ? result.data?.seasons : undefined;
  const selectedSeasonId = requestedSeasonId ?? current?.data?.seasonId ?? "";

  useEffect(() => {
    const controller = new AbortController();
    void loadAccountWorkshare(requestedSeasonId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setResult({ userId, requestedSeasonId, attempt, data });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResult({ userId, requestedSeasonId, attempt, failed: true });
      });
    return () => controller.abort();
  }, [userId, requestedSeasonId, attempt]);

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-2xl border border-border bg-surface p-5 sm:p-6"
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id={headingId} className="text-xl font-semibold">
            Workshare Tracking
          </h2>
          <p className="mt-2 text-sm text-text-secondary">
            Completed / required hours for your associated accounts.
          </p>
        </div>
        {seasons && seasons.length > 0 && (
          <div className="w-full max-w-64">
            <label
              htmlFor={seasonInputId}
              className="mb-1 block text-xs font-medium text-text-secondary"
            >
              Season
            </label>
            <select
              id={seasonInputId}
              value={selectedSeasonId}
              onChange={(event) => setRequestedSeasonId(event.target.value)}
              className="h-11 w-full rounded-lg border border-border bg-surface px-3.5 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {!current ? (
        <p role="status" className="text-sm text-text-secondary">
          Loading your Workshare information…
        </p>
      ) : current.failed ? (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-text-secondary">
            Your Workshare information couldn’t be loaded. Please try again.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry Workshare tracking
          </Button>
        </div>
      ) : (
        <>
          {current.data.seasonId === null && (
            <p className="mb-4 text-sm text-text-secondary">
              Season setup is pending.
            </p>
          )}
          {current.data.accounts.length ? (
            <div className="space-y-6">
              {current.data.accounts.map((account) => (
                <AccountHours key={account.id} account={account} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-secondary">
              No Workshare account is linked to your sign-in email.
            </p>
          )}
        </>
      )}
    </section>
  );
}
