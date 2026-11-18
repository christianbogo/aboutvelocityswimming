"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Plus, Search } from "lucide-react";
import { Input } from "@/components/shared/Input";
import { Button } from "@/components/shared/Button";
import { useUpdateBlocker } from "@/hooks/useUpdateBlocker";
import type { WorkshareAccount } from "../../lib/accounts";
import {
  createTicket,
  deleteTicket,
  validateTicketFields,
  WorkshareRequestError,
  type TicketFields as SavedFields,
  type WorkshareSeason,
  type WorkshareTicket,
} from "../../lib/tickets";
import {
  categoryLabel,
  defaultTicketFields,
  displayWorkDate,
  fieldClass,
  TicketFields,
  type TicketFieldValues,
} from "./TicketFields";
import { TicketModal } from "./TicketModal";

interface TargetState {
  key: string;
  ticket?: WorkshareTicket;
  busy?: boolean;
  error?: string;
}

function savedFields(value: TicketFieldValues): SavedFields {
  return {
    ...value,
    description: value.description.trim(),
    hours: Number(value.hours),
  };
}

function matchesAccount(account: WorkshareAccount, term: string) {
  return [
    account.fullName,
    ...account.emails,
    ...account.athletes.map((athlete) => athlete.fullName),
  ].some((value) => value.toLowerCase().includes(term));
}

