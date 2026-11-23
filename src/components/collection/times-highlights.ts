import type { StandardSet } from "@/features/swim-resources/types/schema";
import { compareEvents } from "./event-layout";
import {
  motivationalRankForRace,
  motivationalRanks,
} from "./motivational-ranks";
import type { MyTimesEvent } from "./times-api";
import type { Race } from "./times-data";

export type TimesHighlight = {
  event: MyTimesEvent & { race: Race };
  rank: ReturnType<typeof motivationalRankForRace>;
  /** Fraction faster than the achieved standard; null without a standard. */
  margin: number | null;
};

function eligibleBest(
  event: MyTimesEvent,
): event is MyTimesEvent & { race: Race } {
  const race = event.race;
  return Boolean(
    race &&
    race.status === "OK" &&
    Number.isFinite(race.time) &&
    race.time > 0 &&
    race.moderationStatus !== "flagged" &&
    race.calculationEligible !== false &&
    !race.relay &&
    (!race.split || race.resultOrigin === "relay_leadoff") &&
    /^\d{4}-\d{2}-\d{2}$/.test(race.date.slice(0, 10)),
  );
}

function tierIndex(highlight: TimesHighlight) {
  return motivationalRanks.findIndex(
    (rank) => rank.tier === highlight.rank?.rank.tier,
  );
}

function teamRank(highlight: TimesHighlight) {
  const rank = highlight.event.allTimeRank;
  return rank !== null && Number.isSafeInteger(rank) && rank > 0
    ? rank
    : Infinity;
}

/** Compare achievement across events without comparing their raw swim times. */
export function rankHighlights(
  events: MyTimesEvent[],
  sets: StandardSet[],
): TimesHighlight[] {
  return events
    .filter(eligibleBest)
    .map((event) => {
      const rank = motivationalRankForRace(event.race, sets);
      return {
        event,
        rank,
        margin: rank ? (rank.cut.time - event.race.time) / rank.cut.time : null,
      };
    })
    .sort(
      (a, b) =>
        tierIndex(b) - tierIndex(a) ||
        (b.margin ?? 0) - (a.margin ?? 0) ||
        teamRank(a) - teamRank(b) ||
        compareEvents(a.event.event, b.event.event),
    );
}
