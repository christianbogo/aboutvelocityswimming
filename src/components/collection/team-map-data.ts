import type { StandardSet } from "@/features/swim-resources/types/schema";
import { VELOCITY_TEAM_ID } from "@/features/swim-resources/lib/domain/entities";
import { motivationalRanks } from "./motivational-ranks";
import type { Race } from "./times-data";

export interface TeamMapRosterEntry {
  athleteId: string | null;
  name: string;
  trainingGroup: string;
}

export interface TeamMapContributor {
  athleteId: string;
  name: string;
  trainingGroups: string[];
  total: number;
  counts: Record<string, number>;
}

export interface TeamMapAgeGroup {
  ageGroup: string;
  total: number;
  athletes: number;
  counts: Record<string, number>;
  leaders: TeamMapContributor[];
}

export interface TeamMapSnapshot {
  asOf: string;
  year: number;
  course: string;
  coverage: {
    rosterEntries: number;
    linkedAthletes: number;
    unlinkedEntries: number;
    duplicateLinks: number;
    athletesWithSwims: number;
    validSwims: number;
    ungradedSwims: number;
    missingAgeSwims: number;
  };
  rankCounts: Record<string, number>;
  totalContributions: number;
  contributorCount: number;
  leaders: TeamMapContributor[];
  ageGroups: TeamMapAgeGroup[];
  activity: {
    swims: number;
    swimmers: number;
    meets: number;
    improvedEvents: number;
    newRankedEvents: number;
    rankUpgrades: number;
    months: { month: string; swims: number; swimmers: number }[];
    recent: {
      athleteId: string;
      name: string;
      event: string;
      course: string;
      ageGroup: string;
      tier: string;
      date: string;
      kind: "first" | "upgrade";
    }[];
  };
}

export interface TeamMapInput {
  /** Only current, non-archived athletes from non-archived accounts. */
  roster: TeamMapRosterEntry[];
  races: Race[];
  standards: StandardSet[];
  year: number;
  /** Empty means all courses; each course remains a distinct achievement. */
  course: string;
  asOf: string;
}

const tiers = motivationalRanks.map((rank) => rank.tier);
const emptyCounts = () => Object.fromEntries(tiers.map((tier) => [tier, 0]));
const key = (...parts: (string | number)[]) => JSON.stringify(parts);

