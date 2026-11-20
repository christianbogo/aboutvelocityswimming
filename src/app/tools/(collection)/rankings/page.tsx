import RankingsPage from "@/components/collection/RankingsPage";
import { toolDirectory } from "@/lib/tool-directory";

export const metadata = {
  title: "Rankings | Velocity Swimming",
  description: toolDirectory.rankings.description,
};

export default function Page() {
  return <RankingsPage />;
}
