"use client";

import { useEffect, useState, type ReactNode } from "react";
import { auth, onAuthStateChanged, signOut, type User } from "@/lib/auth";
import { getToolsCapabilities } from "@/lib/tools-access";
import { useUpdateBlocker } from "@/hooks/useUpdateBlocker";
import { AuthContext } from "./context";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ user: User | null; loading: boolean }>({
    user: null,
    loading: true,
  });
  useUpdateBlocker(state.loading);

  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, (user, loading) => {
      if (active) setState({ user, loading });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        isAdmin: !state.loading && getToolsCapabilities(state.user).staff,
        logout: () => signOut(auth),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
