import type { StandardSet } from "@/features/swim-resources/types/schema";
import { currentStandard } from "@/features/swim-resources/lib/domain/standards";
import type { MyTimesEvent } from "./times-api";
import {
  ageGroups,
  eventLabel,
  matchesAgeGroup,
  timesEvents,
  type Race,
} from "./times-data";

export interface GoalTarget {
  id: string;
  kind: "motivational" | "championship" | "board";
  label: string;
  time: number;
  drop: number;
  percent: number;
  sourceUrl?: string;
  season?: string;
}

export interface GoalRankingRow {
  race: Race;
  rank?: number;
}

export interface GoalMove {
  event: string;
  race: Race;
  currentRank: number;
  targetRank: number;
  time: number;
  drop: number;
  percent: number;
}

export interface UntriedEvent {
  event: string;
  reason: string;
}

const tiers = ["B", "BB", "A", "AA", "AAA", "AAAA"];

function eligible(race: Race) {
  return (
    race.status === "OK" &&
    race.moderationStatus !== "flagged" &&
    race.calculationEligible !== false &&
    !race.relay &&
    (!race.split || race.resultOrigin === "relay_leadoff") &&
    Number.isFinite(race.time) &&
    race.time > 0
  );
}

export function goalAgeGroup(age: number | null): string | null {
  if (age == null || !Number.isInteger(age) || age < 0 || age > 120)
    return null;
  return (
    ageGroups.find(([, , min, max]) => age >= min && age <= max)?.[0] ?? null
  );
}

function ageMatches(group: string, age: number | null) {
  const key = group.replace(/\s/g, "").toUpperCase();
  if (key === "OPEN") return true;
  if (!goalAgeGroup(age)) return false;
  const range = /^(\d+)[–-](\d+)$/.exec(key);
  if (range) return age! >= +range[1] && age! <= +range[2];
  const bound = /^(\d+)&([UO])$/.exec(key);
  if (bound) return bound[2] === "U" ? age! <= +bound[1] : age! >= +bound[1];
  return /^\d+$/.test(key) && age === +key;
}

function active(set: StandardSet, day: string) {
  return (
    set.effectiveDate <= day &&
    set.expirationDate >= day &&
    set.standardType !== "para" &&
    !/open[\s-]*water|\bpara\b|disabil/i.test(set.name)
  );
}

function motivationalSet(sets: StandardSet[], day: string) {
  return currentStandard(
    sets.filter(
      (set) => set.governingBody === "USA_Swimming" && active(set, day),
    ),
    "motivational",
    day,
  );
}

function eventCuts(set: StandardSet, race: Race, age: number | null) {
  const motivational = set.category === "motivational";
  return Object.entries(set.cuts[race.course]?.[race.gender ?? ""] ?? {})
    .filter(
      ([group]) =>
        ageMatches(group, age) &&
        (!motivational || (group !== "Open" && !/^\d+$/.test(group))),
    )
    .flatMap(([group, events]) =>
      (events?.[`${race.event}_${race.course}`]?.cutsByTier ?? []).map(
        (cut) => ({
          ...cut,
          group,
        }),
      ),
    )
    .filter((cut) => Number.isFinite(cut.timeMs) && cut.timeMs > 0);
}

function sourceUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function target(
  id: string,
  kind: GoalTarget["kind"],
  label: string,
  time: number,
  best: number,
  extra: Pick<GoalTarget, "sourceUrl" | "season"> = {},
): GoalTarget {
  const drop = best - time;
  return {
    id,
    kind,
    label,
    time,
    drop,
    percent: (drop / best) * 100,
    ...extra,
  };
}

