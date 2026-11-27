import { useSyncExternalStore } from "react";
import { ageGroups } from "@/features/swimming/domain/times";

interface RecordsSelection {
  course: "SCY" | "LCM";
  ageGroup: string;
  mobileGender: "F" | "M";
  showAll: boolean;
}

const storageKey = "velocity:times:records-selection:v1";
const changedEvent = "velocity-records-selection";
const defaultSelection: RecordsSelection = {
  course: "SCY",
  ageGroup: "13-14",
  mobileGender: "F",
  showAll: false,
};
let cachedSelection = defaultSelection;
let cachedStoredValue: string | null | undefined;

function readSelection() {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored !== cachedStoredValue) {
      cachedStoredValue = stored;
      cachedSelection = defaultSelection;
      if (stored) {
        const value: unknown = JSON.parse(stored);
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const selection = value as Record<string, unknown>;
          cachedSelection = {
            course: selection.course === "LCM" ? "LCM" : "SCY",
            ageGroup: ageGroups.some(([key]) => key === selection.ageGroup)
              ? String(selection.ageGroup)
              : defaultSelection.ageGroup,
            mobileGender: selection.mobileGender === "M" ? "M" : "F",
            showAll: selection.showAll === true,
          };
        }
      }
    }
  } catch {
    // Keep the current selection usable when browser storage is unavailable.
  }
  return cachedSelection;
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(changedEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(changedEvent, onChange);
  };
}

function serverSelection() {
  return defaultSelection;
}

function updateSelection(update: Partial<RecordsSelection>) {
  cachedSelection = { ...readSelection(), ...update };
  try {
    const stored = JSON.stringify(cachedSelection);
    window.localStorage.setItem(storageKey, stored);
    cachedStoredValue = stored;
  } catch {
    // The in-memory selection still persists across page navigation.
  }
  window.dispatchEvent(new Event(changedEvent));
}

export function useRecordsSelection() {
  return [
    useSyncExternalStore(subscribe, readSelection, serverSelection),
    updateSelection,
  ] as const;
}
