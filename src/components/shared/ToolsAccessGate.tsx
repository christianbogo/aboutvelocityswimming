"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/features/auth/context";
import { canAccessToolsPath, isToolsPage } from "@/lib/tools-access";

export default function ToolsAccessGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  if (!isToolsPage(pathname)) return children;
  // Also hide already-loaded routes immediately after sign-out or account changes.
  if (loading)
    return (
      <main className="p-12 text-center" role="status">
        Checking your account…
      </main>
    );
  if (!canAccessToolsPath(pathname, user)) {
    return (
      <main className="p-12 text-center space-y-4">
        <h1 className="text-2xl font-semibold">Access restricted</h1>
        <p>
          Sign in with any email to access Account, Times, Rankings, Records, and Standards.
        </p>
        <Link href="/login" className="underline">
          Sign in or switch accounts
        </Link>
      </main>
    );
  }
  return children;
}
