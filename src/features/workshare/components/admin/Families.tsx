"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Download, Link2, Plus, Search } from "lucide-react";
import { Input } from "@/components/shared/Input";
import { Button } from "@/components/shared/Button";
import { useUpdateBlocker } from "@/hooks/useUpdateBlocker";
import {
  searchAccountAthletes,
  type AccountAthlete,
} from "@/lib/account-athletes";
import {
  emptyAccount,
  exportWorkshareAccounts,
  loadWorkshareAccounts,
  type RosterAthlete,
  type WorkshareAccount,
} from "../../lib/accounts";
import { useAccountAutosave } from "../../lib/use-account-autosave";
import {
  defaultSeason,
  loadSeasons,
  loadAccountSummaries,
  type AccountSeasonSummary,
  type SeasonRequirements,
  type WorkshareSeason,
  type WorkshareTicket,
} from "../../lib/tickets";
import {
  RequirementsEditor,
  type RequirementsHandle,
} from "./RequirementsEditor";
import { TicketComposer } from "./TicketComposer";
import { TicketsPanel } from "./TicketsPanel";
import { SeasonDialog } from "./SeasonDialog";

const trainingGroups = [
  "Splash",
  "Pre-Team",
  "Prep",
  "Age Groupers",
  "Juniors",
  "Seniors",
  "Masters",
  "Rec Team",
  "Coaches",
  "Board Members",
];
const requirementFields = [
  ["generalHoursRequired", "General"],
  ["starlightHoursRequired", "Starlight"],
  ["appleCapitalHoursRequired", "Apple Capital"],
] as const;

