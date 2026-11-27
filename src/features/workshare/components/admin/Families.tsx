"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { Input } from "@/components/shared/Input";
import { Button } from "@/components/shared/Button";
import { useUpdateBlocker } from "@/hooks/useUpdateBlocker";
import {
  emptyAccount,
  loadWorkshareAccounts,
  type WorkshareAccount,
} from "../../lib/accounts";
import {
  defaultSeason,
  loadSeasons,
  loadAccountSummaries,
  type AccountSeasonSummary,
  type SeasonRequirements,
  type WorkshareSeason,
  type WorkshareTicket,
} from "../../lib/tickets";
import { TicketComposer } from "./TicketComposer";
import { TicketsPanel } from "./TicketsPanel";
import { SeasonDialog } from "./SeasonDialog";

import { AccountEditor, type AccountEditorHandle } from "./AccountEditor";
import {
  AccountTableRow,
  accountColumns,
  useAccountColumns,
  ColumnControls,
} from "./AccountTable";
import { useSidebarFocus } from "@/components/shared/ToolSidebarFocus";
import styles from "./Accounts.module.css";
import { AccountPaneDivider } from "./AccountPaneDivider";
import { AthletesPanel } from "./AthletesPanel";
import { loadTrainingGroups, type TrainingGroup } from "../../lib/athletes";

const adminTabs = ["accounts", "athletes", "tickets"] as const;

