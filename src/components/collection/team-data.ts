import type { StandardSet } from "@/features/swim-resources/types/schema";
import type { Race } from "./times-data";
import { motivationalRanks } from "./motivational-ranks";
import { rankHighlights } from "./times-highlights";
import { compareEvents } from "./event-layout";

export const competitiveGroups = [
  "Prep",
  "Age Groupers",
  "Juniors",
  "Seniors",
] as const;
export type RankCounts = Record<string, number>;
export type TeamMember = {
  id: string;
  name: string;
  group: string;
  athleteId: string | null;
};
export type TeamMeet = {
  id: string;
  name: string;
  start: string;
  date: string;
};
export type TeamData = {
  roster: TeamMember[];
  bests: Race[];
  meets: TeamMeet[];
  meet: TeamMeet | null;
  before: Race[];
  swims: Race[];
};

export function eligibleTeamRace(race: Race) {
  return (
    race.status === "OK" &&
    Number.isFinite(race.time) &&
    race.time > 0 &&
    race.moderationStatus !== "flagged" &&
    race.calculationEligible !== false &&
    !race.relay &&
    (!race.split || race.resultOrigin === "relay_leadoff") &&
    /^\d{4}-\d{2}-\d{2}$/.test(race.date.slice(0, 10))
  );
}

/** Each event/course contributes exactly one best; equal times prefer the latest swim. */
export function teamBests(races: Race[]) {
  const bests = new Map<string, Race>();
  for (const race of races) {
    if (!eligibleTeamRace(race)) continue;
    const key = JSON.stringify([race.athleteId, race.event, race.course]);
    const old = bests.get(key);
    if (
      !old ||
      race.time < old.time ||
      (race.time === old.time &&
        (race.date > old.date || (race.date === old.date && race.id < old.id)))
    )
      bests.set(key, race);
  }
  return [...bests.values()].sort(
    (a, b) =>
      a.course.localeCompare(b.course) ||
      compareEvents(a.event, b.event) ||
      a.athleteId.localeCompare(b.athleteId),
  );
}

export function teamHighlights(races: Race[], sets: StandardSet[]) {
  return rankHighlights(
    races.map((race) => ({
      event: race.event,
      race,
      rankRace: null,
      allTimeRank: null,
      allTimeCount: 0,
      rankAgeGroup: null,
      rankGender: null,
    })),
    sets,
  );
}
export function countRanks(races: Race[], sets: StandardSet[]): RankCounts {
  const counts = Object.fromEntries(
    motivationalRanks.map(({ tier }) => [tier, 0]),
  );
  for (const { rank } of teamHighlights(teamBests(races), sets)) {
    if (rank) counts[rank.rank.tier]++;
  }
  return counts;
}
export function addCounts(counts: RankCounts[]): RankCounts {
  return Object.fromEntries(
    motivationalRanks.map(({ tier }) => [
      tier,
      counts.reduce((sum, count) => sum + (count[tier] ?? 0), 0),
    ]),
  );
}
export function rankChanges(
  before: Race[],
  swims: Race[],
  sets: StandardSet[],
) {
  const old = countRanks(before, sets);
  const next = countRanks([...before, ...swims], sets);
  return Object.fromEntries(
    motivationalRanks.map(({ tier }) => [tier, next[tier] - old[tier]]),
  );
}

export function buildTeamOverview(data: TeamData, sets: StandardSet[]) {
  const members = data.roster.map((member) => {
    const bests = teamBests(
      data.bests.filter((race) => race.athleteId === member.athleteId),
    );
    return {
      ...member,
      bests,
      counts: countRanks(bests, sets),
      highlights: teamHighlights(bests, sets),
    };
  });
  const groups = competitiveGroups.map((name) => {
    const roster = members.filter((member) => member.group === name);
    // A duplicated registration link must never inflate the team's rank totals.
    const ids = new Set(
      roster.map((member) => member.athleteId).filter(Boolean),
    );
    return {
      name,
      roster,
      counts: countRanks(
        data.bests.filter((race) => ids.has(race.athleteId)),
        sets,
      ),
    };
  });
  const seen = new Set<string>();
  const leaders = members
    .filter((member) => {
      if (
        !member.athleteId ||
        !member.bests.length ||
        seen.has(member.athleteId)
      )
        return false;
      seen.add(member.athleteId);
      return true;
    })
    .sort((a, b) => {
      for (const { tier } of [...motivationalRanks].reverse()) {
        if (a.counts[tier] !== b.counts[tier])
          return b.counts[tier] - a.counts[tier];
      }
      return (
        (b.highlights[0]?.margin ?? 0) - (a.highlights[0]?.margin ?? 0) ||
        a.name.localeCompare(b.name)
      );
    })
    .slice(0, 3);
  const athletes = [...new Set(data.swims.map((race) => race.athleteId))]
    .map((athleteId) => {
      const swims = data.swims.filter((race) => race.athleteId === athleteId);
      const before = data.before.filter((race) => race.athleteId === athleteId);
      return {
        athleteId,
        name:
          members.find((member) => member.athleteId === athleteId)?.name ||
          swims[0]?.athleteName ||
          "Unknown athlete",
        swims,
        changes: rankChanges(before, swims, sets),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    groups,
    leaders,
    athletes,
    changes: addCounts(athletes.map((athlete) => athlete.changes)),
    meetHighlights: teamHighlights(teamBests(data.swims), sets).slice(0, 3),
  };
}
