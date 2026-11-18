import TimesDatabase from "@/components/collection/TimesDatabase";
import { toolDirectory } from "@/lib/tool-directory";

export const metadata = {
  title: "Records | Velocity Swimming",
  description: toolDirectory.records.description,
};

export default function Page() {
  return <TimesDatabase view="records" />;
}
