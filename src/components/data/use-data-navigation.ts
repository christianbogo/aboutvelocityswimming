"use client";

import { useEffect } from "react";
import { useUpdateBlocker } from "@/hooks/useUpdateBlocker";

export interface DataNavigationState {
  dirty: boolean;
  busy: boolean;
}

export const idleDataNavigation: DataNavigationState = {
  dirty: false,
  busy: false,
};

export function confirmDataNavigation({ dirty, busy }: DataNavigationState) {
  return !busy && (!dirty || window.confirm("Discard your unsaved changes?"));
}

/** Protect the active editor without replacing Next's navigation or history. */
export function useDataNavigation(
  { dirty, busy }: DataNavigationState,
  onChange?: (state: DataNavigationState) => void,
) {
  useUpdateBlocker(dirty || busy);
  useEffect(() => {
    onChange?.({ dirty, busy });
  }, [dirty, busy, onChange]);
  useEffect(() => () => onChange?.(idleDataNavigation), [onChange]);

  useEffect(() => {
    if (!dirty && !busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const followLink = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        !link ||
        link.hasAttribute("download") ||
        (link.target && link.target !== "_self")
      )
        return;
      const destination = new URL(link.href, window.location.href);
      // Full document navigation is covered by beforeunload; hashes keep drafts.
      if (
        destination.origin !== window.location.origin ||
        (destination.pathname === window.location.pathname &&
          destination.search === window.location.search)
      )
        return;
      if (!confirmDataNavigation({ dirty, busy })) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", followLink, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", followLink, true);
    };
  }, [dirty, busy]);

  return () => confirmDataNavigation({ dirty, busy });
}
