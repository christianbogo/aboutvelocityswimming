"use client";
import { CircleUserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/features/workshare/contexts/auth";
import {
  canAccessToolsPath,
  getToolsHome,
  isToolsPage,
} from "@/lib/tools-access";
import styles from "./SiteAccount.module.css";

export default function SiteAccount() {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  if (
    loading ||
    pathname === "/login" ||
    (isToolsPage(pathname) && canAccessToolsPath(pathname, user))
  )
    return null;
  const className = `${styles.pill} ${styles.account}`;
  return user ? (
    <Link
      href={getToolsHome(user)}
      className={className}
      aria-label={`Account: ${user.email ?? "Signed in"}`}
      title={user.email ?? "Signed in"}
    >
      <CircleUserRound className={styles.icon} aria-hidden="true" />
      <span className={styles.email} aria-hidden="true">
        <span className={styles.emailText}>{user.email ?? "Signed in"}</span>
      </span>
    </Link>
  ) : (
    <Link className={className} href="/login">
      <CircleUserRound className={styles.icon} aria-hidden="true" />
      Sign in
    </Link>
  );
}
