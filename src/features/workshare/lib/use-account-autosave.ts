"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createAccountAutosave } from "./account-autosave";
import { saveWorkshareAccount, type WorkshareAccount } from "./accounts";

export function useAccountAutosave(
  initialAccount: WorkshareAccount,
  onSaved: (account: WorkshareAccount) => void,
) {
  const [autosave] = useState(() => createAccountAutosave(
    initialAccount,
    saveWorkshareAccount,
    onSaved,
  ));
  useEffect(() => { autosave.setOnSaved(onSaved); }, [autosave, onSaved]);
  const state = useSyncExternalStore(autosave.subscribe, autosave.getSnapshot, autosave.getSnapshot);
  useEffect(() => {
    autosave.activate();
    return () => autosave.deactivate();
  }, [autosave]);
  return {
    ...state,
    setDraft: autosave.setDraft,
    setEmails: autosave.setEmails,
    flush: autosave.flush,
    reset: autosave.reset,
  };
}
