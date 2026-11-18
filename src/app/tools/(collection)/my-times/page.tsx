import TimesDatabase from "@/components/collection/TimesDatabase";
import { toolDirectory } from "@/lib/tool-directory";

export const metadata = {
  title: "Times | Velocity Swimming",
  description: toolDirectory["my-times"].description,
};

export default function Page() {
  return <TimesDatabase view="my-times" />;
}
