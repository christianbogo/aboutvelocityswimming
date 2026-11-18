"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useUpdateBlocker } from "@/hooks/useUpdateBlocker";
import { createVersionedAutosave } from "./versioned-autosave";

export function useVersionedAutosave<T extends { updatedAt: string | null }>(
  initial: T,
  persist: (value: T) => Promise<T>,
  validate: (value: T) => string,
  onSaved: (value: T) => void,
) {
  const [autosave] = useState(() =>
    createVersionedAutosave(initial, persist, validate, onSaved),
  );
  useEffect(() => {
    autosave.setHandlers(validate, onSaved);
  }, [autosave, validate, onSaved]);
  const state = useSyncExternalStore(
    autosave.subscribe,
    autosave.getSnapshot,
    autosave.getSnapshot,
  );
  useUpdateBlocker(state.dirty || state.busy);
  useEffect(() => {
    autosave.activate();
    return () => autosave.deactivate();
  }, [autosave]);
  useEffect(() => {
    if (!state.dirty && !state.busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [state.dirty, state.busy]);
  return {
    ...state,
    setDraft: autosave.setDraft,
    flush: autosave.flush,
    discard: autosave.discard,
    reset: autosave.reset,
    getLatest: () => autosave.getSnapshot().draft,
  };
}
