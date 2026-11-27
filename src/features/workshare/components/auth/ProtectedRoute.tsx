"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/features/auth/context";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isAdmin, loading } = useAuth();
  const router = useRouter();
  const destination = loading ? null : !user ? "/login" : !isAdmin ? "/tools" : null;

  useEffect(() => {
    if (destination) router.replace(destination);
  }, [destination, router]);

  if (loading || destination) {
    return <p role="status" className="p-8">Opening your account…</p>;
  }

  return <>{children}</>;
}

