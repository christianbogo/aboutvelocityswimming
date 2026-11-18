import type { ToolsCapabilities } from "./tools-access";
import {
  BarChart3,
  ClipboardList,
  Shield,
  Target,
  Timer,
  Trophy,
  type LucideIcon,
} from "lucide-react";

type Tool = {
  title: string;
  description: string;
  href: string;
  homeHref: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

export const timesViewPaths = {
  "my-times": "/tools/my-times",
  rankings: "/tools/rankings",
  records: "/tools/records",
  standards: "/tools/standards",
} as const;

export const toolDirectory = {
  "my-times": {
    title: "Times",
    description:
      "Follow your primary and favorite athletes’ best times, motivational ranks, and all-time team rankings.",
    href: timesViewPaths["my-times"],
    homeHref: timesViewPaths["my-times"],
    icon: Timer,
  },
  goals: {
    title: "Goals",
    description:
      "Find the next standards, ranking milestones, and new events for your primary and favorite athletes.",
    href: "/tools/goals",
    homeHref: "/tools/goals",
    icon: Target,
  },
  rankings: {
    title: "Rankings",
    description:
      "Compare swimmers by event, age, and course, and explore performance rankings.",
    href: timesViewPaths.rankings,
    homeHref: timesViewPaths.rankings,
    icon: BarChart3,
  },
  records: {
    title: "Records",
    description:
      "Browse team records and the swimmers behind the fastest times.",
    href: timesViewPaths.records,
    homeHref: timesViewPaths.records,
    icon: Trophy,
  },
  standards: {
    title: "Standards",
    description:
      "Look up qualifying times and see how swims compare with time standards.",
    href: timesViewPaths.standards,
    homeHref: timesViewPaths.standards,
    icon: Timer,
  },
  admin: {
    title: "Admin",
    description:
      "Manage account contacts, athlete registration, and seasonal workshare requirements.",
    href: "/tools/admin",
    homeHref: "/tools/admin",
    icon: Shield,
    adminOnly: true,
  },
  imports: {
    title: "Velocity Imports",
    description:
      "Inspect swim and meet data, and review proposed changes before publication.",
    href: "/tools/review",
    homeHref: "/tools/review",
    icon: ClipboardList,
    adminOnly: true,
  },
} as const satisfies Record<string, Tool>;

export type ToolId = keyof typeof toolDirectory;

export function getAvailableTools(access: ToolsCapabilities) {
  const tools = Object.entries(toolDirectory) as [ToolId, Tool][];
  return tools.filter(([id, tool]) => access.allTools
    ? access.staff || !tool.adminOnly
    : access.staff && id === "admin");
}

export const timesViews = [
  ["my-times", "Times", Timer],
  ["rankings", "Rankings", BarChart3],
  ["records", "Records", Trophy],
  ["standards", "Standards", Timer],
] as const;

export type TimesView = (typeof timesViews)[number][0];

export function getTimesView(value: string | null): TimesView {
  return timesViews.find(([id]) => id === value)?.[0] ?? "rankings";
}
