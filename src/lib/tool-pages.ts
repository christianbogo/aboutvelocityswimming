import {
  type LucideIcon,
} from "lucide-react";
import {
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
export function getToolPages(tool: ToolId): ToolPage[] {
  switch (tool) {
    case "my-times":
    case "goals":
    case "team-map":
    case "rankings":
    case "records":
    case "standards":
    case "admin":
      return [];
    case "data":
      return [];
  }
}
