"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
  loadAccountWorkshare,
  workshareHours,
  type AccountWorkshareData,
  type AccountWorkshareSummary,
} from "@/lib/account-workshare";
import { categoryLabels } from "@/features/workshare/lib/tickets";
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
        <h3 className="break-words text-sm font-semibold">
          {account.fullName}
        </h3>
        {account.isArchived && (
          <span className="rounded-full bg-hover-bg px-2 py-0.5 text-xs text-text-secondary">
            Archived
          </span>
        )}
      </div>
      <div className="mb-4 grid min-w-0 gap-4 text-sm sm:grid-cols-2">
        <div>
          <h4 className="font-semibold">Associated emails</h4>
          <ul className="mt-1 space-y-1 text-text-secondary">
            {account.emails.map((email) => (
              <li key={email} className="break-all">
                {email}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="font-semibold">Athletes</h4>
          {account.athletes.length ? (
            <ul className="mt-1 space-y-1 text-text-secondary">
              {account.athletes.map((athlete) => (
                <li key={athlete.id} className="break-words">
                  {athlete.fullName}
                  {athlete.trainingGroup && ` · ${athlete.trainingGroup}`}
                  {athlete.isArchived && " · Archived"}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-text-secondary">No athletes listed.</p>
          )}
        </div>
      </div>
      {account.requireWorkshare === false && (
        <p className="mb-3 rounded-lg bg-hover-bg p-3 text-sm font-medium">
          Workshare is not required for this account.
        </p>
      )}
      {account.workshareNote && (
        <div className="mb-4 rounded-lg border border-border bg-hover-bg p-4">
          <h4 className="text-sm font-semibold">
            Note about your workshare hours
          </h4>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm">
            {account.workshareNote}
          </p>
        </div>
      )}
      <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
        {categories.map(([label, completedKey, requiredKey]) => (
          <div
            key={completedKey}
            className="min-w-0 rounded-lg border border-border px-3.5 py-3"
          >
            <dt className="text-sm text-text-secondary">{label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              <span
                aria-label={`${account.completed[completedKey]} completed hours, ${(account.requireWorkshare === false ? 0 : account.requirements[requiredKey]) === null ? "requirement unset" : `${account.requireWorkshare === false ? 0 : account.requirements[requiredKey]} required hours`}`}
              >
                {workshareHours(
                  account.completed[completedKey],
                  account.requireWorkshare === false
                    ? 0
                    : account.requirements[requiredKey],
                )}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-5">
        <h4 className="text-sm font-semibold">Tickets</h4>
        {account.tickets?.length ? (
          <ul className="mt-2 divide-y divide-border">
            {account.tickets.map((ticket) => (
              <li
                key={ticket.id}
                className="flex min-w-0 items-start justify-between gap-4 py-3"
              >
                <div className="min-w-0">
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {ticket.description}
                  </p>
                  <p className="mt-1 text-xs text-text-secondary">
                    <time dateTime={ticket.completedOn}>
                      {new Date(
                        `${ticket.completedOn}T00:00:00Z`,
                      ).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        timeZone: "UTC",
                      })}
                    </time>
                    {" · "}
                    {categoryLabels[ticket.category]}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums">
                  {ticket.hours.toLocaleString("en-US", {
                    maximumFractionDigits: 2,
                  })}{" "}
                  hr
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-text-secondary">
            No tickets recorded for this season.
          </p>
        )}
      </div>
    </article>
  );
}

type ReadResult = {
  userId: string;
  requestedSeasonId: string | undefined;
  attempt: number;
} & (
  | { data: AccountWorkshareData; failed?: false }
  | { failed: true; data?: never }
);

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

  if (current?.data && current.data.accounts.length === 0) return null;

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
            Completed / required hours and all tickets for your associated
            accounts in the selected season.
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
            <div className="relative">
              <select
                id={seasonInputId}
                value={selectedSeasonId}
                onChange={(event) => setRequestedSeasonId(event.target.value)}
                className="h-11 w-full rounded-lg border border-border bg-surface appearance-none pl-3.5 pr-11 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {seasons.map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2"
                aria-hidden="true"
              />
            </div>
          </div>
        )}
      </div>
      <p className="mb-5 text-sm text-text-secondary">
        If any account, email, or athlete information is incorrect or out of
        date, please reach out to Coach Christian at{" "}
        <a
          className="break-all underline"
          href="mailto:coachchristian@velocity-swimming.com"
        >
          coachchristian@velocity-swimming.com
        </a>{" "}
        or Coach Audrey at{" "}
        <a
          className="break-all underline"
          href="mailto:coachaudrey@velocity-swimming.com"
        >
          coachaudrey@velocity-swimming.com
        </a>
        .
      </p>
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
