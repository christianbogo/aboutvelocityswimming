"use client";

import { createContext, useContext, useEffect } from "react";

export const ToolSidebarFocus = createContext<(focused: boolean) => void>(
  () => {},
);

/** Temporarily collapse navigation without changing the saved sidebar preference. */
export function useSidebarFocus(focused: boolean) {
  const setFocused = useContext(ToolSidebarFocus);
  useEffect(() => {
    setFocused(focused);
    return () => setFocused(false);
  }, [focused, setFocused]);
}
