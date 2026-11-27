import type { StandardSet } from "@/features/swim-resources/types/schema";
import type { Race } from "./times-data";
import {
  motivationalRankForRace,
  motivationalRanks,
} from "./motivational-ranks";
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
export type TeamMeetData = {
  meet: TeamMeet | null;
  before: Race[];
  swims: Race[];
};
export type TeamData = TeamMeetData & {
  asOf: string;
  seasonStart: string;
  seasonSwims: Race[];
  roster: TeamMember[];
  bests: Race[];
  meets: TeamMeet[];
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
function raceKey(race: Race) {
  return JSON.stringify([race.athleteId, race.event, race.course]);
}
function rankLevel(race: Race, sets: StandardSet[]) {
  const tier = motivationalRankForRace(race, sets)?.rank.tier;
  return motivationalRanks.findIndex((rank) => rank.tier === tier);
}

/** One achievement per event/course, choosing rank before speed across birthdays. */
export function bestRankRaces(races: Race[], sets: StandardSet[]) {
  const bests = new Map<string, Race>();
  for (const race of races) {
    if (!eligibleTeamRace(race)) continue;
    const key = raceKey(race);
    const old = bests.get(key);
    if (
      !old ||
      rankLevel(race, sets) > rankLevel(old, sets) ||
      (rankLevel(race, sets) === rankLevel(old, sets) && race.time < old.time)
    )
      bests.set(key, race);
  }
  return [...bests.values()];
}

/** Count destination ranks per event, so promotions cannot cancel other additions. */
export function rankAdditionRaces(
  before: Race[],
  swims: Race[],
  sets: StandardSet[],
) {
  const old = new Map(teamBests(before).map((race) => [raceKey(race), race]));
  return teamBests([...before, ...swims]).filter((race) => {
    if (!swims.some((swim) => swim.id === race.id)) return false;
    const previous = old.get(raceKey(race));
    return rankLevel(race, sets) > (previous ? rankLevel(previous, sets) : -1);
  });
}
export function rankChanges(
  before: Race[],
  swims: Race[],
  sets: StandardSet[],
) {
  return countRanks(rankAdditionRaces(before, swims, sets), sets);
}

export const profileAges: Record<string, string> = {
  Prep: "10&U",
  "Age Groupers": "11-12",
  Juniors: "13-14",
  Seniors: "15&O",
};

/** Use the assigned group's cuts, irrespective of age when the best was swum. */
export function competitiveProfile(
  races: Race[],
  group: string,
  sets: StandardSet[],
  asOf: string,
) {
  const age = profileAges[group];
  const profileSets = sets.map((set) => ({
    ...set,
    cuts: Object.fromEntries(
      Object.entries(set.cuts).map(([course, genders]) => [
        course,
        Object.fromEntries(
          Object.entries(genders ?? {}).map(([gender, ages]) => {
            const exact = Object.entries(ages ?? {}).find(
              ([key]) => key.replace(/\s/g, "").replace("–", "-") === age,
            )?.[1];
            // USA Swimming publishes 15–16 and 17–18 rather than a single 15&O band.
            // When necessary, use the stricter cut from those two bands for each tier.
            const senior = Object.entries(ages ?? {}).filter(([key]) =>
              ["15-16", "17-18"].includes(key.replace("–", "-")),
            );
            const events: typeof exact = exact ?? {};
            if (!exact && age === "15&O") {
              for (const [, source] of senior)
                for (const [event, value] of Object.entries(source ?? {})) {
                  const cuts = [
                    ...(events[event]?.cutsByTier ?? []),
                    ...value.cutsByTier,
                  ];
                  events[event] = {
                    cutsByTier: motivationalRanks.flatMap(({ tier }) => {
                      const cut = cuts
                        .filter(
                          (cut) => cut.tierName === tier && cut.timeMs > 0,
                        )
                        .sort((a, b) => a.timeMs - b.timeMs)[0];
                      return cut ? [cut] : [];
                    }),
                  };
                }
            }
            return [gender, { [age]: events }];
          }),
        ),
      ]),
    ),
  }));
  const bests = teamBests(races).map((race) => ({
    ...race,
    date: asOf,
    ageAtSwim: (
      { Prep: 10, "Age Groupers": 12, Juniors: 14, Seniors: 18 } as Record<
        string,
        number
      >
    )[group],
  }));
  const counts = countRanks(bests, profileSets);
  return {
    counts,
    total: bests.length,
    unranked: bests.length - Object.values(counts).reduce((a, b) => a + b, 0),
  };
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
      seasonCounts: countRanks(
        bestRankRaces(
          data.seasonSwims.filter(
            (race) => race.athleteId === member.athleteId,
          ),
          sets,
        ),
        sets,
      ),
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
      profile: competitiveProfile(
        data.bests.filter((race) => ids.has(race.athleteId)),
        name,
        sets,
        data.asOf,
      ),
      seasonCounts: countRanks(
        bestRankRaces(
          data.seasonSwims.filter((race) => ids.has(race.athleteId)),
          sets,
        ),
        sets,
      ),
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
  return { groups, leaders };
}

export function buildTeamMeet(
  data: TeamMeetData,
  roster: TeamMember[],
  sets: StandardSet[],
) {
  const athletes = [...new Set(data.swims.map((race) => race.athleteId))]
    .map((athleteId) => {
      const swims = data.swims.filter((race) => race.athleteId === athleteId);
      const before = data.before.filter((race) => race.athleteId === athleteId);
      return {
        athleteId,
        name:
          roster.find((member) => member.athleteId === athleteId)?.name ||
          swims[0]?.athleteName ||
          "Unknown athlete",
        swims,
        changes: rankChanges(before, swims, sets),
        additions: rankAdditionRaces(before, swims, sets),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    athletes,
    changes: addCounts(athletes.map((athlete) => athlete.changes)),
    meetHighlights: teamHighlights(
      athletes.flatMap((athlete) => athlete.additions),
      sets,
    ).slice(0, 3),
  };
}
