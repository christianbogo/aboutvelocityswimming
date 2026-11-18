import type { SetStateAction } from "react";

export interface VersionedState<T> {
  draft: T;
  busy: boolean;
  dirty: boolean;
  error: string;
  saved: boolean;
}
export function createVersionedAutosave<T extends { updatedAt: string | null }>(
  initial: T,
  persist: (value: T) => Promise<T>,
  validate: (value: T) => string,
  onSaved: (value: T) => void,
  delay = 600,
) {
  let draft = structuredClone(initial);
  let revision = 0;
  let acknowledged = 0;
  let busy = false;
  let succeeded = false;
  let active = true;
  let error = "";
  let running: Promise<boolean> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let savedCallback = onSaved;
  let validator = validate;
  let state: VersionedState<T>;
  const listeners = new Set<() => void>();
  function publish() {
    const dirty = revision !== acknowledged;
    state = { draft, busy, dirty, error, saved: succeeded && !dirty && !busy };
    if (active) listeners.forEach((listener) => listener());
  }
  publish();
  function clearTimer() {
    clearTimeout(timer);
    timer = undefined;
  }
  async function run() {
    busy = true;
    error = "";
    publish();
    try {
      while (acknowledged !== revision) {
        const sendingRevision = revision;
        const message = validator(draft);
        if (message) throw new Error(message);
        const result = await persist(structuredClone(draft));
        draft =
          sendingRevision === revision
            ? result
            : { ...draft, updatedAt: result.updatedAt };
        acknowledged = sendingRevision;
        succeeded = true;
        if (active) savedCallback(result);
        publish();
      }
      return true;
    } catch (cause) {
      error =
        cause instanceof Error ? cause.message : "Unable to save changes.";
      return false;
    } finally {
      busy = false;
      publish();
    }
  }
  function flush(): Promise<boolean> {
    clearTimer();
    if (running) return running;
    if (acknowledged === revision) return Promise.resolve(true);
    running = run().finally(() => {
      running = undefined;
    });
    return running;
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setDraft(next: SetStateAction<T>) {
      draft =
        typeof next === "function" ? (next as (value: T) => T)(draft) : next;
      revision++;
      error = "";
      clearTimer();
      publish();
      if (!busy) timer = setTimeout(() => void flush(), delay);
    },
    flush,
    discard() {
      if (busy) return;
      clearTimer();
      acknowledged = revision;
      error = "";
      publish();
    },
    reset(value: T) {
      if (busy) return;
      clearTimer();
      draft = structuredClone(value);
      revision = acknowledged = 0;
      succeeded = false;
      error = "";
      publish();
    },
    setHandlers(
      nextValidate: (value: T) => string,
      callback: (value: T) => void,
    ) {
      validator = nextValidate;
      savedCallback = callback;
    },
    activate() {
      active = true;
    },
    deactivate() {
      active = false;
      void flush();
    },
  };
}
