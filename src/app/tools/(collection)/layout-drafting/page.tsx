import LayoutDrafting from "@/components/layout-drafting/LayoutDrafting";
import { toolDirectory } from "@/lib/tool-directory";

export const metadata = {
  title: "Layout Drafting | Velocity Swimming",
  description: toolDirectory["layout-drafting"].description,
};

export default function Page() {
  return <LayoutDrafting />;
}