function TimesLink({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{
    query: string;
    matches: AccountAthlete[];
    failed?: boolean;
  }>();
  const term = query.trim();
  useEffect(() => {
    if (term.length < 2) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      void searchAccountAthletes(term, controller.signal)
        .then((matches) => {
          if (!controller.signal.aborted) setResult({ query: term, matches });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setResult({ query: term, matches: [], failed: true });
        });
    }, 250);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [term]);
  const current = result?.query === term ? result : undefined;
  if (value)
    return (
      <div className="flex min-h-11 items-center gap-2 text-xs">
        <span className="break-all">Times ID: {value}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setQuery("");
            onChange(null);
          }}
        >
          Unlink
        </Button>
      </div>
    );
  return (
    <div className="space-y-2">
      <Input
        aria-label="Search Times database"
        type="search"
        maxLength={100}
        value={query}
        placeholder="Find swimmer in Times…"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
          if (event.key === "Escape") setQuery("");
        }}
      />
      {term.length >= 2 && (
        <div
          className="max-h-44 overflow-y-auto rounded-lg border border-border bg-surface text-xs"
          aria-live="polite"
        >
          {!current ? (
            <p className="p-3">Searching…</p>
          ) : current.failed ? (
            <p role="alert" className="p-3">
              Times search unavailable. Edit the search to retry.
            </p>
          ) : current.matches.length === 0 ? (
            <p className="p-3">No swimmers found.</p>
          ) : (
            <ul aria-label="Times swimmer matches">
              {current.matches.map((athlete) => (
                <li key={athlete.id}>
                  <button
                    type="button"
                    className="w-full p-3 text-left hover:bg-bg focus-visible:outline-accent"
                    onClick={() => {
                      onChange(athlete.id);
                      setQuery("");
                    }}
                  >
                    <span className="block font-semibold">{athlete.name}</span>
                    <span>
                      {athlete.teamName || "No team listed"} · {athlete.id}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ArchiveToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border bg-surface px-3.5 py-2 text-xs font-medium transition-colors ${checked ? "border-accent" : "border-border"}`}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        aria-hidden="true"
        className={`flex size-4 shrink-0 items-center justify-center rounded border peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface ${checked ? "border-accent bg-accent text-white" : "border-border bg-bg"}`}
      >
        <Check className={`size-3 ${checked ? "opacity-100" : "opacity-0"}`} />
      </span>
      {label}
    </label>
  );
}

function AccountRow({
  account,
  onSaved,
  onEditingChange,
  anotherEditing = false,
  onClose,
  groups,
  season,
  summary,
  summaryLoading,
  summaryError,
  onRequirementsSaved,
  onAddTicket,
  onReuse,
  ticketRevision,
  onTicketsChanged,
  allAccounts,
  onTicketEditingChange,
}: {
  account: WorkshareAccount;
  onSaved: (account: WorkshareAccount) => void;
  onEditingChange: (editing: boolean) => void;
  anotherEditing?: boolean;
  onClose?: () => void;
  groups: string[];
  season?: WorkshareSeason;
  summary?: AccountSeasonSummary;
  summaryLoading: boolean;
  summaryError?: string;
  onRequirementsSaved: (requirements: SeasonRequirements) => void;
  onAddTicket: (accountId: string) => void;
  onReuse: (ticket: WorkshareTicket) => void;
  ticketRevision: number;
  onTicketsChanged: () => void;
  allAccounts: WorkshareAccount[];
  onTicketEditingChange: (editing: boolean) => void;
}) {
  const [editing, setEditing] = useState(!account.id);
  const {
    draft,
    setDraft,
    emails,
    setEmails,
    busy,
    dirty,
    error,
    saved,
    reloadRequired,
    flush,
    reset,
  } = useAccountAutosave(account, onSaved);
  const [closing, setClosing] = useState(false);
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  const requirementsEditor = useRef<RequirementsHandle>(null);
  const editingCallback = useRef(onEditingChange);
  useEffect(() => {
    editingCallback.current = onEditingChange;
  }, [onEditingChange]);
  useEffect(() => {
    if (!editing) return;
    return () => editingCallback.current(false);
  }, [editing]);
  const reloadRequested = useRef(false);
  useUpdateBlocker(dirty || busy);
  useEffect(() => {
    if (editing)
      form.current?.closest("[data-accounts-table]")?.scrollTo({ left: 0 });
  }, [editing]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!reloadRequested.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, busy]);
  const begin = () => {
    if (anotherEditing) return;
    reset(account);
    setEditing(true);
    onEditingChange(true);
  };
  const changeAthlete = (index: number, changes: Partial<RosterAthlete>) =>
    setDraft((previous) => ({
      ...previous,
      athletes: previous.athletes.map((athlete, i) =>
        i === index ? { ...athlete, ...changes } : athlete,
      ),
    }));
  const close = async () => {
    if (closing) return;
    setClosing(true);
    try {
      const results = await Promise.all([
        flush(),
        requirementsEditor.current?.flush() ?? Promise.resolve(true),
      ]);
      if (results.some((saved) => !saved)) {
        form.current?.reportValidity();
        return;
      }
      setEditing(false);
      onEditingChange(false);
      onClose?.();
    } finally {
      setClosing(false);
    }
  };
  const cell = "align-top px-4 py-4";
  if (!editing)
    return (
      <tr
        className={`border-t border-border focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${anotherEditing ? "" : "cursor-pointer hover:bg-bg/40"} ${account.isArchived ? "bg-bg/60" : ""}`}
        tabIndex={anotherEditing ? -1 : 0}
        onClick={begin}
        onKeyDown={(event) => {
          if (
            event.target === event.currentTarget &&
            (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault();
            begin();
          }
        }}
      >
        <td className={cell}>
          <p className="font-semibold">
            {account.fullName}
            {account.isArchived && (
              <span className="ml-2 text-xs text-text-secondary">
                Archived account
              </span>
            )}
          </p>
          <ul className="mt-1 space-y-1 text-xs text-text-secondary">
            {account.emails.map((email) => (
              <li key={email} className="break-all">
                {email}
              </li>
            ))}
          </ul>
        </td>
        <td className={cell}>
          {account.athletes.length === 0 ? (
            <span className="text-xs text-text-secondary">No athletes</span>
          ) : (
            <ul className="space-y-3">
              {account.athletes.map((athlete) => (
                <li key={athlete.id}>
                  <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-medium">
                    <span>{athlete.fullName}</span>
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
                      <span className="ml-2 text-xs text-text-secondary">
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
        {requirementFields.map(([field], index) => {
          const completed =
            summary?.completed[
              (["general", "starlight", "appleCapital"] as const)[index]
            ] ?? 0;
          const required = season
            ? (summary?.requirements[field] ?? null)
            : account[field];
          return (
            <td key={field} className={`${cell} tabular-nums`}>
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
        <td className={cell}>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={anotherEditing}
            onClick={(event) => {
              event.stopPropagation();
              begin();
            }}
          >
            Edit<span className="sr-only"> {account.fullName}</span>
          </Button>
          {account.id && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mt-2 block whitespace-nowrap"
              disabled={anotherEditing || !season}
              aria-label={`Add ticket for ${account.fullName}`}
              onClick={(event) => {
                event.stopPropagation();
                onAddTicket(account.id!);
              }}
            >
              Add ticket
            </Button>
          )}
          {saved && (
            <p role="status" className="mt-2 text-xs text-accent">
              Saved
            </p>
          )}
        </td>
      </tr>
    );
  return (
    <tr className="border-t-2 border-accent bg-bg/40">
      <td colSpan={6} className="p-4 sm:p-5">
        <form
          ref={form}
          id={formId}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void Promise.all([flush(), requirementsEditor.current?.flush()]);
          }}
          className="w-[calc(100cqw-2rem-2px)] max-w-7xl space-y-5 sm:w-[calc(100cqw-2.5rem-2px)]"
          aria-label={account.id ? `Edit ${account.fullName}` : "New account"}
        >
          <fieldset
            disabled={closing}
            className="space-y-5 disabled:opacity-60"
          >
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <label className="grid w-full min-w-0 max-w-xs content-start gap-1 text-xs font-semibold leading-4">
                <span>Account full name</span>
                <Input
                  required
                  maxLength={200}
                  autoFocus
                  value={draft.fullName}
                  onChange={(event) =>
                    setDraft({ ...draft, fullName: event.target.value })
                  }
                />
              </label>
              <label className="grid w-full min-w-0 max-w-sm content-start gap-1 text-xs font-semibold leading-4">
                <span>Account / athlete emails</span>
                <textarea
                  rows={3}
                  className="block w-full rounded-lg border border-border bg-surface p-3 text-sm font-normal"
                  value={emails}
                  placeholder="One email per line"
                  onChange={(event) => setEmails(event.target.value)}
                />
              </label>
              <div className="w-fit self-start xl:pt-5">
                <ArchiveToggle
                  label="Archive account"
                  checked={draft.isArchived}
                  onChange={(isArchived) => setDraft({ ...draft, isArchived })}
                />
              </div>
            </div>
            {season && draft.id && !summaryLoading ? (
              <RequirementsEditor
                key={`${season.id}-${draft.id}`}
                ref={requirementsEditor}
                requirements={
                  summary?.requirements ?? {
                    accountId: draft.id,
                    seasonId: season.id,
                    generalHoursRequired: null,
                    starlightHoursRequired: null,
                    appleCapitalHoursRequired: null,
                    updatedAt: null,
                  }
                }
                onSaved={onRequirementsSaved}
              />
            ) : (
              <p className="text-xs text-text-secondary">
                {!season
                  ? "Create a season to manage required hours and tickets. Existing requirements will be adopted into the first season."
                  : summaryError
                    ? "Season hours are unavailable. Retry loading season hours above."
                    : summaryLoading
                      ? "Loading season requirements…"
                      : "Required hours are available after this account is created."}
              </p>
            )}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Athletes</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setDraft((previous) => ({
                      ...previous,
                      athletes: [
                        ...previous.athletes,
                        {
                          fullName: "",
                          trainingGroup: "",
                          timesAthleteId: null,
                          isArchived: false,
                        },
                      ],
                    }))
                  }
                >
                  <Plus className="mr-1 size-3" aria-hidden="true" />
                  Add athlete
                </Button>
              </div>
              {draft.athletes.map((athlete, index) => (
                <div
                  key={index}
                  className="grid items-start gap-3 rounded-xl border border-border bg-surface p-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1.4fr_auto]"
                >
                  <label className="grid w-full min-w-0 max-w-xs content-start gap-1 text-xs font-semibold leading-4">
                    <span>Athlete full name</span>
                    <Input
                      required
                      maxLength={200}
                      value={athlete.fullName}
                      onChange={(event) =>
                        changeAthlete(index, { fullName: event.target.value })
                      }
                    />
                  </label>
                  <label className="grid w-full min-w-0 max-w-64 content-start gap-1 text-xs font-semibold leading-4">
                    <span>Training group</span>
                    <select
                      className="block h-11 w-full min-w-0 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm text-text-primary transition-all focus-visible:border-[#0A856C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
                      value={athlete.trainingGroup}
                      onChange={(event) =>
                        changeAthlete(index, {
                          trainingGroup: event.target.value,
                        })
                      }
                    >
                      <option value="">Select training group</option>
                      {[
                        ...new Set([
                          ...trainingGroups,
                          ...groups,
                          athlete.trainingGroup,
                        ]),
                      ]
                        .filter(Boolean)
                        .map((group) => (
                          <option key={group} value={group}>
                            {group}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="grid w-full min-w-0 max-w-sm content-start gap-1">
                    <p className="text-xs font-semibold leading-4">
                      Times database linkage
                    </p>
                    <TimesLink
                      value={athlete.timesAthleteId}
                      onChange={(timesAthleteId) =>
                        changeAthlete(index, { timesAthleteId })
                      }
                    />
                  </div>
                  <div className="w-fit space-y-2 sm:pt-5">
                    <ArchiveToggle
                      label="Archive athlete"
                      checked={athlete.isArchived}
                      onChange={(isArchived) =>
                        changeAthlete(index, { isArchived })
                      }
                    />
                    {!athlete.id && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setDraft((previous) => ({
                            ...previous,
                            athletes: previous.athletes.filter(
                              (_, i) => i !== index,
                            ),
                          }))
                        }
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {draft.athletes.length === 0 && (
                <p className="text-xs text-text-secondary">
                  No athletes on this account.
                </p>
              )}
            </div>
            {season && draft.id && (
              <section
                aria-label="Account tickets"
                className="space-y-3 border-t border-border pt-5"
              >
                <h3 className="text-sm font-semibold">
                  Tickets · {season.name}
                </h3>
                <TicketsPanel
                  season={season}
                  accounts={allAccounts}
                  accountId={draft.id}
                  revision={ticketRevision}
                  onChanged={onTicketsChanged}
                  onAdd={() => onAddTicket(draft.id!)}
                  onReuse={onReuse}
                  onEditingChange={onTicketEditingChange}
                />
              </section>
            )}
            <p className="text-xs text-text-secondary">
              Leave unknown requirements blank. Enter 0 when no hours are
              required. Tickets count toward the selected season’s completed
              hours.
            </p>
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                size="sm"
                disabled={closing || reloadRequired}
                onClick={() => void close()}
              >
                {closing ? "Finishing…" : "Done"}
              </Button>
              {!draft.id && !reloadRequired && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || closing}
                  onClick={() => {
                    reset(emptyAccount());
                    setEditing(false);
                    onEditingChange(false);
                    onClose?.();
                  }}
                >
                  Cancel
                </Button>
              )}
              {error && !reloadRequired && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || closing}
                  onClick={() => void flush()}
                >
                  Retry save
                </Button>
              )}
              {reloadRequired && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    reloadRequested.current = true;
                    window.location.reload();
                  }}
                >
                  Reload accounts
                </Button>
              )}
              <p role="status" className="text-xs text-text-secondary">
                {busy
                  ? "Saving…"
                  : error
                    ? "Changes not saved"
                    : dirty
                      ? "Waiting to save…"
                      : saved
                        ? "All changes saved"
                        : "Changes save automatically"}
              </p>
            </div>
          </fieldset>
        </form>
      </td>
    </tr>
  );
}

export function FamiliesAdmin() {
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
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get("tab") === "tickets" ? "tickets" : "accounts";
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
  function selectView(next: { tab?: string; season?: string }) {
    const query = new URLSearchParams(params.toString());
    if (next.tab) query.set("tab", next.tab);
    if (next.season) query.set("season", next.season);
    else if (season) query.set("season", season.id);
    router.replace(`/tools/admin?${query}`, { scroll: false });
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
  const [group, setGroup] = useState("");
  const [newAccount, setNewAccount] = useState<WorkshareAccount | null>(null);
  const adding = newAccount !== null;
  const [activeEditor, setActiveEditor] = useState<string | null>(null);
  const [editorName, setEditorName] = useState("");
  useUpdateBlocker(loading);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      loadWorkshareAccounts(controller.signal),
      loadSeasons(controller.signal),
    ])
      .then(([data, loadedSeasons]) => {
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
    const query = new URLSearchParams(params.toString());
    query.set("season", season.id);
    router.replace(`/tools/admin?${query}`, { scroll: false });
  }, [season, params, router]);
  const locked =
    activeEditor !== null || ticketEditing || composer !== null || seasonDialog;
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
    onTicketEditingChange: setTicketEditing,
  };
  const groups = [
    ...new Set(
      accounts
        .flatMap((account) =>
          account.athletes.map((athlete) => athlete.trainingGroup),
        )
        .filter(Boolean),
    ),
  ].sort();
  const term = search.trim().toLowerCase();
  const filtered = accounts
    .filter((account) => {
      if (account.id === newAccount?.id) return false;
      if (account.id === activeEditor) return true;
      if (archive !== "all" && account.isArchived !== (archive === "archived"))
        return false;
      if (
        group &&
        !account.athletes.some((athlete) => athlete.trainingGroup === group)
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
    .sort((a, b) => {
      const first = a.id === activeEditor ? editorName : a.fullName;
      const second = b.id === activeEditor ? editorName : b.fullName;
      return first.localeCompare(second);
    });
  const saved = (next: WorkshareAccount) => {
    setAccounts((previous) => [
      ...previous.filter((account) => account.id !== next.id),
      next,
    ]);
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            {tab === "accounts" ? "Accounts & Roster" : "Workshare Tickets"}
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            Manage accounts, seasonal requirements, and completed Workshare
            hours.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={loading || !!error}
            onClick={() => exportWorkshareAccounts(accounts)}
          >
            <Download className="mr-1.5 size-4" aria-hidden="true" />
            Export JSON
          </Button>
          {tab === "accounts" ? (
            <Button
              size="sm"
              disabled={locked || loading || !!error}
              onClick={() => {
                setNewAccount(emptyAccount());
                setActiveEditor("new");
              }}
            >
              <Plus className="mr-1.5 size-4" aria-hidden="true" />
              Add account
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={locked || loading || !!error || !season}
              onClick={() => addTicket()}
            >
              <Plus className="mr-1.5 size-4" aria-hidden="true" />
              Add ticket
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Admin sections"
          className="flex rounded-lg border border-border bg-surface p-1"
        >
          {(["accounts", "tickets"] as const).map((value) => (
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
                const target =
                  event.key === "Home"
                    ? "accounts"
                    : event.key === "End"
                      ? "tickets"
                      : value === "accounts"
                        ? "tickets"
                        : "accounts";
                selectView({ tab: target });
                document.getElementById(`${tabId}-${target}`)?.focus();
              }}
              disabled={locked}
              className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${tab === value ? "bg-accent text-primary-ink" : "text-text-secondary hover:bg-bg"}`}
              onClick={() => selectView({ tab: value })}
            >
              {value === "accounts" ? "Accounts" : "Tickets"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs font-semibold leading-4">
            <span>Workshare season</span>
            <select
              value={season?.id ?? ""}
              disabled={locked || loading || !seasons.length}
              className="h-11 max-w-64 rounded-lg border border-border bg-surface px-3 text-sm"
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
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={locked || loading || !!error}
            onClick={() => setSeasonDialog(true)}
          >
            {seasons.length ? "New season" : "Create first season"}
          </Button>
        </div>
      </div>
      {!loading && !seasons.length && !error && (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm text-text-secondary">
          Create the first season to adopt the required hours already entered
          and start adding completed-hours tickets.
        </div>
      )}
      {summaryResult?.seasonId === season?.id && summaryResult?.error && (
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
        className="space-y-5"
      >
        {tab === "accounts" ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-56 flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-3 size-4 text-text-secondary"
                  aria-hidden="true"
                />
                <Input
                  disabled={activeEditor !== null}
                  aria-label="Search accounts and athletes"
                  type="search"
                  className="pl-9"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search names, emails, or athletes…"
                />
              </div>
              <select
                disabled={activeEditor !== null}
                aria-label="Account archive filter"
                className="h-11 rounded-lg border border-border bg-surface px-3 text-sm"
                value={archive}
                onChange={(event) => setArchive(event.target.value)}
              >
                <option value="active">Active accounts</option>
                <option value="archived">Archived accounts</option>
                <option value="all">All accounts</option>
              </select>
              <select
                disabled={activeEditor !== null}
                aria-label="Training group filter"
                className="h-11 max-w-full rounded-lg border border-border bg-surface px-3 text-sm"
                value={group}
                onChange={(event) => setGroup(event.target.value)}
              >
                <option value="">All training groups</option>
                {groups.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
              <span className="text-xs text-text-secondary">
                {filtered.length} of {accounts.length} accounts
              </span>
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
              <div
                data-accounts-table
                className="relative overflow-x-auto rounded-xl border border-border bg-surface [container-type:inline-size]"
              >
                <table className="w-full min-w-[900px] text-left text-sm">
                  <caption className="sr-only">
                    Accounts, athlete roster, and completed / required hours
                  </caption>
                  <thead className="bg-bg text-xs text-text-secondary">
                    <tr>
                      {[
                        "Account",
                        "Athletes",
                        "General",
                        "Starlight",
                        "Apple Capital",
                        "Actions",
                      ].map((title) => (
                        <th
                          scope="col"
                          key={title}
                          className="px-4 py-3 font-semibold"
                        >
                          {title}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {newAccount && (
                      <AccountRow
                        {...rowProps}
                        account={newAccount}
                        summary={
                          newAccount.id ? summaries[newAccount.id] : undefined
                        }
                        groups={groups}
                        onSaved={(next) => {
                          saved(next);
                          setNewAccount(next);
                        }}
                        onEditingChange={(editing) =>
                          setActiveEditor(editing ? "new" : null)
                        }
                        onClose={() => setNewAccount(null)}
                      />
                    )}
                    {loading ? (
                      <tr>
                        <td
                          colSpan={6}
                          role="status"
                          className="p-8 text-center text-text-secondary"
                        >
                          Loading accounts…
                        </td>
                      </tr>
                    ) : (
                      filtered.map((account) => (
                        <AccountRow
                          {...rowProps}
                          summary={summaries[account.id!]}
                          key={`${account.id}-${season?.id ?? "unscoped"}`}
                          account={account}
                          groups={groups}
                          onSaved={saved}
                          anotherEditing={
                            activeEditor !== null && activeEditor !== account.id
                          }
                          onEditingChange={(editing) => {
                            setActiveEditor(editing ? account.id! : null);
                            if (editing) setEditorName(account.fullName);
                          }}
                        />
                      ))
                    )}
                    {!loading && !adding && filtered.length === 0 && (
                      <tr>
                        <td
                          colSpan={6}
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
