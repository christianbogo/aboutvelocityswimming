import type { MotivationalRank } from "./motivational-ranks";

/** Shared scoring for Team standings and the My Times event-family graph. */
export const rankPoints: Record<MotivationalRank["tier"], number> = {
  B: 1,
  BB: 2,
  A: 5,
  AA: 10,
  AAA: 25,
  AAAA: 50,
};

export function pointsForRank(tier: string | null | undefined): number {
  return tier && Object.hasOwn(rankPoints, tier)
    ? rankPoints[tier as MotivationalRank["tier"]]
    : 0;
}

export function pointsForCounts(counts: Record<string, number>): number {
  return Object.entries(rankPoints).reduce(
    (total, [tier, points]) => total + (counts[tier] ?? 0) * points,
    0,
  );
}
