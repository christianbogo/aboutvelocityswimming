import type { StandardSet } from "@/features/swim-resources/types/schema";
import { currentStandard } from "@/features/swim-resources/lib/domain/standards";
import type { Filters } from "./times-data";
import { RankLegend } from "./MotivationalRankIcon";

export default function EventRankLegend({
  filters,
  sets,
}: {
  filters: Filters;
  sets: StandardSet[];
}) {
  const day = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
  const standard = currentStandard(
    sets.filter((set) => set.governingBody === "USA_Swimming"),
    "motivational",
    day,
  );
  const ages = [
    ...new Set(
      filters.ageGroups.map((age) =>
        ["8&U", "9-10"].includes(age) ? "10&U" : age,
      ),
    ),
  ];
  const singleCohort = ages.length === 1 && filters.genders.length === 1;
  const cuts =
    singleCohort && !filters.relay
      ? standard?.cuts[filters.course]?.[filters.genders[0]]?.[ages[0]]?.[
          `${filters.event}_${filters.course}`
        ]?.cutsByTier
      : undefined;
  const cutoffs = Object.fromEntries(
    (cuts ?? [])
      .filter((cut) => Number.isFinite(cut.timeMs) && cut.timeMs > 0)
      .map((cut) => [cut.tierName, cut.timeMs]),
  );
  const description = filters.relay
    ? "Motivational cutoffs are unavailable for relay events."
    : singleCohort && !cuts?.length
      ? "No current motivational cutoffs are available for this selection."
      : undefined;
  return <RankLegend cutoffs={cutoffs} description={description} />;
}
