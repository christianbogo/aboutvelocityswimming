import {
  Briefcase,
  ClipboardList,
  Home,
  Settings,
  Table2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { timesViewHref } from "@/components/collection/times-url-state";
import { worksharePath } from "@/features/workshare/lib/routes";
import {
  timesViews,
  toolDirectory,
  type TimesView,
  type ToolId,
} from "./tool-directory";

export type ToolPage = {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  includeChildren?: boolean;
  activePaths?: readonly string[];
};

const timesDescriptions: Record<TimesView, string> = {
  "my-times":
    "Follow your primary and favorite athletes’ best times, motivational ranks, and current-season team rankings.",
  rankings:
    "Compare swimmers by event, age, and course, and explore performance rankings.",
  records: "Browse team records and the swimmers behind the fastest times.",
  standards:
    "Look up qualifying times and see how swims compare with time standards.",
  meets:
    "Find a meet and explore its events, race results, and participating swimmers.",
  athletes:
    "Find a swimmer to explore their results, personal bests, and progress.",
};

// Keep landing-page summaries and sidebar destinations in sync.
export function getToolPages(
  tool: ToolId,
  workshareAdmin: boolean,
): ToolPage[] {
  switch (tool) {
    case "times":
      return timesViews.map(([id, label, icon]) => ({
        id,
        label,
        icon,
        description: timesDescriptions[id],
        href: timesViewHref(id),
      }));
    case "workshare":
      return [
        {
          id: "dashboard",
          label: "Dashboard",
          icon: Home,
          href: worksharePath(),
          description: workshareAdmin
            ? "Open your administrator dashboard for family accounts, postings, and shift rosters."
            : "See your family’s hours, progress toward requirements, and upcoming shifts.",
        },
        ...(!workshareAdmin
          ? [
              {
                id: "logs",
                label: "Volunteer Logs",
                icon: ClipboardList,
                href: worksharePath("logs"),
                description:
                  "Review completed volunteer shifts and your family’s recorded workshare hours.",
              },
            ]
          : []),
        {
          id: "jobs",
          label: "Job Board",
          icon: Briefcase,
          href: worksharePath("jobs"),
          description: workshareAdmin
            ? "Post volunteer opportunities and manage available shifts."
            : "Find volunteer opportunities and sign up for available shifts.",
        },
        ...(workshareAdmin
          ? [
              {
                id: "families",
                label: "Families",
                icon: Users,
                href: worksharePath("admin/families"),
                includeChildren: true,
                description:
                  "Manage family accounts, workshare requirements, and volunteer progress.",
              },
              {
                id: "roster",
                label: "Roster",
                icon: ClipboardList,
                href: worksharePath("admin/roster"),
                description:
                  "Review shift sign-ups and verify volunteer participation.",
              },
              {
                id: "settings",
                label: "Settings",
                icon: Settings,
                href: worksharePath("admin/settings"),
                description:
                  "Configure the season and workshare program settings.",
              },
            ]
          : []),
      ];
    case "imports": {
      const href = toolDirectory.imports.href;
      return [
        {
          id: "import",
          label: "Import",
          icon: ClipboardList,
          href,
          activePaths: [`${href}/batches`],
          description:
            "Resolve import issues and review meets and results before publishing them.",
        },
        {
          id: "viewer",
          label: "Viewer",
          icon: Table2,
          href: `${href}/swims`,
          activePaths: [`${href}/meet-inventory`],
          description:
            "Browse approved swims, relays, and meets, and check for missing data.",
        },
      ];
    }
  }
}