export function FamiliesAdmin() {
  const [groups, setGroups] = useState<TrainingGroup[]>([]);
  const [athleteEditing, setAthleteEditing] = useState(false);
  const [accounts, setAccounts] = useState<WorkshareAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [seasons, setSeasons] = useState<WorkshareSeason[]>([]);
  const [summaryResult, setSummaryResult] = useState<{
    seasonId: string;
    data: Record<string, AccountSeasonSummary>;
    error?: string;
    loaded: boolean;
  }>();
  const [ticketRevision, setTicketRevision] = useState(0);
  const [ticketEditing, setTicketEditing] = useState(false);
  const [seasonDialog, setSeasonDialog] = useState(false);
  const [composer, setComposer] = useState<{
    accountId?: string;
    template?: WorkshareTicket;
  } | null>(null);
  const params = useSearchParams();
  const tab =
    params.get("tab") === "athletes"
      ? "athletes"
      : params.get("tab") === "tickets"
        ? "tickets"
        : "accounts";
  const season =
    seasons.find((item) => item.id === params.get("season")) ??
    defaultSeason(seasons);
  const summaryLoading =
    !!season &&
    (summaryResult?.seasonId !== season.id || !summaryResult.loaded);
  const summaryError =
    summaryResult?.seasonId === season?.id ? summaryResult?.error : undefined;
  const summaries =
    summaryResult?.seasonId === season?.id ? (summaryResult?.data ?? {}) : {};
  const tabId = useId();
  const workspace = useRef<HTMLDivElement>(null);
  const [listWidth, setListWidth] = useState(45);
  const editorId = useId();
  function selectView(next: { tab?: string; season?: string }) {
    const query = new URLSearchParams(window.location.search);
    if (next.tab) query.set("tab", next.tab);
    if (next.season) query.set("season", next.season);
    else if (season) query.set("season", season.id);
    window.history.replaceState(null, "", `?${query}`);
  }
  const ticketsChanged = () => setTicketRevision((value) => value + 1);
  const addTicket = (accountId?: string) => {
    if (!season) {
      setSeasonDialog(true);
      return;
    }
    setComposer({ accountId });
  };
  const reuseTicket = (ticket: WorkshareTicket) =>
    setComposer({ template: ticket });
  const requirementsSaved = (requirements: SeasonRequirements) => {
    setSummaryResult((previous) => {
      if (!previous || previous.seasonId !== requirements.seasonId)
        return previous;
      const entry = previous.data[requirements.accountId];
      return {
        ...previous,
        data: {
          ...previous.data,
          [requirements.accountId]: {
            account:
              entry?.account ??
              accounts.find((item) => item.id === requirements.accountId)!,
            requirements,
            completed: entry?.completed ?? {
              general: 0,
              starlight: 0,
              appleCapital: 0,
            },
          },
        },
      };
    });
    ticketsChanged();
  };
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState("");
  const [archive, setArchive] = useState("active");
  const [newAccount, setNewAccount] = useState<WorkshareAccount | null>(null);
  const adding = newAccount !== null;
  const [activeEditor, setActiveEditor] = useState<string | null>(null);
  const [editorSession, setEditorSession] = useState(0);
  const editor = useRef<AccountEditorHandle>(null);
  const switchingRef = useRef(false);
  const [switching, setSwitching] = useState(false);
  const editing = activeEditor !== null;
  const selectedAccount =
    activeEditor === "new"
      ? newAccount
      : accounts.find((account) => account.id === activeEditor);
  const [columns, setColumns] = useAccountColumns();
  useSidebarFocus(editing);
  async function selectAccount(account: WorkshareAccount | null) {
    if (switchingRef.current || ticketEditing || composer || seasonDialog)
      return;
    switchingRef.current = true;
    setSwitching(true);
    try {
      if (editor.current && !(await editor.current.flush())) return;
      if (account?.id && account.id === selectedAccount?.id) {
        closeEditor();
        return;
      }
      if (tab !== "accounts") selectView({ tab: "accounts" });
      setNewAccount(account ? null : emptyAccount());
      setActiveEditor(account?.id ?? "new");
      setEditorSession((previous) => previous + 1);
    } finally {
      switchingRef.current = false;
      setSwitching(false);
    }
  }
  function closeEditor() {
    setActiveEditor(null);
    setNewAccount(null);
  }
  useUpdateBlocker(loading);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      loadWorkshareAccounts(controller.signal),
      loadSeasons(controller.signal),
      loadTrainingGroups(controller.signal),
    ])
      .then(([data, loadedSeasons, loadedGroups]) => {
        setGroups(loadedGroups);
        setAccounts(data);
        setSeasons(loadedSeasons);
        setLoading(false);
        setError("");
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error ? cause.message : "Unable to load accounts.",
          );
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    if (!season) return;
    const controller = new AbortController();
    void loadAccountSummaries(season.id, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setSummaryResult({
          seasonId: season.id,
          loaded: true,
          data: Object.fromEntries(
            data.map((entry) => [entry.account.id!, entry]),
          ),
        });
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setSummaryResult((previous) => ({
            seasonId: season.id,
            loaded: previous?.seasonId === season.id && previous.loaded,
            data: previous?.seasonId === season.id ? previous.data : {},
            error:
              cause instanceof Error
                ? cause.message
                : "Unable to load season hours.",
          }));
      });
    return () => controller.abort();
  }, [season, ticketRevision]);
  useEffect(() => {
    if (!season || params.get("season") === season.id) return;
    const query = new URLSearchParams(window.location.search);
    query.set("season", season.id);
    window.history.replaceState(null, "", `?${query}`);
  }, [season, params]);
  const locked =
    activeEditor !== null ||
    ticketEditing ||
    composer !== null ||
    seasonDialog ||
    athleteEditing;
  const seasonSelector = (
    <label className="relative grid gap-1 text-xs font-semibold leading-4">
      <span className="sr-only">Workshare season</span>
      <select
        value={season?.id ?? ""}
        disabled={locked || loading || !seasons.length}
        className={`h-11 max-w-64 rounded-lg border border-border bg-surface px-3 text-sm ${styles.select}`}
        onChange={(event) => selectView({ season: event.target.value })}
      >
        {!seasons.length && <option value="">No seasons yet</option>}
        {seasons.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </label>
  );
  const rowProps = {
    season,
    summaryLoading,
    summaryError,
    onRequirementsSaved: requirementsSaved,
    onAddTicket: addTicket,
    onReuse: reuseTicket,
    ticketRevision,
    onTicketsChanged: ticketsChanged,
    allAccounts: accounts,
    practiceGroups: groups.map((group) => group.name),
    onTicketEditingChange: setTicketEditing,
  };
  const term = search.trim().toLowerCase();
  const filtered = accounts
    .filter((account) => {
      if (account.id === newAccount?.id) return false;
      if (
        !editing &&
        archive !== "all" &&
        account.isArchived !== (archive === "archived")
      )
        return false;
      return (
        !term ||
        [
          account.fullName,
          ...account.emails,
          ...account.athletes.flatMap((athlete) => [
            athlete.fullName,
            athlete.trainingGroup,
            athlete.timesAthleteId || "",
          ]),
        ].some((value) => value.toLowerCase().includes(term))
      );
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const saved = (next: WorkshareAccount) => {
    setAccounts((previous) => [
      ...previous.filter((account) => account.id !== next.id),
      next,
    ]);
  };
  return (
    <div
      ref={workspace}
      className={editing ? styles.workspaceEditing : styles.workspace}
      style={{ "--account-list-width": `${listWidth}%` } as CSSProperties}
    >
      <div className={styles.browserPane}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className={styles.tabs}>
            <div role="tablist" aria-label="Admin sections" className="flex">
              {adminTabs.map((value) => (
                <button
                  key={value}
                  id={`${tabId}-${value}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  aria-controls={`${tabId}-panel`}
                  tabIndex={tab === value ? 0 : -1}
                  onKeyDown={(event) => {
                    if (
                      locked ||
                      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                        event.key,
                      )
                    )
                      return;
                    event.preventDefault();
                    const index = adminTabs.indexOf(value);
                    const target =
                      event.key === "Home"
                        ? adminTabs[0]
                        : event.key === "End"
                          ? adminTabs[adminTabs.length - 1]
                          : adminTabs[
                              (index +
                                (event.key === "ArrowRight" ? 1 : -1) +
                                adminTabs.length) %
                                adminTabs.length
                            ];
                    selectView({ tab: target });
                    document.getElementById(`${tabId}-${target}`)?.focus();
                  }}
                  disabled={locked}
                  className={styles.tabButton}
                  onClick={() => selectView({ tab: value })}
                >
                  {value === "accounts"
                    ? "Accounts"
                    : value === "athletes"
                      ? "Athletes"
                      : "Tickets"}
                </button>
              ))}
            </div>
          </div>
          {tab !== "athletes" && (
            <div className="flex flex-wrap items-end gap-2">
              <button
                type="button"
                className={styles.tabButton}
                disabled={
                  switching ||
                  ticketEditing ||
                  !!composer ||
                  seasonDialog ||
                  loading ||
                  !!error
                }
                onClick={() => void selectAccount(null)}
              >
                <Plus className="size-4" aria-hidden="true" />
                Add account
              </button>
              {tab === "tickets" && (
                <Button
                  size="sm"
                  disabled={locked || loading || !!error || !season}
                  onClick={() => addTicket()}
                >
                  Add ticket
                </Button>
              )}
              {tab === "tickets" && seasonSelector}
              {!seasons.length && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={locked || loading || !!error}
                  onClick={() => setSeasonDialog(true)}
                >
                  Create first season
                </Button>
              )}
            </div>
          )}
        </div>
        {tab !== "athletes" && !loading && !seasons.length && !error && (
          <div className="rounded-xl border border-border bg-surface p-4 text-sm text-text-secondary">
            Create the first season to adopt the required hours already entered
            and start adding completed-hours tickets.
          </div>
        )}
        {tab !== "athletes" &&
          summaryResult?.seasonId === season?.id &&
          summaryResult?.error && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-4 text-sm"
            >
              <p>{summaryResult.error}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={ticketsChanged}
              >
                Retry season hours
              </Button>
            </div>
          )}
        <div
          role="tabpanel"
          id={`${tabId}-panel`}
          aria-labelledby={`${tabId}-${tab}`}
          className={styles.tabPanel}
        >
          {tab === "athletes" ? (
            <AthletesPanel
              onOpenAccount={(id) => {
                const account = accounts.find((item) => item.id === id);
                if (account) void selectAccount(account);
              }}
              onEditingChange={setAthleteEditing}
              onLoaded={(data) => {
                setAccounts(data.accounts);
                setGroups(data.groups);
              }}
            />
          ) : tab === "accounts" ? (
            <>
              <section aria-label="Account list" className={styles.listPane}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative min-w-56 flex-1">
                    <Search
                      className="pointer-events-none absolute left-3 top-3 size-4 text-text-secondary"
                      aria-hidden="true"
                    />
                    <Input
                      data-account-search
                      aria-label="Search accounts and athletes"
                      type="search"
                      className="pl-9"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search names, emails, or athletes…"
                    />
                  </div>
                  {!editing && (
                    <>
                      {seasonSelector}
                      <select
                        aria-label="Account archive filter"
                        className={`h-11 rounded-lg border border-border bg-surface px-3 text-sm ${styles.select}`}
                        value={archive}
                        onChange={(event) => setArchive(event.target.value)}
                      >
                        <option value="active">Active</option>
                        <option value="archived">Archived</option>
                        <option value="all">All</option>
                      </select>
                      {!editing && (
                        <ColumnControls
                          columns={columns}
                          onChange={setColumns}
                        />
                      )}
                      <span className="text-xs text-text-secondary">
                        {filtered.length} of {accounts.length} accounts
                      </span>
                    </>
                  )}
                </div>
                {error ? (
                  <div
                    role="alert"
                    className="space-y-3 rounded-xl border border-border p-5"
                  >
                    <p>{error}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setLoading(true);
                        setAttempt(attempt + 1);
                      }}
                    >
                      Retry
                    </Button>
                  </div>
                ) : (
                  <div data-accounts-table className={styles.tableScroll}>
                    <table
                      className={`${styles.table} ${editing ? styles.compactTable : ""}`}
                    >
                      <caption className="sr-only">
                        {editing
                          ? "Select an account to edit"
                          : "Accounts, athlete roster, and completed / required hours"}
                      </caption>
                      <thead className="bg-bg text-xs text-text-secondary">
                        <tr>
                          <th scope="col" className="px-4 py-3 font-semibold">
                            Account
                          </th>
                          {!editing &&
                            accountColumns
                              .filter(([key]) => columns[key])
                              .map(([key, title]) => (
                                <th
                                  key={key}
                                  scope="col"
                                  className="whitespace-nowrap px-4 py-3 font-semibold"
                                >
                                  {title}
                                </th>
                              ))}
                          {!editing && (
                            <th scope="col" className="px-4 py-3 font-semibold">
                              Actions
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {loading ? (
                          <tr>
                            <td
                              colSpan={
                                editing
                                  ? 1
                                  : 2 +
                                    accountColumns.filter(
                                      ([key]) => columns[key],
                                    ).length
                              }
                              role="status"
                              className="p-8 text-center text-text-secondary"
                            >
                              Loading accounts…
                            </td>
                          </tr>
                        ) : (
                          filtered.map((account) => (
                            <AccountTableRow
                              key={account.id}
                              account={account}
                              season={season}
                              summary={summaries[account.id!]}
                              summaryLoading={summaryLoading}
                              summaryError={summaryError}
                              columns={columns}
                              compact={editing}
                              selected={account.id === selectedAccount?.id}
                              disabled={
                                switching || ticketEditing || !!composer
                              }
                              onSelect={() => void selectAccount(account)}
                              onAddTicket={() => addTicket(account.id)}
                            />
                          ))
                        )}
                        {!loading && !adding && filtered.length === 0 && (
                          <tr>
                            <td
                              colSpan={
                                editing
                                  ? 1
                                  : 2 +
                                    accountColumns.filter(
                                      ([key]) => columns[key],
                                    ).length
                              }
                              className="p-8 text-center text-text-secondary"
                            >
                              {accounts.length
                                ? "No accounts match these filters."
                                : "No accounts yet. Add an account to start."}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          ) : season ? (
            <TicketsPanel
              key={season.id}
              season={season}
              accounts={accounts}
              revision={ticketRevision}
              onChanged={ticketsChanged}
              onAdd={addTicket}
              onReuse={reuseTicket}
              onEditingChange={setTicketEditing}
            />
          ) : (
            <p className="rounded-xl border border-border bg-surface p-6 text-sm text-text-secondary">
              Create a season to begin tracking tickets.
            </p>
          )}
        </div>
      </div>
      {selectedAccount && (
        <>
          <AccountPaneDivider
            container={workspace}
            value={listWidth}
            onChange={setListWidth}
            editorId={editorId}
          />
          <aside
            id={editorId}
            aria-label="Account editor"
            className={styles.editorPane}
          >
            <AccountEditor
              {...rowProps}
              key={`${activeEditor}-${editorSession}`}
              ref={editor}
              switching={switching || ticketEditing || !!composer}
              account={selectedAccount}
              summary={
                selectedAccount.id ? summaries[selectedAccount.id] : undefined
              }
              onSaved={(next) => {
                saved(next);
                if (activeEditor === "new") setNewAccount(next);
              }}
              onClose={closeEditor}
            />
          </aside>
        </>
      )}
      {seasonDialog && (
        <SeasonDialog
          seasons={seasons}
          selectedSeasonId={season?.id}
          onClose={() => setSeasonDialog(false)}
          onCreated={(next) => {
            setSeasons((previous) =>
              [...previous.filter((item) => item.id !== next.id), next].sort(
                (a, b) => a.startsOn.localeCompare(b.startsOn),
              ),
            );
            setSeasonDialog(false);
            selectView({ season: next.id });
          }}
        />
      )}
      {composer && season && (
        <TicketComposer
          key={season.id}
          season={season}
          accounts={accounts}
          accountId={composer.accountId}
          template={composer.template}
          onChanged={ticketsChanged}
          onClose={() => setComposer(null)}
        />
      )}
    </div>
  );
}
