import StandardsPage from "@/components/collection/StandardsPage";
import { toolDirectory } from "@/lib/tool-directory";

export const metadata = {
  title: "Standards | Velocity Swimming",
  description: toolDirectory.standards.description,
};

export default function Page() {
  return <StandardsPage />;
}
