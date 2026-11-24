import {
  motivationalRanks,
  motivationalRankForRace,
} from "@/components/collection/motivational-ranks";
import type { Race } from "@/components/collection/times-data";
import type { StandardSet } from "@/features/swim-resources/types/schema";
import {
  competitiveTrainingGroups,
  type DraftingAthlete,
  type DraftingAchievement,
  type DraftingSnapshot,
} from "./types";

export interface DraftingRosterEntry {
  id: string;
  athleteId: string | null;
  name: string;
  trainingGroup: string;
}

function validDay(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

/** Only published personal races; the API's view excludes flagged results and
 * inherited relay exclusions. No team restriction: the award belongs to the swimmer. */
export function buildDraftingSnapshot({
  roster,
  races,
  standards,
  asOf,
}: {
  roster: DraftingRosterEntry[];
  races: Race[];
  standards: StandardSet[];
  asOf: string;
}): DraftingSnapshot {
  if (!validDay(asOf)) throw new Error("Invalid drafting snapshot date.");
  const coverage: DraftingSnapshot["coverage"] = {
    rosterEntries: 0,
    linkedAthletes: 0,
    unlinkedEntries: 0,
    duplicateLinks: 0,
    athletesWithSwims: 0,
    validSwims: 0,
    missingAgeSwims: 0,
    missingStandardsSwims: 0,
    belowStandardSwims: 0,
    ungradedSwims: 0,
  };
  const athletes: DraftingAthlete[] = [];
  const linked = new Map<string, DraftingAthlete>();
  for (const entry of roster) {
    if (
      !competitiveTrainingGroups.some((group) => group === entry.trainingGroup)
    )
      continue;
    coverage.rosterEntries++;
    const athleteId = entry.athleteId?.trim() || null;
    const existing = athleteId ? linked.get(athleteId) : undefined;
    if (existing) {
      coverage.duplicateLinks++;
      if (!existing.trainingGroups.includes(entry.trainingGroup))
        existing.trainingGroups.push(entry.trainingGroup);
      continue;
    }
    const athlete: DraftingAthlete = {
      id: athleteId ? `linked:${athleteId}` : `unlinked:${entry.id}`,
      athleteId,
      name: entry.name.trim() || "Unnamed athlete",
      trainingGroups: [entry.trainingGroup],
      achievements: [],
    };
    athletes.push(athlete);
    if (athleteId) linked.set(athleteId, athlete);
    else coverage.unlinkedEntries++;
  }
  coverage.linkedAthletes = linked.size;
  const tiers = motivationalRanks.map((rank) => rank.tier);
  const awards = new Map<string, Map<string, DraftingAchievement>>();
  const seen = new Set<string>();
  const swimmers = new Set<string>();
  // Only published age-group editions; never substitute current or single-age cuts.
  const motivational = standards.filter(
    (set) =>
      set.governingBody === "USA_Swimming" &&
      set.category === "motivational" &&
      (!set.standardType || set.standardType === "age-group") &&
      validDay(set.effectiveDate) &&
      validDay(set.expirationDate),
  );
  for (const race of races) {
    const day = race.date.slice(0, 10);
    if (
      !linked.has(race.athleteId) ||
      seen.has(race.id) ||
      !validDay(day) ||
      day > asOf ||
      race.status !== "OK" ||
      !Number.isFinite(race.time) ||
      race.time <= 0 ||
      race.moderationStatus === "flagged" ||
      race.calculationEligible === false ||
      race.relay ||
      race.relayLeg != null ||
      (race.split && race.resultOrigin !== "relay_leadoff") ||
      !["SCY", "LCM", "SCM"].includes(race.course)
    )
      continue;
    seen.add(race.id);
    swimmers.add(race.athleteId);
    coverage.validSwims++;
    if (
      race.ageAtSwim == null ||
      !Number.isInteger(race.ageAtSwim) ||
      race.ageAtSwim < 0 ||
      race.ageAtSwim > 120
    ) {
      coverage.missingAgeSwims++;
      coverage.ungradedSwims++;
      continue;
    }
    const earned = motivationalRankForRace(race, motivational);
    if (!earned) {
      // Probe the same shared matcher with a positive sub-millisecond time to
      // distinguish an absent benchmark from a valid swim below the B threshold.
      if (
        motivationalRankForRace(
          { ...race, time: Number.MIN_VALUE },
          motivational,
        )
      )
        coverage.belowStandardSwims++;
      else coverage.missingStandardsSwims++;
      coverage.ungradedSwims++;
      continue;
    }
    const achievement: DraftingAchievement = {
      event: race.event,
      course: race.course as DraftingAchievement["course"],
      ageGroup: earned.cut.age
        .replace(/\s/g, "")
        .replaceAll("–", "-")
        .toUpperCase(),
      tier: earned.rank.tier,
    };
    const byEvent =
      awards.get(race.athleteId) ?? new Map<string, DraftingAchievement>();
    const key = JSON.stringify([
      achievement.event,
      achievement.course,
      achievement.ageGroup,
    ]);
    const previous = byEvent.get(key);
    if (
      !previous ||
      tiers.indexOf(achievement.tier) > tiers.indexOf(previous.tier)
    )
      byEvent.set(key, achievement);
    awards.set(race.athleteId, byEvent);
  }
  for (const athlete of athletes) {
    athlete.trainingGroups.sort();
    athlete.achievements = [
      ...(awards.get(athlete.athleteId ?? "")?.values() ?? []),
    ].sort(
      (a, b) =>
        a.course.localeCompare(b.course) ||
        a.event.localeCompare(b.event) ||
        a.ageGroup.localeCompare(b.ageGroup),
    );
  }
  coverage.athletesWithSwims = swimmers.size;
  return {
    asOf,
    athletes: athletes.sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    ),
    groups: [...competitiveTrainingGroups],
    coverage,
    basis: {
      roster:
        "Current non-archived athletes in active accounts: Prep, Age Groupers, Juniors and Seniors.",
      results:
        "Published, unflagged individual results across all teams and courses, including eligible relay lead-offs. Held results and ordinary splits are excluded.",
      standards:
        "USA Swimming motivational age-group standards in effect on each swim date, using recorded age at the swim. Repeated qualifying swims count once per event, course and age group.",
    },
  };
}
