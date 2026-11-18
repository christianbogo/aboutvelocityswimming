import type { StandardSet } from "@/features/swim-resources/types/schema";
import { currentStandard } from "@/features/swim-resources/lib/domain/standards";
import type { Filters } from "./times-data";
import {
  motivationalRankForTier,
  type MotivationalRank,
} from "./motivational-ranks";

export interface RankingCutoff {
  rank: MotivationalRank;
  time: number;
  seasonYears: string;
}

/** A shared threshold is meaningful only for one course, event and cohort. */
export function rankingCutoffs(
  filters: Filters,
  sets: StandardSet[],
  day = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  }),
): RankingCutoff[] {
  const ages = [
    ...new Set(
      filters.ageGroups.map((age) =>
        ["8&U", "9-10"].includes(age) ? "10&U" : age,
      ),
    ),
  ];
  if (
    filters.relay ||
    filters.mode === "recent" ||
    ages.length !== 1 ||
    filters.genders.length !== 1
  )
    return [];
  if (filters.year && !/^\d{4}$/.test(filters.year)) return [];
  // Past years use the edition at year end. The current year stays on today's
  // edition so an upcoming change cannot take effect early.
  const cutoffDay =
    filters.year && filters.year !== day.slice(0, 4)
      ? `${filters.year}-12-31`
      : day;
  const standard = currentStandard(
    sets.filter((set) => set.governingBody === "USA_Swimming"),
    "motivational",
    cutoffDay,
  );
  if (!standard) return [];
  const cuts =
    standard.cuts[filters.course]?.[filters.genders[0]]?.[ages[0]]?.[
      `${filters.event}_${filters.course}`
    ]?.cutsByTier ?? [];
  return cuts
    .flatMap((cut) => {
      const rank = motivationalRankForTier(cut.tierName);
      return rank && Number.isFinite(cut.timeMs) && cut.timeMs > 0
        ? [{ rank, time: cut.timeMs, seasonYears: standard.seasonYears }]
        : [];
    })
    .sort((a, b) => a.time - b.time);
}

/** Exact ties qualify, so place the divider before the first slower swim. */
export function crossedRankingCutoffs(
  cutoffs: RankingCutoff[],
  previousTime: number | undefined,
  time: number,
) {
  return previousTime == null
    ? []
    : cutoffs.filter(
        (cutoff) => previousTime <= cutoff.time && time > cutoff.time,
      );
}
