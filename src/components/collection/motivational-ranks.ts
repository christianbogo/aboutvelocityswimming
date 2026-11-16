import type { StandardSet } from "@/features/swim-resources/types/schema";
import type { Race } from "./times-data";
import { resultCuts, type ResultCut } from "./result-cuts";

/** Velocity's icon labels for the six USA Swimming motivational standards. */
export const motivationalRanks = [
  { tier: "B", name: "Bronze", icon: "/assets/ranks/bronze.svg" },
  { tier: "BB", name: "Silver", icon: "/assets/ranks/silver.svg" },
  { tier: "A", name: "Gold", icon: "/assets/ranks/gold.svg" },
  { tier: "AA", name: "Platinum", icon: "/assets/ranks/platinum.svg" },
  { tier: "AAA", name: "Diamond", icon: "/assets/ranks/diamond.svg" },
  { tier: "AAAA", name: "Elite", icon: "/assets/ranks/elite.svg" },
] as const;

export type MotivationalRank = (typeof motivationalRanks)[number];

export function motivationalRankForTier(
  tier: string,
): MotivationalRank | undefined {
  return motivationalRanks.find(
    (rank) => rank.tier === tier.trim().toUpperCase(),
  );
}

/** Use the same exact-course, age-at-swim and edition rules as result cut chips. */
export function motivationalRankForRace(
  race: Race,
  sets: StandardSet[],
): { rank: MotivationalRank; cut: ResultCut } | null {
  const cut = resultCuts(race, sets).find((result) => result.motivational);
  const rank = cut ? motivationalRankForTier(cut.tier) : undefined;
  return rank && cut ? { rank, cut } : null;
}