function validDay(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

function knownAge(age: Race["ageAtSwim"]): age is number {
  return age != null && Number.isInteger(age) && age >= 0 && age <= 120;
}

function eligible(race: Race) {
  return (
    race.team === VELOCITY_TEAM_ID &&
    race.status === "OK" &&
    Number.isFinite(race.time) &&
    race.time > 0 &&
    race.moderationStatus !== "flagged" &&
    race.calculationEligible !== false &&
    !race.relay &&
    race.relayLeg == null &&
    (!race.split || race.resultOrigin === "relay_leadoff") &&
    ["SCY", "LCM", "SCM"].includes(race.course)
  );
}

interface Benchmark {
  from: string;
  until: string;
  ageGroup: string;
  min: number;
  max: number;
  cuts: { level: number; time: number }[];
}

function ageBand(
  value: string,
): Pick<Benchmark, "ageGroup" | "min" | "max"> | null {
  const ageGroup = value.replace(/\s/g, "").replaceAll("–", "-").toUpperCase();
  const range = /^(\d+)-(\d+)$/.exec(ageGroup);
  if (range && +range[1] <= +range[2])
    return { ageGroup, min: +range[1], max: +range[2] };
  const bound = /^(\d+)&([UO])$/.exec(ageGroup);
  if (bound)
    return {
      ageGroup,
      min: bound[2] === "U" ? 0 : +bound[1],
      max: bound[2] === "U" ? +bound[1] : Infinity,
    };
  // The shared motivational display uses age-group rather than single-age cuts.
  return null;
}

/** Index once, retaining the same historical-edition / highest-tier selection as
 * motivationalRankForRace. A fastest PB alone cannot reconstruct earned ranks. */
function benchmarkIndex(standards: StandardSet[]) {
  const index = new Map<string, Benchmark[]>();
  for (const set of [...standards].sort(
    (a, b) =>
      b.effectiveDate.localeCompare(a.effectiveDate) ||
      a.id.localeCompare(b.id),
  )) {
    if (
      set.governingBody !== "USA_Swimming" ||
      set.category !== "motivational" ||
      (set.standardType && set.standardType !== "age-group") ||
      /open water/i.test(set.name) ||
      !validDay(set.effectiveDate) ||
      !validDay(set.expirationDate)
    )
      continue;
    for (const [course, genders] of Object.entries(set.cuts))
      for (const [gender, ages] of Object.entries(genders ?? {}))
        for (const [group, events] of Object.entries(ages ?? {})) {
          const band = ageBand(group);
          if (!band) continue;
          for (const [eventCode, event] of Object.entries(events ?? {})) {
            if (!eventCode.endsWith(`_${course}`)) continue;
            const eventName = eventCode.slice(0, -(course.length + 1));
            const cuts = event.cutsByTier
              .flatMap((cut) => {
                const level = tiers.findIndex((tier) => tier === cut.tierName);
                return level >= 0 &&
                  Number.isFinite(cut.timeMs) &&
                  cut.timeMs > 0
                  ? [{ level, time: cut.timeMs }]
                  : [];
              })
              .sort((a, b) => b.level - a.level);
            if (!cuts.length) continue;
            const lookup = key(course, gender, eventName);
            const benchmarks = index.get(lookup) ?? [];
            benchmarks.push({
              ...band,
              from: set.effectiveDate,
              until: set.expirationDate,
              cuts,
            });
            index.set(lookup, benchmarks);
          }
        }
  }
  return index;
}

function grade(race: Race, day: string, index: Map<string, Benchmark[]>) {
  if (!knownAge(race.ageAtSwim)) return null;
  let result: { level: number; ageGroup: string } | null = null;
  for (const benchmark of index.get(
    key(race.course, race.gender ?? "", race.event),
  ) ?? []) {
    if (
      day < benchmark.from ||
      day > benchmark.until ||
      race.ageAtSwim < benchmark.min ||
      race.ageAtSwim > benchmark.max
    )
      continue;
    const cut = benchmark.cuts.find((cut) => race.time <= cut.time);
    if (cut && (result == null || cut.level > result.level))
      result = { level: cut.level, ageGroup: benchmark.ageGroup };
  }
  return result;
}

function sortContributors(values: TeamMapContributor[]) {
  return values.sort((a, b) => {
    if (a.total !== b.total) return b.total - a.total;
    for (const tier of [...tiers].reverse())
      if (a.counts[tier] !== b.counts[tier])
        return b.counts[tier] - a.counts[tier];
    return (
      a.name.localeCompare(b.name) || a.athleteId.localeCompare(b.athleteId)
    );
  });
}

interface Achievement {
  athleteId: string;
  event: string;
  course: string;
  ageGroup: string;
  highest: number;
  beforeYear: number;
  inYear: number;
  yearDate: string;
}

/** Career inventory: one highest earned rank per athlete, event, course, gender,
 * and motivational age group. Calendar-year activity is a separate comparison
 * with each key's pre-year baseline, not a tally of repeated qualifying swims. */
export function buildTeamMap({
  roster,
  races,
  standards,
  year,
  course,
  asOf,
}: TeamMapInput): TeamMapSnapshot {
  if (
    !validDay(asOf) ||
    !Number.isInteger(year) ||
    year < 1900 ||
    year > 9999 ||
    !["", "SCY", "LCM", "SCM"].includes(course)
  )
    throw new Error("Invalid Team Map selection.");
  const people = new Map<string, TeamMapContributor>();
  let unlinkedEntries = 0;
  let duplicateLinks = 0;
  for (const entry of roster) {
    if (!entry.athleteId?.trim()) {
      unlinkedEntries++;
      continue;
    }
    const existing = people.get(entry.athleteId);
    if (existing) {
      duplicateLinks++;
      if (
        entry.trainingGroup.trim() &&
        !existing.trainingGroups.includes(entry.trainingGroup.trim())
      )
        existing.trainingGroups.push(entry.trainingGroup.trim());
    } else
      people.set(entry.athleteId, {
        athleteId: entry.athleteId,
        name: entry.name.trim() || entry.athleteId,
        trainingGroups: entry.trainingGroup.trim()
          ? [entry.trainingGroup.trim()]
          : [],
        total: 0,
        counts: emptyCounts(),
      });
  }
  for (const person of people.values()) person.trainingGroups.sort();
  const benchmark = benchmarkIndex(standards);
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const history = races.filter((race) => {
    const day = race.date.slice(0, 10);
    return (
      people.has(race.athleteId) &&
      eligible(race) &&
      validDay(day) &&
      day <= asOf &&
      (!course || race.course === course)
    );
  });
  const seenRaces = new Set<string>();
  const uniqueHistory = history.filter((race) => {
    if (seenRaces.has(race.id)) return false;
    seenRaces.add(race.id);
    return true;
  });
  const athletesWithSwims = new Set<string>();
  const annualSwimmers = new Set<string>();
  const annualMeets = new Set<string>();
  const monthSwimmers = Array.from({ length: 12 }, () => new Set<string>());
  const months = Array.from({ length: 12 }, (_, index) => ({
    month: `${year}-${String(index + 1).padStart(2, "0")}`,
    swims: 0,
    swimmers: 0,
  }));
  const achievements = new Map<string, Achievement>();
  // A daily minimum avoids inventing prelim/final order when dates lack times.
  const dailyBests = new Map<
    string,
    { athleteEvent: string; day: string; time: number }
  >();
  let ungradedSwims = 0;
  let missingAgeSwims = 0;
  let annualSwims = 0;
  for (const race of uniqueHistory) {
    const day = race.date.slice(0, 10);
    const duringYear = day >= start && day <= end;
    athletesWithSwims.add(race.athleteId);
    const athleteEvent = key(
      race.athleteId,
      race.event,
      race.course,
      race.gender ?? "",
    );
    const dailyKey = key(athleteEvent, day);
    const previous = dailyBests.get(dailyKey);
    if (!previous || race.time < previous.time)
      dailyBests.set(dailyKey, { athleteEvent, day, time: race.time });
    if (duringYear) {
      annualSwims++;
      annualSwimmers.add(race.athleteId);
      annualMeets.add(race.meetId || key(race.meet, day));
      const month = Number(day.slice(5, 7)) - 1;
      months[month].swims++;
      monthSwimmers[month].add(race.athleteId);
    }
    if (!knownAge(race.ageAtSwim)) missingAgeSwims++;
    const earned = grade(race, day, benchmark);
    if (!earned) {
      ungradedSwims++;
      continue;
    }
    const achievementKey = key(
      race.athleteId,
      race.event,
      race.course,
      race.gender ?? "",
      earned.ageGroup,
    );
    const achievement = achievements.get(achievementKey) ?? {
      athleteId: race.athleteId,
      event: race.event,
      course: race.course,
      ageGroup: earned.ageGroup,
      highest: -1,
      beforeYear: -1,
      inYear: -1,
      yearDate: "",
    };
    achievement.highest = Math.max(achievement.highest, earned.level);
    if (day < start)
      achievement.beforeYear = Math.max(achievement.beforeYear, earned.level);
    if (
      duringYear &&
      (earned.level > achievement.inYear ||
        (earned.level === achievement.inYear && day < achievement.yearDate))
    ) {
      achievement.inYear = earned.level;
      achievement.yearDate = day;
    }
    achievements.set(achievementKey, achievement);
  }
  const priorBest = new Map<string, number>();
  const improvedEvents = new Set<string>();
  for (const best of [...dailyBests.values()].sort((a, b) =>
    a.day.localeCompare(b.day),
  )) {
    const previous = priorBest.get(best.athleteEvent);
    if (
      best.day >= start &&
      best.day <= end &&
      previous != null &&
      best.time < previous
    )
      improvedEvents.add(best.athleteEvent);
    if (previous == null || best.time < previous)
      priorBest.set(best.athleteEvent, best.time);
  }
  const rankCounts = emptyCounts();
  const ages = new Map<string, TeamMapAgeGroup>();
  const agePeople = new Map<string, Map<string, TeamMapContributor>>();
  const recent: TeamMapSnapshot["activity"]["recent"] = [];
  let newRankedEvents = 0;
  let rankUpgrades = 0;
  for (const achievement of achievements.values()) {
    const tier = tiers[achievement.highest];
    const person = people.get(achievement.athleteId)!;
    rankCounts[tier]++;
    person.total++;
    person.counts[tier]++;
    const age = ages.get(achievement.ageGroup) ?? {
      ageGroup: achievement.ageGroup,
      total: 0,
      athletes: 0,
      counts: emptyCounts(),
      leaders: [],
    };
    age.total++;
    age.counts[tier]++;
    ages.set(achievement.ageGroup, age);
    const contributors =
      agePeople.get(achievement.ageGroup) ??
      new Map<string, TeamMapContributor>();
    const contributor = contributors.get(person.athleteId) ?? {
      ...person,
      total: 0,
      counts: emptyCounts(),
      trainingGroups: [...person.trainingGroups],
    };
    contributor.total++;
    contributor.counts[tier]++;
    contributors.set(person.athleteId, contributor);
    agePeople.set(achievement.ageGroup, contributors);
    if (
      achievement.inYear >= 0 &&
      achievement.inYear > achievement.beforeYear
    ) {
      const kind = achievement.beforeYear < 0 ? "first" : "upgrade";
      if (kind === "first") newRankedEvents++;
      else rankUpgrades++;
      // At most one item per key: the first date the year's highest new level was earned.
      recent.push({
        athleteId: person.athleteId,
        name: person.name,
        event: achievement.event,
        course: achievement.course,
        ageGroup: achievement.ageGroup,
        tier: tiers[achievement.inYear],
        date: achievement.yearDate,
        kind,
      });
    }
  }
  for (const age of ages.values()) {
    age.leaders = sortContributors([...agePeople.get(age.ageGroup)!.values()]);
    age.athletes = age.leaders.length;
  }
  const leaders = sortContributors(
    [...people.values()].filter((person) => person.total > 0),
  );
  return {
    asOf,
    year,
    course,
    coverage: {
      rosterEntries: roster.length,
      linkedAthletes: people.size,
      unlinkedEntries,
      duplicateLinks,
      athletesWithSwims: athletesWithSwims.size,
      validSwims: uniqueHistory.length,
      ungradedSwims,
      missingAgeSwims,
    },
    rankCounts,
    totalContributions: achievements.size,
    contributorCount: leaders.length,
    leaders,
    ageGroups: [...ages.values()].sort(
      (a, b) =>
        (parseInt(a.ageGroup) || 0) - (parseInt(b.ageGroup) || 0) ||
        a.ageGroup.localeCompare(b.ageGroup),
    ),
    activity: {
      swims: annualSwims,
      swimmers: annualSwimmers.size,
      meets: annualMeets.size,
      improvedEvents: improvedEvents.size,
      newRankedEvents,
      rankUpgrades,
      months: months.map((month, index) => ({
        ...month,
        swimmers: monthSwimmers[index].size,
      })),
      recent: recent
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            a.name.localeCompare(b.name) ||
            a.event.localeCompare(b.event),
        )
        .slice(0, 20),
    },
  };
}
