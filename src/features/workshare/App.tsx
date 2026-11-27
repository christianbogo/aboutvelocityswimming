"use client";

import { lazy, Suspense } from "react";
import { MainLayout } from "./components/layout/MainLayout";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";

const Login = lazy(() => import("./components/auth/Login").then((module) => ({ default: module.Login })));
const AccountsAdmin = lazy(() => import("./components/admin/AccountsAdmin").then((module) => ({ default: module.AccountsAdmin })));

export type WorkshareView = "login" | "accounts";

export default function App({ view }: { view: WorkshareView }) {
  return (
    <Suspense fallback={<p role="status" className="p-8">Loading…</p>}>
      {view === "login" ? <Login /> : (
        <ProtectedRoute><MainLayout><AccountsAdmin /></MainLayout></ProtectedRoute>
      )}
    </Suspense>
  );
}
