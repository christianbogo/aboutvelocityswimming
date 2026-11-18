import {
  Archive,
  ClipboardList,
  Table2,
  type LucideIcon,
} from "lucide-react";
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
