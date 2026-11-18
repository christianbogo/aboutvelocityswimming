"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft, CircleUserRound, LogOut, Shield, type LucideIcon,
} from "lucide-react";
import { useId, type ReactNode } from "react";
import { useAuth } from "@/features/workshare/contexts/auth";
import { getAvailableTools, toolDirectory, type ToolId } from "@/lib/tool-directory";
import { getToolsCapabilities } from "@/lib/tools-access";
import { getToolPages } from "@/lib/tool-pages";
import ToolSidebar from "./ToolSidebar";
import styles from "./ToolSidebar.module.css";

type Subpage = {
  label: string;
  icon: LucideIcon;
  href: string;
  active: boolean;
};

function routeItem(pathname: string, href: string, label: string, icon: LucideIcon, includeChildren = false): Subpage {
  return { href, label, icon, active: pathname === href || (includeChildren && pathname.startsWith(href + "/")) };
}

function SidebarLink({ label, href, icon: Icon, active }: Subpage) {
  return (
    <Link href={href} className={styles.item} aria-label={label} title={label} aria-current={active ? "page" : undefined}>
      <Icon aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}

function ToolsNavigation({ pathname, currentTool }: { pathname: string; currentTool?: ToolId }) {
  const { user } = useAuth();
  const access = getToolsCapabilities(user);
  const sectionId = useId();
  const subpages = currentTool ? getToolPages(currentTool).map(page => {
    if (page.activePaths?.includes(pathname)) {
      return { ...page, active: true };
    }
    return routeItem(pathname, page.href, page.label, page.icon, page.includeChildren);
  }) : [];

  return (
    <>
      <SidebarLink {...routeItem(pathname, "/tools", "Account", CircleUserRound)} />
      <ul className={styles.groups}>
        {getAvailableTools(access).map(([id, { homeHref, title, icon: Icon }]) => {
          const hasSubpages = getToolPages(id).length > 0;
          const expanded = currentTool === id;
          const idForPages = `${sectionId}-${id}`;
          const childIsCurrent = expanded && subpages.some((page) => page.active && page.href === homeHref);
          return (
            <li key={id}>
              <Link
                href={homeHref}
                className={`${styles.item} ${styles.groupLink}`}
                data-current-tool={expanded}
                aria-label={title}
                title={title}
                aria-current={pathname === homeHref && !childIsCurrent ? "page" : undefined}
                aria-expanded={hasSubpages ? expanded : undefined}
                aria-controls={hasSubpages ? idForPages : undefined}
              >
                <Icon aria-hidden="true" />
                <span>{title}</span>
              </Link>
              {hasSubpages && <ul id={idForPages} className={styles.subpages} hidden={!expanded}>
                {expanded && subpages.map(page => (
                  <li key={page.label}><SidebarLink {...page} /></li>
                ))}
              </ul>}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function ToolsAccount({ collapseControl }: { collapseControl: ReactNode }) {
  const { logout } = useAuth();
  return (
    <>
      <Link href="/" className={`${styles.item} ${styles.footerAction}`} aria-label="Back to Home" title="Back to Home"><ArrowLeft aria-hidden="true" /><span>Back to Home</span></Link>
      {collapseControl}
      <button type="button" className={`${styles.item} ${styles.footerAction}`} aria-label="Sign Out" title="Sign Out" onClick={() => void logout()}>
        <LogOut aria-hidden="true" /><span>Sign Out</span>
      </button>
    </>
  );
}

export default function ToolsWorkspace({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, isAdmin } = useAuth();
  const access = getToolsCapabilities(user);
  const currentTool = getAvailableTools(access).find(([, { href }]) => pathname === href || pathname.startsWith(href + "/"))?.[0]
    ?? (access.allTools && pathname.startsWith("/tools/swim-resources/") ? "rankings" : undefined);
  const admin = currentTool === "admin";

  return (
    <ToolSidebar
      title={currentTool ? toolDirectory[currentTool].title : "Velocity Tools"}
      badge={admin && isAdmin && (
        <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#0A856C]/10 px-2.5 py-1 text-xs font-semibold text-accent">
          <Shield className="size-3.5 shrink-0" aria-hidden="true" />Administrator
        </span>
      )}
      navigation={<ToolsNavigation pathname={pathname} currentTool={currentTool} />}
      renderFooter={(collapseControl) => (
        <ToolsAccount collapseControl={collapseControl} />
      )}
    >
      {children}
    </ToolSidebar>
  );
}
