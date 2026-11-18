import type { SetStateAction } from "react";
import { WorkshareAccountSaveError } from "./accounts";
import type { RosterAthlete, WorkshareAccount } from "./accounts";
import { parseAccount } from "./accounts-validation";

export interface AccountAutosaveState {
  draft: WorkshareAccount;
  emails: string;
  busy: boolean;
  dirty: boolean;
  error: string;
  saved: boolean;
  reloadRequired: boolean;
}

type Persist = (account: WorkshareAccount) => Promise<WorkshareAccount>;
const uncertainCreateMessage = "Could not confirm this new account was saved. Reload accounts before making more changes.";

function athleteSignature(athlete: RosterAthlete) {
  return JSON.stringify([
    athlete.fullName.trim(),
    athlete.trainingGroup.trim(),
    athlete.timesAthleteId?.trim() ?? null,
    athlete.isArchived,
  ]);
}

/** Serializes complete-account writes and carries each returned version forward. */
export function createAccountAutosave(
  initial: WorkshareAccount,
  persist: Persist,
  onSaved: (account: WorkshareAccount) => void,
  delay = 600,
) {
  let draft = structuredClone(initial);
  let emails = draft.emails.join("\n");
  let revision = 0;
  let savedRevision = 0;
  let succeeded = false;
  let busy = false;
  let error = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<boolean> | undefined;
  let active = true;
  let uncertainCreate = false;
  let savedCallback = onSaved;
  let nextAthleteKey = 0;
  const athleteKeys = new WeakMap<RosterAthlete, number>();
  const listeners = new Set<() => void>();
  let state: AccountAutosaveState;

  function key(athlete: RosterAthlete) {
    let value = athleteKeys.get(athlete);
    if (value === undefined) {
      value = nextAthleteKey++;
      athleteKeys.set(athlete, value);
    }
    return value;
  }
  draft.athletes.forEach(key);

  function publish() {
    const dirty = revision !== savedRevision;
    state = { draft, emails, busy, dirty, error, saved: succeeded && !dirty && !busy, reloadRequired: uncertainCreate };
    if (active) listeners.forEach((listener) => listener());
  }
  publish();

  function clearTimer() {
    clearTimeout(timer);
    timer = undefined;
  }

  function changed() {
    revision++;
    error = uncertainCreate ? uncertainCreateMessage : "";
    clearTimer();
    publish();
    if (!busy && !uncertainCreate) timer = setTimeout(() => void flush(), delay);
  }

  function rememberAthletes(next: WorkshareAccount) {
    const previous = draft.athletes;
    const retained = new Set<number>();
    next.athletes.forEach((athlete) => {
      const existing = athlete.id
        ? previous.find((candidate) => candidate.id === athlete.id)
        : previous.find((candidate) => candidate === athlete);
      if (existing) {
        const value = key(existing);
        athleteKeys.set(athlete, value);
        retained.add(value);
      }
    });
    next.athletes.forEach((athlete, index) => {
      if (athleteKeys.has(athlete)) return;
      const previousAtIndex = previous[index];
      // Editing an athlete creates a new object at the same index. Add/remove
      // operations retain the other objects, so they cannot inherit this key.
      if (next.athletes.length === previous.length && previousAtIndex
        && !retained.has(key(previousAtIndex))) {
        athleteKeys.set(athlete, key(previousAtIndex));
      } else {
        key(athlete);
      }
    });
  }

  function acknowledge(
    submitted: WorkshareAccount,
    submittedKeys: number[],
    result: WorkshareAccount,
  ) {
    // A create is only confirmed once the response includes its persistent ID
    // and version. An incomplete success response must never trigger a POST retry.
    parseAccount(result, "update");
    const knownIds = new Set(submitted.athletes.flatMap((athlete) => athlete.id ? [athlete.id] : []));
    const created = result.athletes.filter((athlete) => !knownIds.has(athlete.id!));
    const assignedIds = new Map<number, string>();
    submitted.athletes.forEach((athlete, index) => {
      if (athlete.id) return;
      const match = created.findIndex((candidate) => athleteSignature(candidate) === athleteSignature(athlete));
      if (match < 0 || !created[match].id)
        throw new Error("Could not confirm an athlete save. Reload this account before making more changes.");
      assignedIds.set(submittedKeys[index], created[match].id!);
      created.splice(match, 1);
    });
    draft = {
      ...draft,
      id: result.id,
      updatedAt: result.updatedAt,
      athletes: draft.athletes.map((athlete) => {
        const athleteKey = key(athlete);
        const id = assignedIds.get(athleteKey);
        if (!id || athlete.id) return athlete;
        const updated = { ...athlete, id };
        athleteKeys.set(updated, athleteKey);
        return updated;
      }),
    };
  }

  async function run() {
    busy = true;
    error = "";
    publish();
    let submitted: WorkshareAccount | undefined;
    let attempted = false;
    try {
      while (savedRevision !== revision) {
        const sendingRevision = revision;
        const sendingKeys = draft.athletes.map(key);
        attempted = false;
        submitted = parseAccount({
          ...draft,
          emails: emails.split(/[\n,;]+/).map((email) => email.trim()).filter(Boolean),
        }, draft.id ? "update" : "create");
        attempted = true;
        const result = await persist(submitted);
        acknowledge(submitted, sendingKeys, result);
        savedRevision = sendingRevision;
        succeeded = true;
        if (active) savedCallback(result);
        publish();
      }
      return savedRevision === revision;
    } catch (cause) {
      if (attempted && submitted && !submitted.id && !draft.id
        && !(cause instanceof WorkshareAccountSaveError && !cause.mayHaveSaved)) {
        uncertainCreate = true;
      }
      error = uncertainCreate ? uncertainCreateMessage
        : cause instanceof Error ? cause.message : "Unable to save changes.";
      clearTimer();
      return false;
    } finally {
      busy = false;
      publish();
    }
  }

  function flush(): Promise<boolean> {
    clearTimer();
    if (running) return running;
    if (uncertainCreate) return Promise.resolve(false);
    if (savedRevision === revision) return Promise.resolve(true);
    running = run().finally(() => { running = undefined; });
    return running;
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setDraft(next: SetStateAction<WorkshareAccount>) {
      const updated = typeof next === "function" ? next(draft) : next;
      rememberAthletes(updated);
      draft = updated;
      changed();
    },
    setEmails(next: SetStateAction<string>) {
      emails = typeof next === "function" ? next(emails) : next;
      changed();
    },
    flush,
    reset(account: WorkshareAccount) {
      if (busy) return;
      clearTimer();
      draft = structuredClone(account);
      draft.athletes.forEach(key);
      emails = draft.emails.join("\n");
      revision = savedRevision = 0;
      succeeded = false;
      uncertainCreate = false;
      error = "";
      publish();
    },
    cancelTimer: clearTimer,
    setOnSaved(callback: (account: WorkshareAccount) => void) {
      savedCallback = callback;
    },
    activate() { active = true; },
    deactivate() {
      active = false;
      clearTimer();
      // Sidebar navigation unmounts the editor without a page unload. Drain
      // valid pending edits, while leaving the departing React tree untouched.
      void flush();
    },
  };
}
