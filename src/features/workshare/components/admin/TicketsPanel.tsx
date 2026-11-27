"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { Input } from "@/components/shared/Input";
import type { WorkshareAccount } from "../../lib/accounts";
import {
  loadTickets,
  ticketCategories,
  type TicketCategory,
  type TicketPage,
  type WorkshareSeason,
  type WorkshareTicket,
} from "../../lib/tickets";
import {
  categoryLabel,
  displayWorkDate,
  fieldClass,
  selectClass,
} from "./TicketFields";
import { TicketEditor } from "./TicketEditor";

export function TicketsPanel({
  season,
  accounts,
  accountId,
  revision,
  onChanged,
  onAdd,
  onReuse,
  onEditingChange,
}: {
  season: WorkshareSeason;
  accounts: WorkshareAccount[];
  accountId?: string;
  revision: number;
  onChanged: () => void;
  onAdd: (accountId?: string) => void;
  onReuse: (ticket: WorkshareTicket) => void;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [requestedAccount, setRequestedAccount] = useState<string>();
  const enabled = !accountId || requestedAccount === accountId;
  const [category, setCategory] = useState<TicketCategory | "">("");
  const [filterAccountId, setFilterAccountId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data?: TicketPage;
    error?: string;
  }>();
  const [editing, setEditing] = useState<WorkshareTicket | null>(null);
  const editingCallback = useRef(onEditingChange);
  const rangeError =
    from && to && from > to
      ? "The From date must come before the To date."
      : "";
  const effectiveAccountId = accountId || filterAccountId || undefined;
  const key = JSON.stringify([
    season.id,
    effectiveAccountId,
    category,
    from,
    to,
    query,
    page,
    revision,
    attempt,
  ]);
  const current = result?.key === key ? result : undefined;
  const loading = enabled && !current && !rangeError;
  const accountNames = new Map(
    accounts.map((account) => [account.id, account.fullName]),
  );

  useEffect(() => {
    editingCallback.current = onEditingChange;
  }, [onEditingChange]);
  useEffect(() => () => editingCallback.current?.(false), []);
  useEffect(() => {
    const timeout = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timeout);
  }, [search]);
  useEffect(() => {
    if (!enabled || rangeError) return;
    const controller = new AbortController();
    void loadTickets(
      {
        seasonId: season.id,
        accountId: effectiveAccountId,
        category,
        from,
        to,
        q: query,
        page,
      },
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) {
          setResult({ key, data });
          const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));
          if (page > lastPage) setPage(lastPage);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setResult({
            key,
            error:
              cause instanceof Error
                ? cause.message
                : "Unable to load tickets.",
          });
      });
    return () => controller.abort();
  }, [
    enabled,
    season.id,
    effectiveAccountId,
    category,
    from,
    to,
    query,
    page,
    key,
    rangeError,
  ]);

  function open(ticket: WorkshareTicket) {
    setEditing(ticket);
    onEditingChange?.(true);
  }
  function close() {
    setEditing(null);
    setAttempt((previous) => previous + 1);
    onEditingChange?.(false);
  }
  function changed() {
    setAttempt((previous) => previous + 1);
    onChanged();
  }
  const data = current?.data;
  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.pageSize))
    : 1;

  return (
    <section
      className="space-y-4"
      aria-label={accountId ? "Account tickets" : "Season tickets"}
    >
      {!accountId && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Tickets</h3>
            <p className="mt-1 text-xs text-text-secondary">
              {season.name} · Completed hours, newest work date first
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onAdd(accountId)}
          >
            <Plus className="mr-1 size-3" aria-hidden="true" />
            Add ticket
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        {accountId && !enabled ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setRequestedAccount(accountId)}
          >
            Load Tickets
          </Button>
        ) : accountId && !result?.data && loading ? (
          <Button type="button" variant="outline" disabled>
            Loading tickets…
          </Button>
        ) : (
          <label className={`${fieldClass} w-full max-w-xs`}>
            <span className={accountId ? "sr-only" : undefined}>
              Search tickets
            </span>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-3.5 size-4 text-text-secondary"
                aria-hidden="true"
              />
              <Input
                type="search"
                className="pl-9"
                maxLength={200}
                value={search}
                placeholder="Search descriptions…"
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </label>
        )}
        {accountId && (
          <Button
            type="button"
            variant="outline"
            onClick={() => onAdd(accountId)}
          >
            <Plus className="mr-1 size-3" aria-hidden="true" />
            Add ticket
          </Button>
        )}
        {!accountId && (
          <label className={`${fieldClass} w-full max-w-xs`}>
            <span>Account</span>
            <select
              aria-label="Ticket account filter"
              className={selectClass}
              value={filterAccountId}
              onChange={(event) => {
                setFilterAccountId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All accounts</option>
              {accounts
                .filter((account) => account.id)
                .sort((a, b) => a.fullName.localeCompare(b.fullName))
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.fullName}
                    {account.isArchived ? " (archived)" : ""}
                  </option>
                ))}
            </select>
          </label>
        )}
        {!accountId && (
          <>
            <label className={`${fieldClass} w-full max-w-48`}>
              <span>Ticket category</span>
              <select
                className={selectClass}
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value as TicketCategory | "");
                  setPage(1);
                }}
              >
                <option value="">All categories</option>
                {ticketCategories.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={`${fieldClass} w-full max-w-44`}>
              <span>From date</span>
              <Input
                type="date"
                value={from}
                min={season.startsOn}
                max={to || season.endsOn}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label className={`${fieldClass} w-full max-w-44`}>
              <span>To date</span>
              <Input
                type="date"
                value={to}
                min={from || season.startsOn}
                max={season.endsOn}
                onChange={(event) => {
                  setTo(event.target.value);
                  setPage(1);
                }}
              />
            </label>
          </>
        )}
        {(category || from || to || search || filterAccountId) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setCategory("");
              setFilterAccountId("");
              setFrom("");
              setTo("");
              setSearch("");
              setQuery("");
              setPage(1);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
      {!enabled ? null : rangeError ? (
        <p role="alert" className="text-sm text-red-600">
          {rangeError}
        </p>
      ) : current?.error ? (
        <div
          role="alert"
          className="space-y-2 rounded-lg border border-border p-4"
        >
          <p className="text-sm">{current.error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAttempt((previous) => previous + 1)}
          >
            Retry tickets
          </Button>
        </div>
      ) : (
        <div className="relative overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[640px] text-left text-xs">
            <caption className="sr-only">
              {accountId ? "Account" : "Season"} tickets for {season.name}
            </caption>
            <thead className="bg-bg text-text-secondary">
              <tr>
                {[
                  "Work date",
                  ...(!accountId ? ["Account"] : []),
                  "Description",
                  "Category",
                  "Hours",
                  "Actions",
                ].map((title) => (
                  <th
                    key={title}
                    scope="col"
                    className="px-3 py-2.5 font-semibold"
                  >
                    {title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={accountId ? 5 : 6}
                    role="status"
                    className="p-5 text-text-secondary"
                  >
                    Loading tickets…
                  </td>
                </tr>
              ) : data?.tickets.length === 0 ? (
                <tr>
                  <td
                    colSpan={accountId ? 5 : 6}
                    className="p-5 text-text-secondary"
                  >
                    No tickets match these filters.
                  </td>
                </tr>
              ) : (
                data?.tickets.map((ticket) => (
                  <tr
                    key={ticket.id}
                    className="cursor-pointer border-t border-border hover:bg-bg/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                    tabIndex={0}
                    onClick={() => open(ticket)}
                    onKeyDown={(event) => {
                      if (
                        event.target === event.currentTarget &&
                        (event.key === "Enter" || event.key === " ")
                      ) {
                        event.preventDefault();
                        open(ticket);
                      }
                    }}
                  >
                    <td className="whitespace-nowrap px-3 py-3 align-top">
                      {displayWorkDate(ticket.completedOn)}
                    </td>
                    {!accountId && (
                      <td className="px-3 py-3 align-top font-medium">
                        {accountNames.get(ticket.accountId) ??
                          "Unknown account"}
                      </td>
                    )}
                    <td className="max-w-sm whitespace-pre-wrap break-words px-3 py-3 align-top font-medium">
                      {ticket.description}
                    </td>
                    <td className="px-3 py-3 align-top">
                      {categoryLabel(ticket.category)}
                    </td>
                    <td className="px-3 py-3 align-top tabular-nums">
                      {ticket.hours}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          onReuse(ticket);
                        }}
                      >
                        Use again
                        <span className="sr-only">: {ticket.description}</span>
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {data && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-text-secondary">
          <span>
            {data.total} {data.total === 1 ? "ticket" : "tickets"} · Page{" "}
            {data.page} of {totalPages}
          </span>
          {totalPages > 1 && (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => setPage((previous) => previous - 1)}
              >
                Previous tickets
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((previous) => previous + 1)}
              >
                Next tickets
              </Button>
            </div>
          )}
        </div>
      )}
      {editing && (
        <TicketEditor
          ticket={editing}
          season={season}
          accountName={accountNames.get(editing.accountId)}
          onChanged={changed}
          onClose={close}
        />
      )}
    </section>
  );
}