/** Current, exact-course time benchmarks. Meeting a cut is not an entry approval. */
export function standardGoals(
  race: Race,
  sets: StandardSet[],
  age: number | null,
  day: string,
): GoalTarget[] {
  if (!eligible(race) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
  const motivational = motivationalSet(sets, day);
  const selected = [
    ...(motivational ? [motivational] : []),
    ...sets.filter(
      (set) => set.category === "championship" && active(set, day),
    ),
  ];
  return selected
    .flatMap((set) => {
      const motivation = set.category === "motivational";
      const cut = eventCuts(set, race, age)
        .filter(
          (cut) =>
            cut.timeMs < race.time &&
            (motivation
              ? tiers.includes(cut.tierName)
              : !/bonus/i.test(cut.tierName)),
        )
        .sort(
          (a, b) => b.timeMs - a.timeMs || a.tierName.localeCompare(b.tierName),
        )[0];
      if (!cut) return [];
      return [
        target(
          `${set.id}:${cut.group}:${cut.tierName}`,
          motivation ? "motivational" : "championship",
          motivation
            ? `USA Swimming ${cut.tierName}`
            : `${set.name}${/^qualifying$/i.test(cut.tierName) ? "" : ` · ${cut.tierName}`}`,
          cut.timeMs,
          race.time,
          { sourceUrl: sourceUrl(set.sourceUrl), season: set.seasonYears },
        ),
      ];
    })
    .sort((a, b) => a.drop - b.drop || a.label.localeCompare(b.label));
}

function opponents(event: MyTimesEvent, rows: GoalRankingRow[]) {
  const race = event.race;
  if (!race || !eligible(race) || !event.rankAgeGroup || !event.rankGender)
    return [];
  const athletes = new Set<string>();
  return [...rows]
    .filter(
      (row) =>
        eligible(row.race) &&
        row.race.athleteId !== race.athleteId &&
        row.race.event === event.event &&
        row.race.course === race.course &&
        row.race.gender === event.rankGender &&
        matchesAgeGroup(row.race, event.rankAgeGroup!),
    )
    .sort(
      (a, b) =>
        a.race.time - b.race.time ||
        a.race.athleteId.localeCompare(b.race.athleteId),
    )
    .filter((row) => {
      if (athletes.has(row.race.athleteId)) return false;
      athletes.add(row.race.athleteId);
      return true;
    });
}

/** A tie at the Nth time enters the top N; an outright pass is not required. */
export function boardGoals(
  event: MyTimesEvent,
  rows: GoalRankingRow[],
): GoalTarget[] {
  const race = event.race;
  if (!race || !eligible(race) || !event.allTimeRank) return [];
  const ranked = opponents(event, rows);
  return [25, 10, 5, 1]
    .flatMap((milestone) => {
      if (event.allTimeRank! <= milestone || ranked.length < milestone)
        return [];
      // Nearby pages can be merged into rows. Require a complete prefix so a
      // missing page cannot masquerade as the top-25 cutoff.
      const prefix = ranked.slice(0, milestone);
      let expectedRank = 1;
      if (
        prefix.some((row, index) => {
          if (!index || row.race.time !== prefix[index - 1].race.time)
            expectedRank = index + 1;
          return row.rank !== expectedRank;
        })
      )
        return [];
      const time = prefix[milestone - 1].race.time;
      return time < race.time
        ? [
            target(
              `board:${milestone}`,
              "board",
              milestone === 1
                ? "Tie the team record"
                : `All-time top ${milestone}`,
              time,
              race.time,
            ),
          ]
        : [];
    })
    .sort((a, b) => a.drop - b.drop);
}

/** Match the nearest faster swimmer. Rows must include the immediately preceding
 * ranking row when the athlete is outside the loaded top-board prefix. */
export function closestMove(
  event: MyTimesEvent,
  rows: GoalRankingRow[],
): GoalMove | null {
  const race = event.race;
  const currentRank = event.allTimeRank;
  if (!race || !eligible(race) || !currentRank || currentRank <= 1) return null;
  const faster = opponents(event, rows)
    .filter(
      (row) =>
        row.race.time < race.time && row.rank != null && row.rank < currentRank,
    )
    .at(-1);
  if (!faster?.rank) return null;
  const time = faster.race.time;
  const drop = race.time - time;
  return {
    event: event.event,
    race,
    currentRank,
    targetRank: faster.rank,
    time,
    drop,
    percent: (drop / race.time) * 100,
  };
}

/** Compare standardized performance, never raw times across different events. */
export function strongEvents(
  events: MyTimesEvent[],
  sets: StandardSet[],
  age: number | null,
  day: string,
): MyTimesEvent[] {
  const standard = motivationalSet(sets, day);
  function strength(event: MyTimesEvent) {
    const elite =
      standard && event.race
        ? eventCuts(standard, event.race, age).find(
            (cut) => cut.tierName === "AAAA",
          )
        : undefined;
    return elite && event.race ? event.race.time / elite.timeMs : null;
  }
  return events
    .filter((event) => event.race && eligible(event.race))
    .sort((a, b) => {
      const aStandard = strength(a),
        bStandard = strength(b);
      if (aStandard != null && bStandard != null)
        return aStandard - bStandard || a.event.localeCompare(b.event);
      if (aStandard != null || bStandard != null)
        return aStandard != null ? -1 : 1;
      const percentile = (event: MyTimesEvent) =>
        event.allTimeRank != null && event.allTimeCount > 0
          ? (event.allTimeRank - 1) / event.allTimeCount
          : Infinity;
      return percentile(a) - percentile(b) || a.event.localeCompare(b.event);
    });
}

/** Suggestions mean no published eligible swim in this course, not lifetime proof. */
export function untriedEvents(
  events: MyTimesEvent[],
  course: string,
  age: number | null,
  strong: MyTimesEvent[],
): UntriedEvent[] {
  if (!["SCY", "LCM", "SCM"].includes(course)) return [];
  const recorded = new Set(
    events.filter((event) => event.race).map((event) => event.event),
  );
  const strengths = strong.filter(
    (event) => event.race && eligible(event.race),
  );
  return timesEvents(course, false)
    .filter(
      (event) =>
        !recorded.has(event) &&
        !(age != null && age > 10 && event.startsWith("25_")),
    )
    .map((event) => {
      const [distance, stroke] = event.split("_");
      const sameStroke = strengths.filter(
        (item) => item.event.split("_")[1] === stroke,
      );
      const nearest = sameStroke.toSorted(
        (a, b) =>
          Math.abs(Math.log(Number(a.event.split("_")[0]) / +distance)) -
          Math.abs(Math.log(Number(b.event.split("_")[0]) / +distance)),
      )[0];
      if (nearest) {
        const distanceChange = Math.abs(
          Math.log(Number(nearest.event.split("_")[0]) / +distance),
        );
        return {
          event,
          reason: `Build on ${eventLabel(nearest.event)} with another ${stroke === "IM" ? "medley" : "distance in the same stroke"}.`,
          priority:
            strengths.indexOf(nearest) * 0.5 +
            distanceChange +
            // Favor a neighboring distance before a large distance jump.
            (distanceChange > Math.log(2) + 0.01 ? 1 : 0),
        };
      }
      const strokes = new Set(
        strengths
          .map((item) => item.event.split("_")[1])
          .filter((code) => ["BK", "BR", "FL", "FR"].includes(code)),
      );
      if (stroke === "IM" && strokes.size >= 3)
        return {
          event,
          reason:
            "Bring experience in several strokes together in an individual medley.",
          priority:
            1.5 +
            Math.abs(Math.log(+distance / (course === "LCM" ? 200 : 100))),
        };
      return {
        event,
        reason: `Explore ${eventLabel(event)} and establish a first recorded ${course} time.`,
        priority: 20 + +distance / 1000,
      };
    })
    .sort((a, b) => a.priority - b.priority || a.event.localeCompare(b.event))
    .map(({ event, reason }) => ({ event, reason }));
}
