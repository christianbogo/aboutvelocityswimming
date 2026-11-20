import MyTimesPage from "@/components/collection/MyTimesPage";
import { toolDirectory } from "@/lib/tool-directory";

export const metadata = {
  title: "Times | Velocity Swimming",
  description: toolDirectory["my-times"].description,
};

export default function Page() {
  return <MyTimesPage />;
}
