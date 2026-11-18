import TimesDatabase from "@/components/collection/TimesDatabase";
import { toolDirectory } from "@/lib/tool-directory";

export const metadata = {
  title: "Standards | Velocity Swimming",
  description: toolDirectory.standards.description,
};

export default function Page() {
  return <TimesDatabase view="standards" />;
}
