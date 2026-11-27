"use client";

import { createContext, useContext } from "react";
import type { User } from "@/lib/auth";

export interface AuthContextValue {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAdmin: false,
  loading: true,
  logout: async () => {},
});

export const useAuth = () => useContext(AuthContext);
