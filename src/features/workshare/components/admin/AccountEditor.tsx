"use client";

import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { Check, Plus } from "lucide-react";
import { Input } from "@/components/shared/Input";
import { Button } from "@/components/shared/Button";
import { useUpdateBlocker } from "@/hooks/useUpdateBlocker";
import {
  searchAccountAthletes,
  type AccountAthlete,
} from "@/lib/account-athletes";
import {
  emptyAccount,
  type RosterAthlete,
  type WorkshareAccount,
} from "../../lib/accounts";
import { useAccountAutosave } from "../../lib/use-account-autosave";
import {
  type AccountSeasonSummary,
  type SeasonRequirements,
  type WorkshareSeason,
  type WorkshareTicket,
} from "../../lib/tickets";
import {
  RequirementsEditor,
  type RequirementsHandle,
} from "./RequirementsEditor";
import { TicketsPanel } from "./TicketsPanel";
import styles from "./Accounts.module.css";

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

export interface AccountEditorHandle {
  flush: () => Promise<boolean>;
}

export function AccountEditor({
  account,
  onSaved,
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
  ref,
  switching,
}: {
  account: WorkshareAccount;
  onSaved: (account: WorkshareAccount) => void;
  onClose: () => void;
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
  ref: Ref<AccountEditorHandle>;
  switching: boolean;
}) {
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
  const reloadRequested = useRef(false);
  useEffect(() => {
    const panel = form.current?.closest("aside");
    if (panel) panel.scrollTop = 0;
    form.current
      ?.querySelector<HTMLInputElement>("[data-account-name]")
      ?.focus({ preventScroll: true });
    if (window.matchMedia("(max-width: 900px)").matches)
      form.current?.scrollIntoView({ block: "start" });
  }, []);
  useUpdateBlocker(dirty || busy);
  useEffect(() => {
    if (!dirty && !busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!reloadRequested.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, busy]);
  async function flushAll() {
    const results = await Promise.all([
      flush(),
      requirementsEditor.current?.flush() ?? Promise.resolve(true),
    ]);
    if (results.some((result) => !result)) {
      form.current?.reportValidity();
      form.current
        ?.querySelector<HTMLElement>('[role="alert"]')
        ?.scrollIntoView({ block: "nearest" });
      return false;
    }
    return true;
  }
  useImperativeHandle(ref, () => ({ flush: flushAll }));
  const changeAthlete = (index: number, changes: Partial<RosterAthlete>) =>
    setDraft((previous) => ({
      ...previous,
      athletes: previous.athletes.map((athlete, i) =>
        i === index ? { ...athlete, ...changes } : athlete,
      ),
    }));
  async function close() {
    if (closing || switching) return;
    setClosing(true);
    try {
      if (await flushAll()) onClose();
    } finally {
      setClosing(false);
    }
  }
  return (
    <form
      ref={form}
      id={formId}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void Promise.all([flush(), requirementsEditor.current?.flush()]);
      }}
      className={styles.editorForm}
      aria-label={account.id ? `Edit ${account.fullName}` : "New account"}
    >
      <div className={styles.editorHeader}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Account editor
          </p>
          <h2 className="mt-1 break-words text-lg font-bold">
            {draft.fullName || "New account"}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="sm"
            disabled={closing || switching || reloadRequired}
            onClick={() => void close()}
          >
            {closing ? "Finishing…" : "Done"}
          </Button>
          {!draft.id && !reloadRequired && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || closing || switching}
              onClick={() => {
                reset(emptyAccount());
                onClose();
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
              disabled={busy || closing || switching}
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
      </div>
      <fieldset
        disabled={closing || switching}
        className="space-y-5 disabled:opacity-60"
      >
        {season && draft.id && (
          <section
            aria-label="Tickets and work completed"
            className="border-b border-border pb-5"
          >
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
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid w-full min-w-0 max-w-xs content-start gap-1 text-xs font-semibold leading-4">
            <span>Account full name</span>
            <Input
              required
              data-account-name
              maxLength={200}
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
          <div className="w-fit self-start">
            <ArchiveToggle
              label="Archive account"
              checked={draft.isArchived}
              onChange={(isArchived) => setDraft({ ...draft, isArchived })}
            />
          </div>
        </div>
        <section
          aria-label="Workshare settings"
          className="space-y-3 border-t border-border pt-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Require Workshare</h3>
              <p className="mt-1 text-xs text-text-secondary">
                Applies to this account across all seasons.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="Require Workshare"
              aria-checked={draft.requireWorkshare !== false}
              className={styles.requireToggle}
              onClick={() =>
                setDraft({
                  ...draft,
                  requireWorkshare: draft.requireWorkshare === false,
                })
              }
            >
              <span aria-hidden="true" className={styles.switchTrack}>
                <span />
              </span>
              {draft.requireWorkshare === false ? "No" : "Yes"}
            </button>
          </div>
          {draft.requireWorkshare === false && (
            <p className="text-xs text-text-secondary">
              Workshare is not required. Saved quotas and completed tickets are
              retained.
            </p>
          )}
          <label className="grid gap-1 text-xs font-semibold">
            <span>Note to Account</span>
            <textarea
              rows={3}
              maxLength={2000}
              aria-label="Note to Account"
              aria-describedby={`${formId}-note-help`}
              className="w-full rounded-lg border border-border bg-surface p-3 text-sm font-normal"
              placeholder="A note about this account’s workshare hours…"
              value={draft.workshareNote ?? ""}
              onChange={(event) =>
                setDraft({ ...draft, workshareNote: event.target.value })
              }
            />
            <span
              id={`${formId}-note-help`}
              className="font-normal text-text-secondary"
            >
              Shown on the account holder’s Workshare Tracking page.
            </span>
          </label>
          <h3 className="text-sm font-semibold">
            Required hours{season ? ` · ${season.name}` : ""}
          </h3>
          {season && draft.id && !summaryLoading && !summaryError ? (
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
        </section>
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
              className="grid items-start gap-3 rounded-xl border border-border bg-surface p-3 sm:grid-cols-2"
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
        <p className="text-xs text-text-secondary">
          Leave unknown requirements blank. Enter 0 when no hours are required.
          Tickets count toward the selected season’s completed hours.
        </p>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </fieldset>
    </form>
  );
}
