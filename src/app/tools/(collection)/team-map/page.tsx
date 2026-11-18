import { Suspense } from "react";
import TeamMap, { TeamMapLoading } from "@/components/collection/TeamMap";
import { toolDirectory } from "@/lib/tool-directory";

export const metadata = {
  title: "Team Map | Velocity Swimming",
  description: toolDirectory["team-map"].description,
};

export default function TeamMapPage() {
  return (
    <Suspense fallback={<TeamMapLoading />}>
      <TeamMap />
    </Suspense>
  );
}
