import RecordsPage from "@/components/collection/RecordsPage";
import { toolDirectory } from "@/lib/tool-directory";

export const metadata = {
  title: "Records | Velocity Swimming",
  description: toolDirectory.records.description,
};

export default function Page() {
  return <RecordsPage />;
}