export function TicketComposer({
  season,
  accounts,
  accountId,
  template,
  onChanged,
  onClose,
}: {
  season: WorkshareSeason;
  accounts: WorkshareAccount[];
  accountId?: string;
  template?: WorkshareTicket;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [fields, setFields] = useState(() =>
    defaultTicketFields(season, template),
  );
  const [selected, setSelected] = useState(accountId ?? "");
  const [query, setQuery] = useState("");
  const [committed, setCommitted] = useState<SavedFields | null>(null);
  const [targets, setTargets] = useState<Record<string, TargetState>>({});
  const [initialBusy, setInitialBusy] = useState(false);
  const [initialLocked, setInitialLocked] = useState(false);
  const [error, setError] = useState("");
  const keys = useRef(new Map<string, string>());
  const inFlight = useRef(new Set<string>());
  const busy =
    initialBusy || Object.values(targets).some((target) => target.busy);
  useUpdateBlocker(busy);
  useEffect(() => {
    if (!busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [busy]);
  const term = query.trim().toLowerCase();
  const selectable = accounts
    .filter((account) => account.id)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const selectedAccount = selectable.find((account) => account.id === selected);
  const matches = selectable.filter(
    (account) => !term || matchesAccount(account, term),
  );
  const visible = matches.slice(0, 25);
  const addedCount = Object.values(targets).filter(
    (target) => target.ticket,
  ).length;

  function keyFor(id: string) {
    let key = keys.current.get(id);
    if (!key) {
      key = crypto.randomUUID();
      keys.current.set(id, key);
    }
    return key;
  }

  async function add(id: string, details: SavedFields) {
    if (inFlight.current.has(id) || targets[id]?.ticket) return;
    inFlight.current.add(id);
    const key = keyFor(id);
    setTargets((previous) => ({
      ...previous,
      [id]: { ...previous[id], key, busy: true, error: "" },
    }));
    try {
      const ticket = await createTicket({
        id: key,
        accountId: id,
        seasonId: season.id,
        ...details,
      });
      setTargets((previous) => ({ ...previous, [id]: { key, ticket } }));
      onChanged();
      return ticket;
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Unable to add this ticket.";
      setTargets((previous) => ({
        ...previous,
        [id]: { ...previous[id], key, busy: false, error: message },
      }));
      throw cause;
    } finally {
      inFlight.current.delete(id);
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (initialBusy) return;
    const details = savedFields(fields);
    const validation = validateTicketFields(details, season);
    if (validation || !selectedAccount) {
      setError(validation || "Choose the account receiving this ticket.");
      return;
    }
    setInitialBusy(true);
    setInitialLocked(true);
    setError("");
    try {
      const ticket = await add(selectedAccount.id!, details);
      if (ticket) {
        setCommitted({
          completedOn: ticket.completedOn,
          category: ticket.category,
          description: ticket.description,
          hours: ticket.hours,
        });
        setQuery("");
      }
    } catch (cause) {
      if (
        cause instanceof WorkshareRequestError &&
        cause.status >= 400 &&
        cause.status < 500 &&
        cause.status !== 409
      ) {
        setInitialLocked(false);
      }
      setError(
        cause instanceof Error ? cause.message : "Unable to add the ticket.",
      );
    } finally {
      setInitialBusy(false);
    }
  }

  async function undo(id: string) {
    const target = targets[id];
    if (!target?.ticket || inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setTargets((previous) => ({
      ...previous,
      [id]: { ...target, busy: true, error: "" },
    }));
    try {
      await deleteTicket(target.ticket);
      keys.current.delete(id);
      setTargets((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
      onChanged();
    } catch (cause) {
      setTargets((previous) => ({
        ...previous,
        [id]: {
          ...target,
          error:
            cause instanceof Error
              ? cause.message
              : "Unable to undo this ticket.",
        },
      }));
    } finally {
      inFlight.current.delete(id);
    }
  }

  function startAgain(reuse: boolean) {
    if (busy) return;
    setFields(
      reuse && committed
        ? { ...committed, hours: String(committed.hours) }
        : defaultTicketFields(season),
    );
    setCommitted(null);
    setSelected(accountId ?? "");
    setQuery("");
    setTargets({});
    setInitialLocked(false);
    keys.current.clear();
    setError("");
  }

  return (
    <TicketModal
      title="Add ticket"
      subtitle={season.name}
      onClose={() => {
        if (!busy) onClose();
      }}
      closing={busy}
    >
      {committed ? (
        <div className="space-y-5">
          <div className="space-y-2 rounded-xl border border-border bg-bg/40 p-4">
            <p className="text-sm font-semibold">{committed.description}</p>
            <p className="text-sm text-text-secondary">
              {displayWorkDate(committed.completedOn)} ·{" "}
              {categoryLabel(committed.category)} · {committed.hours}{" "}
              {committed.hours === 1 ? "hour" : "hours"}
            </p>
            <p role="status" className="text-xs text-accent">
              Added to {addedCount} {addedCount === 1 ? "account" : "accounts"}
            </p>
          </div>
          <p className="text-sm text-text-secondary">
            Add this same ticket to other accounts.
          </p>
          <label className={`${fieldClass} w-full max-w-sm`}>
            <span>Find an account</span>
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search names, emails, or athletes…"
            />
          </label>
          <ul
            className="max-h-80 divide-y divide-border overflow-y-auto rounded-xl border border-border"
            aria-label="Ticket account targets"
          >
            {visible.map((account) => {
              const target = targets[account.id!];
              return (
                <li key={account.id} className="p-3">
                  <div className="grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {account.fullName}
                        {account.isArchived && (
                          <span className="ml-2 text-xs font-normal text-text-secondary">
                            Archived
                          </span>
                        )}
                      </p>
                      <p className="break-all text-xs text-text-secondary">
                        {account.emails.join(", ")}
                      </p>
                    </div>
                    {target?.ticket ? (
                      <div className="flex items-center justify-end gap-2">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-accent">
                          <Check className="size-3" aria-hidden="true" />
                          Added
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={target.busy}
                          aria-label={`Undo ticket for ${account.fullName}`}
                          onClick={() => void undo(account.id!)}
                        >
                          {target.busy ? "Undoing…" : "Undo"}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="justify-self-end"
                        disabled={target?.busy}
                        aria-label={`Add ticket to ${account.fullName}`}
                        onClick={() => {
                          void add(account.id!, committed).catch(() => {});
                        }}
                      >
                        <Plus className="mr-1 size-3" aria-hidden="true" />
                        {target?.busy ? "Adding…" : "Add"}
                      </Button>
                    )}
                  </div>
                  {target?.error && (
                    <p role="alert" className="mt-2 text-xs text-red-600">
                      {target.error}
                    </p>
                  )}
                </li>
              );
            })}
            {visible.length === 0 && (
              <li className="p-4 text-sm text-text-secondary">
                No accounts match this search.
              </li>
            )}
          </ul>
          {matches.length > visible.length && (
            <p className="text-xs text-text-secondary">
              Showing {visible.length} of {matches.length} accounts. Narrow the
              search to find another account.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={onClose}>
              Done
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => startAgain(true)}
            >
              Use again
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => startAgain(false)}
            >
              New ticket
            </Button>
          </div>
        </div>
      ) : (
        <form className="space-y-5" onSubmit={(event) => void create(event)}>
          <fieldset
            disabled={initialBusy || initialLocked}
            className="space-y-4 disabled:opacity-60"
          >
            <div className="space-y-2">
              <p className="text-xs font-semibold leading-4">Account</p>
              {selectedAccount ? (
                <div className="flex max-w-sm items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <p className="text-sm font-medium">
                    {selectedAccount.fullName}
                  </p>
                  {!accountId && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelected("");
                        setQuery("");
                      }}
                    >
                      Change
                    </Button>
                  )}
                </div>
              ) : (
                <div className="max-w-sm space-y-2">
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3 top-3.5 size-4 text-text-secondary"
                      aria-hidden="true"
                    />
                    <Input
                      autoFocus
                      type="search"
                      aria-label="Find an account for this ticket"
                      className="pl-9"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search names, emails, or athletes…"
                    />
                  </div>
                  <ul
                    className="max-h-48 overflow-y-auto rounded-lg border border-border"
                    aria-label="Account choices"
                  >
                    {visible.map((account) => (
                      <li key={account.id}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm hover:bg-bg focus-visible:outline-accent"
                          onClick={() => setSelected(account.id!)}
                        >
                          <span className="block font-medium">
                            {account.fullName}
                          </span>
                          <span className="block break-all text-xs text-text-secondary">
                            {account.emails.join(", ")}
                          </span>
                        </button>
                      </li>
                    ))}
                    {visible.length === 0 && (
                      <li className="p-3 text-sm text-text-secondary">
                        No accounts match this search.
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
            <TicketFields
              value={fields}
              onChange={(changes) =>
                setFields((previous) => ({ ...previous, ...changes }))
              }
              season={season}
            />
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          {error && initialLocked && (
            <p className="text-xs text-text-secondary">
              Retry to confirm this ticket before changing its details.
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={initialBusy}>
              {initialBusy ? "Adding…" : "Add ticket"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={initialBusy}
              onClick={onClose}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </TicketModal>
  );
}
