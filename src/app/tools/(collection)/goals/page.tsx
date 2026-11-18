import { Suspense } from "react";
import Goals, { GoalsLoading } from "@/components/collection/Goals";
import { toolDirectory } from "@/lib/tool-directory";

export const metadata = {
  title: "Goals | Velocity Swimming",
  description: toolDirectory.goals.description,
};

export default function GoalsPage() {
  return (
    <Suspense fallback={<GoalsLoading />}>
      <Goals />
    </Suspense>
  );
}
