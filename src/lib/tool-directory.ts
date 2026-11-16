import {
  BarChart3,
  Briefcase,
  CalendarDays,
  ClipboardList,
  Timer,
  Trophy,
  Users,
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

export const toolDirectory = {
  times: {
    title: "Velocity Times",
    description:
      "Explore approved results and time standards for Velocity Swimming athletes wherever they compete.",
    href: "/tools/times",
    homeHref: "/tools/times/overview",
    icon: Timer,
  },
  workshare: {
    title: "Velocity Workshare",
    description:
      "Find volunteer opportunities, sign up for shifts, and track your family’s workshare hours.",
    href: "/tools/workshare",
    homeHref: "/tools/workshare/overview",
    icon: Briefcase,
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

export function getAvailableTools(isAdmin: boolean) {
  const tools = Object.entries(toolDirectory) as [ToolId, Tool][];
  return tools.filter(([, tool]) => isAdmin || !tool.adminOnly);
}

export const timesViews = [
  ["rankings", "Event Rankings", BarChart3],
  ["records", "Team Records", Trophy],
  ["standards", "Time Standards", Timer],
  ["meets", "Meet Results", CalendarDays],
  ["athletes", "Athletes", Users],
] as const;

export type TimesView = (typeof timesViews)[number][0];

export function getTimesView(value: string | null): TimesView {
  return timesViews.find(([id]) => id === value)?.[0] ?? timesViews[0][0];
}
