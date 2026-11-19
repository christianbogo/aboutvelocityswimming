"use client";

import { useState, useSyncExternalStore } from "react";
import { Columns3, Link2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/shared/Button";
import type { WorkshareAccount } from "../../lib/accounts";
import type { AccountSeasonSummary, WorkshareSeason } from "../../lib/tickets";
import styles from "./Accounts.module.css";

export const accountColumns = [
  ["athletes", "Athletes"],
  ["generalHoursRequired", "General"],
  ["starlightHoursRequired", "Starlight"],
  ["appleCapitalHoursRequired", "Apple Capital"],
] as const;
type Columns = Record<(typeof accountColumns)[number][0], boolean>;
const defaultColumns: Columns = {
  athletes: true,
  generalHoursRequired: true,
  starlightHoursRequired: true,
  appleCapitalHoursRequired: true,
};
const storageKey = "velocity-admin-columns-v1";
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
function readColumns() {
  try {
    return localStorage.getItem(storageKey) ?? "";
  } catch {
    return "";
  }
}
export function useAccountColumns(): [Columns, (columns: Columns) => void] {
  const stored = useSyncExternalStore(subscribe, readColumns, () => "");
  const [override, setOverride] = useState<Columns>();
  let columns = defaultColumns;
  try {
    const parsed = JSON.parse(stored);
    columns = Object.fromEntries(
      accountColumns.map(([key]) => [
        key,
        typeof parsed?.[key] === "boolean" ? parsed[key] : true,
      ]),
    ) as Columns;
  } catch {
    /* Use all columns until a valid preference is available. */
  }
  return [
    override ?? columns,
    (next) => {
      setOverride(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* Keep the in-memory preference when storage is unavailable. */
      }
    },
  ];
}
export function ColumnControls({
  columns,
  onChange,
}: {
  columns: Columns;
  onChange: (columns: Columns) => void;
}) {
  return (
    <details className={styles.columns}>
      <summary>
        <Columns3 className="size-4" aria-hidden="true" />
        Columns
      </summary>
      <fieldset className={styles.columnMenu}>
        <legend className="sr-only">Visible account columns</legend>
        {accountColumns.map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={columns[key]}
              onChange={(event) =>
                onChange({ ...columns, [key]: event.target.checked })
              }
            />
            {key === "athletes" ? label : `${label} hours`}
          </label>
        ))}
      </fieldset>
    </details>
  );
}

export function AccountTableRow({
  account,
  season,
  summary,
  summaryLoading,
  summaryError,
  columns,
  compact,
  selected,
  disabled,
  onSelect,
  onAddTicket,
}: {
  account: WorkshareAccount;
  season?: WorkshareSeason;
  summary?: AccountSeasonSummary;
  summaryLoading: boolean;
  summaryError?: string;
  columns: Columns;
  compact: boolean;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onAddTicket: () => void;
}) {
  return (
    <tr
      className={styles.accountRow}
      data-selected={selected}
      onClick={(event) => {
        if (
          !disabled &&
          !(event.target instanceof Element && event.target.closest("button"))
        )
          onSelect();
      }}
    >
      <td>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Select ${account.fullName}`}
          aria-current={selected ? "true" : undefined}
          className={styles.accountSelect}
          onClick={onSelect}
        >
          <span className="block font-semibold">{account.fullName}</span>
          <span className="mt-1 block text-xs font-normal text-text-secondary">
            {account.emails.join(" · ") || "No email listed"}
          </span>
          {compact && account.athletes.length > 0 && (
            <span className="mt-1 block text-xs font-normal text-text-secondary">
              {account.athletes.map((athlete) => athlete.fullName).join(" · ")}
            </span>
          )}
          {account.isArchived && (
            <span className="mt-1 block text-xs font-normal text-text-secondary">
              Archived account
            </span>
          )}
          {account.requireWorkshare === false && (
            <span className="mt-2 inline-block rounded bg-bg px-2 py-1 text-xs font-medium">
              Workshare not required
            </span>
          )}
        </button>
      </td>
      {!compact && columns.athletes && (
        <td>
          {account.athletes.length === 0 ? (
            <span className="text-xs text-text-secondary">No athletes</span>
          ) : (
            <ul className="space-y-3">
              {account.athletes.map((athlete) => (
                <li key={athlete.id}>
                  <p className="flex flex-wrap items-center gap-1.5 font-medium">
                    {athlete.fullName}
                    {athlete.timesAthleteId && (
                      <span
                        role="img"
                        aria-label="Linked to Times"
                        title="Linked to Times"
                      >
                        <Link2
                          className="size-3.5 text-accent"
                          aria-hidden="true"
                        />
                      </span>
                    )}
                    {athlete.isArchived && (
                      <span className="text-xs text-text-secondary">
                        Archived
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-text-secondary">
                    {athlete.trainingGroup || "Group unset"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </td>
      )}
      {!compact &&
        accountColumns.slice(1).map(([key], index) => {
          if (key === "athletes" || !columns[key]) return null;
          const completed =
            summary?.completed[
              (["general", "starlight", "appleCapital"] as const)[index]
            ] ?? 0;
          const required =
            account.requireWorkshare === false
              ? 0
              : season
                ? (summary?.requirements[key] ?? null)
                : account[key];
          return (
            <td key={key} className="whitespace-nowrap tabular-nums">
              {summaryError ? (
                <span aria-label="Hours unavailable">—</span>
              ) : summaryLoading ? (
                <span aria-label="Loading hours">…</span>
              ) : (
                <span
                  aria-label={`${completed} completed / ${required ?? "unset"} required hours`}
                >
                  {completed}/{required ?? "-"}
                </span>
              )}
            </td>
          );
        })}
      {!compact && (
        <td>
          <div className={styles.rowActions}>
            <Button
              type="button"
              variant={selected ? "primary" : "outline"}
              className={styles.rowAction}
              disabled={disabled}
              onClick={onSelect}
              aria-label={`Edit ${account.fullName}`}
            >
              <Pencil className="size-4" aria-hidden="true" />
              {selected ? "Editing" : "Edit"}
            </Button>
            {!compact && (
              <Button
                type="button"
                variant="secondary"
                className={styles.rowAction}
                disabled={disabled || !season}
                onClick={onAddTicket}
                aria-label={`Add ticket for ${account.fullName}`}
              >
                <Plus className="size-4" aria-hidden="true" />
                Add Ticket
              </Button>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}
