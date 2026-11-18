"use client";

import { Check, LoaderCircle, Search, Star, UserRound, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useUpdateBlocker } from "@/hooks/useUpdateBlocker";
import {
  loadAccountAthletes,
  maxFavoriteAthletes,
  saveAccountAthletes,
  searchAccountAthletes,
  type AccountAthlete,
  type AccountAthletePreferences,
} from "@/lib/account-athletes";
import { Button } from "./Button";
import { Input } from "./Input";

type SelectionKind = "primary" | "favorite";

function AthleteSearch({
  kind,
  excludedIds,
  onSelect,
}: {
  kind: SelectionKind;
  excludedIds: string[];
  onSelect: (athlete: AccountAthlete) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    query: string;
    attempt: number;
    athletes: AccountAthlete[];
    failed?: boolean;
  }>();
  const term = query.trim();
  const canSearch = term.length >= 2;
  const current =
    result?.query === term && result.attempt === attempt ? result : undefined;
  const matches = current?.athletes.filter(
    (athlete) => !excludedIds.includes(athlete.id),
  );

  useEffect(() => {
    if (term.length < 2) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      void searchAccountAthletes(term, controller.signal)
        .then((athletes) => {
          if (!controller.signal.aborted)
            setResult({ query: term, attempt, athletes });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setResult({ query: term, attempt, athletes: [], failed: true });
        });
    }, 250);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [term, attempt]);

  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {kind === "primary"
          ? "Search for a primary athlete"
          : "Search for favorite athletes"}
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-3.5 left-3.5 size-4 text-text-secondary"
          aria-hidden="true"
        />
        <Input
          ref={input}
          id={id}
          type="search"
          autoComplete="off"
          maxLength={100}
          className="pl-10"
          placeholder="Search athletes by name"
          value={query}
          aria-describedby={`${id}-hint`}
          aria-controls={canSearch ? `${id}-results` : undefined}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Searching must not submit a partially edited preferences form.
            if (event.key === "Enter") event.preventDefault();
            if (event.key === "Escape") setQuery("");
          }}
        />
      </div>
      <p id={`${id}-hint`} className="mt-2 text-xs text-text-secondary">
        Search with at least 2 characters.
      </p>
      {canSearch && (
        <div
          id={`${id}-results`}
          className="mt-3 overflow-hidden rounded-xl border border-border"
        >
          {!current ? (
            <p
              role="status"
              className="flex items-center gap-2 p-4 text-sm text-text-secondary"
            >
              <LoaderCircle
                className="size-4 animate-spin"
                aria-hidden="true"
              />{" "}
              Searching athletes…
            </p>
          ) : current.failed ? (
            <div className="space-y-3 p-4">
              <p role="alert" className="text-sm text-text-secondary">
                Athlete search is unavailable. Please try again.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAttempt(attempt + 1)}
              >
                Retry search
              </Button>
            </div>
          ) : matches?.length ? (
            <>
              <p role="status" className="sr-only">
                {matches.length} athletes found.
              </p>
              <ul
                aria-label={
                  kind === "primary"
                    ? "Primary athlete search results"
                    : "Favorite athlete search results"
                }
                className="max-h-64 divide-y divide-border overflow-y-auto"
              >
                {matches.map((athlete) => (
                  <li key={athlete.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 p-3 text-left transition-colors hover:bg-hover-bg focus-visible:bg-hover-bg focus-visible:outline-offset-[-3px]"
                      aria-label={
                        kind === "primary"
                          ? `Select ${athlete.name} as primary athlete`
                          : `Add ${athlete.name} to favorite athletes`
                      }
                      onClick={() => {
                        onSelect(athlete);
                        setQuery("");
                        input.current?.focus();
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block break-words text-sm font-medium">
                          {athlete.name}
                        </span>
                        <span className="mt-0.5 block text-xs text-text-secondary">
                          {athlete.teamName || "Team unavailable"}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-accent">
                        {kind === "primary" ? "Select" : "Add"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {current.athletes.length >= 20 && (
                <p className="border-t border-border px-3 py-2 text-xs text-text-secondary">
                  Keep typing to narrow your results.
                </p>
              )}
            </>
          ) : (
            <p role="status" className="p-4 text-sm text-text-secondary">
              {current.athletes.length
                ? "These athletes are already selected. Try another name."
                : "No athletes found. Try another name."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SelectedAthlete({
  athlete,
  kind,
  onRemove,
}: {
  athlete: AccountAthlete;
  kind: SelectionKind;
  onRemove: () => void;
}) {
  const Icon = kind === "primary" ? UserRound : Star;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-hover-bg p-3">
      <Icon className="size-4 shrink-0 text-accent" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium">{athlete.name}</p>
        <p className="mt-0.5 text-xs text-text-secondary">
          {athlete.teamName || "Team unavailable"}
        </p>
      </div>
      <button
        type="button"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface hover:text-text-primary"
        aria-label={
          kind === "primary"
            ? `Remove ${athlete.name} as primary athlete`
            : `Remove ${athlete.name} from favorite athletes`
        }
        onClick={onRemove}
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

type AutosaveStatus = "idle" | "saving" | "saved" | "error";
type AutosaveState = {
  draft: AccountAthletePreferences;
  status: AutosaveStatus;
};

export function createAthleteAutosave(
  initial: AccountAthletePreferences,
  persist: (
    selection: AccountAthletePreferences,
  ) => Promise<AccountAthletePreferences>,
  onState: (state: AutosaveState) => void,
) {
  let draft = initial;
  let revision = 0;
  let savedRevision = 0;
  let running = false;
  const publish = (status: AutosaveStatus) => onState({ draft, status });

  async function flush() {
    if (running) return;
    running = true;
    publish("saving");
    try {
      while (savedRevision !== revision) {
        const selection = draft;
        const sendingRevision = revision;
        try {
          const result = await persist(selection);
          savedRevision = sendingRevision;
          // A response for an earlier edit must not replace a newer selection.
          if (revision === sendingRevision) draft = result;
        } catch {
          // If another edit arrived, save that latest selection before stopping.
          if (revision !== sendingRevision) continue;
          publish("error");
          return;
        }
      }
      publish("saved");
    } finally {
      running = false;
    }
  }

  return {
    change(next: AccountAthletePreferences) {
      draft = next;
      revision += 1;
      publish("saving");
      void flush();
    },
    retry() {
      if (savedRevision !== revision) void flush();
    },
  };
}

function AthleteEditor({
  userId,
  initial,
}: {
  userId: string;
  initial: AccountAthletePreferences;
}) {
  const [state, setState] = useState<AutosaveState>({
    draft: initial,
    status: "idle",
  });
  const [autosave] = useState(() =>
    createAthleteAutosave(
      initial,
      (selection) => saveAccountAthletes(userId, selection),
      setState,
    ),
  );
  const { draft, status } = state;
  const change = autosave.change;
  useUpdateBlocker(status === "saving" || status === "error");

  return (
    <div role="group" aria-label="Choose athletes to follow">
      <fieldset className="min-w-0">
        <legend className="sr-only">Athlete preferences</legend>
        <div className="space-y-7">
          <div>
            <h3 className="text-sm font-semibold">Primary Athlete</h3>
            <p className="mt-1 mb-3 text-sm text-text-secondary">
              Choose the athlete you follow most closely.
            </p>
            {draft.primaryAthlete && (
              <div className="mb-3">
                <SelectedAthlete
                  athlete={draft.primaryAthlete}
                  kind="primary"
                  onRemove={() => change({ ...draft, primaryAthlete: null })}
                />
              </div>
            )}
            <AthleteSearch
              kind="primary"
              excludedIds={
                draft.primaryAthlete ? [draft.primaryAthlete.id] : []
              }
              onSelect={(athlete) =>
                change({
                  primaryAthlete: athlete,
                  favoriteAthletes: draft.favoriteAthletes.filter(
                    (favorite) => favorite.id !== athlete.id,
                  ),
                })
              }
            />
          </div>
          <div className="border-t border-border pt-6">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Favorite Athletes</h3>
              {draft.favoriteAthletes.length > 0 && (
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
                  {draft.favoriteAthletes.length}
                </span>
              )}
            </div>
            <p className="mt-1 mb-3 text-sm text-text-secondary">
              Add more athletes you want to keep up with.
            </p>
            {draft.favoriteAthletes.length > 0 && (
              <ul
                aria-label="Selected favorite athletes"
                className="mb-3 space-y-2"
              >
                {draft.favoriteAthletes.map((athlete) => (
                  <li key={athlete.id}>
                    <SelectedAthlete
                      athlete={athlete}
                      kind="favorite"
                      onRemove={() =>
                        change({
                          ...draft,
                          favoriteAthletes: draft.favoriteAthletes.filter(
                            (favorite) => favorite.id !== athlete.id,
                          ),
                        })
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
            {draft.favoriteAthletes.length < maxFavoriteAthletes ? (
              <AthleteSearch
                kind="favorite"
                excludedIds={[
                  ...(draft.primaryAthlete ? [draft.primaryAthlete.id] : []),
                  ...draft.favoriteAthletes.map((athlete) => athlete.id),
                ]}
                onSelect={(athlete) =>
                  change({
                    ...draft,
                    favoriteAthletes: [...draft.favoriteAthletes, athlete],
                  })
                }
              />
            ) : (
              <p className="text-sm text-text-secondary">
                You have selected {maxFavoriteAthletes} favorites. Remove one to
                add another athlete.
              </p>
            )}
          </div>
        </div>
      </fieldset>
      {status === "saving" && (
        <p
          role="status"
          className="mt-4 flex items-center gap-1.5 text-sm text-text-secondary"
        >
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          Saving athletes…
        </p>
      )}
      {status === "saved" && (
        <p
          role="status"
          className="mt-4 flex items-center gap-1.5 text-sm text-accent"
        >
          <Check className="size-4" aria-hidden="true" />
          Athletes saved
        </p>
      )}
      {status === "error" && (
        <div className="mt-4 space-y-3">
          <p role="alert" className="text-sm text-text-secondary">
            We couldn’t save your athletes. Your selections are still here.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={autosave.retry}
          >
            Retry saving athletes
          </Button>
        </div>
      )}
    </div>
  );
}

export default function AccountAthletes({ userId }: { userId: string }) {
  const [preferences, setPreferences] = useState<AccountAthletePreferences>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void loadAccountAthletes(userId)
      .then((result) => {
        if (active) setPreferences(result);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [userId, attempt]);

  return (
    <section
      aria-labelledby="athlete-following-heading"
      className="rounded-2xl border border-border bg-surface p-5 sm:p-6"
    >
      <h2 id="athlete-following-heading" className="mb-6 text-xl font-semibold">
        Athlete following
      </h2>
      {preferences ? (
        <AthleteEditor key={userId} userId={userId} initial={preferences} />
      ) : failed ? (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-text-secondary">
            Your athlete choices couldn’t be loaded. Please try again.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setFailed(false);
              setAttempt(attempt + 1);
            }}
          >
            Try again
          </Button>
        </div>
      ) : (
        <p role="status" className="text-sm text-text-secondary">
          Loading your athletes…
        </p>
      )}
    </section>
  );
}
