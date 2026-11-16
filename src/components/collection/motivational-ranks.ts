import type { StandardSet } from "@/features/swim-resources/types/schema";
import type { Race } from "./times-data";
import { resultCuts, type ResultCut } from "./result-cuts";

/** Velocity's icon labels for the six USA Swimming motivational standards. */
export const motivationalRanks = [
  {
    tier: "B",
    name: "Bronze",
    icon: "/assets/ranks/bronze.svg",
    color: "#9E613B",
  },
  {
    tier: "BB",
    name: "Silver",
    icon: "/assets/ranks/silver.svg",
    color: "#687C98",
  },
  { tier: "A", name: "Gold", icon: "/assets/ranks/gold.svg", color: "#A37312" },
  {
    tier: "AA",
    name: "Platinum",
    icon: "/assets/ranks/platinum.svg",
    color: "#087F74",
  },
  {
    tier: "AAA",
    name: "Diamond",
    icon: "/assets/ranks/diamond.svg",
    color: "#4B74D2",
  },
  {
    tier: "AAAA",
    name: "Elite",
    icon: "/assets/ranks/elite.svg",
    color: "#AD478F",
  },
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
