import {
  Archive,
  Briefcase,
  ClipboardList,
  Home,
  Settings,
  Table2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { worksharePath } from "@/features/workshare/lib/routes";
import {
  toolDirectory,
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

// Keep landing-page summaries and sidebar destinations in sync.
export function getToolPages(
  tool: ToolId,
  workshareAdmin: boolean,
): ToolPage[] {
  switch (tool) {
    case "my-times":
    case "rankings":
    case "records":
    case "standards":
      return [];
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
          id: "held-observations",
          label: "Held Observations",
          icon: Archive,
          href: `${href}/held-observations`,
          description: "Review historical source results and send verified times for approval.",
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
