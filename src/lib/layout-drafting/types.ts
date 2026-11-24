import type { MotivationalRank } from "@/components/collection/motivational-ranks";

export type DraftingTier = MotivationalRank["tier"];
export type DraftingCourse = "SCY" | "LCM" | "SCM";

export interface DraftingAchievement {
  event: string;
  course: DraftingCourse;
  ageGroup: string;
  tier: DraftingTier;
}

export interface DraftingAthlete {
  id: string;
  athleteId: string | null;
  name: string;
  trainingGroups: string[];
  achievements: DraftingAchievement[];
}

export interface DraftingSnapshot {
  asOf: string;
  athletes: DraftingAthlete[];
  groups: string[];
  coverage: {
    rosterEntries: number;
    linkedAthletes: number;
    unlinkedEntries: number;
    duplicateLinks: number;
    athletesWithSwims: number;
    validSwims: number;
    missingAgeSwims: number;
    /** Known age, but no matching published historical benchmark. */
    missingStandardsSwims: number;
    /** Matching benchmark, but no B-or-higher standard achieved. */
    belowStandardSwims: number;
    /** All swims without a grade, including the three categories above. */
    ungradedSwims: number;
  };
  basis: {
    roster: string;
    results: string;
    standards: string;
  };
}

export const competitiveTrainingGroups = [
  "Prep",
  "Age Groupers",
  "Juniors",
  "Seniors",
] as const;
