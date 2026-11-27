import { describe, expect, it } from "vitest";
import type { StandardSet } from "@/features/swim-resources/types/schema";
import type { MyTimesEvent } from "@/features/swimming/domain/times-query";
import type { Race } from "@/features/swimming/domain/times";
import { rankHighlights } from "@/components/collection/times-highlights";

const race: Race = {
  id: "race",
  athleteId: "athlete",
  date: "2026-05-10",
  event: "100_FR",
  course: "SCY",
  time: 55000,
  status: "OK",
  round: "F",
  team: "team",
  gender: "F",
  ageAtSwim: 14,
  official: true,
  relay: false,
  meetId: "meet",
  meet: "Meet",
};

function best(
  event: string,
  time: number,
  allTimeRank: number | null = null,
  overrides: Partial<Race> = {},
): MyTimesEvent {
  return {
    event,
    race: { ...race, id: event, event, time, ...overrides },
    rankRace: null,
    allTimeRank,
    allTimeCount: 20,
    rankAgeGroup: "13-14",
    rankGender: "F",
  };
}

const tiers = ["B", "BB", "A", "AA", "AAA", "AAAA"];
const standards: StandardSet = {
  id: "motivational",
  name: "USA Swimming Motivational Standards",
  governingBody: "USA_Swimming",
  category: "motivational",
  standardType: "age-group",
  seasonYears: "2025–2028",
  effectiveDate: "2025-01-01",
  expirationDate: "2028-12-31",
  cuts: {
    SCY: {
      F: {
        "13-14": Object.fromEntries(
          [
            ["50_FR_SCY", 0.5],
            ["100_FR_SCY", 1],
            ["200_FR_SCY", 2],
            ["100_BK_SCY", 1.2],
          ].map(([event, multiplier]) => [
            event,
            {
              cutsByTier: tiers.map((tierName, index) => ({
                tierName,
                timeMs: (100000 - index * 10000) * Number(multiplier),
                timeDisplay: "",
              })),
            },
          ]),
        ),
      },
    },
  },
};

describe("Times highlights", () => {
  it("orders by achieved standard before margin or team rank", () => {
    const highlights = rankHighlights(
      [
        best("50_FR", 35001, 1),
        best("100_FR", 60000, 10),
        best("200_FR", 100000, 20),
        best("100_BK", 66000, 5),
      ],
      [standards],
    );
    expect(highlights.map(({ event }) => event.event)).toEqual([
      "200_FR",
      "100_BK",
      "100_FR",
      "50_FR",
    ]);
    expect(highlights.map(({ rank }) => rank?.rank.tier)).toEqual([
      "AAAA",
      "AAA",
      "AAA",
      "A",
    ]);
    expect(highlights[1].margin).toBeCloseTo(1 / 12);
  });

  it("uses percentage below the standard across different event durations", () => {
    const highlights = rankHighlights(
      [best("200_FR", 116000, 1), best("50_FR", 28000, 20)],
      [standards],
    );
    // Both are AAA. Two seconds below 30s is stronger than four below 120s.
    expect(highlights.map(({ event }) => event.event)).toEqual([
      "50_FR",
      "200_FR",
    ]);
    expect(highlights[0].margin).toBeCloseTo(2 / 30);
    expect(highlights[1].margin).toBeCloseTo(4 / 120);
  });

  it("falls back to valid team ranks then stable event order without standards", () => {
    const highlights = rankHighlights(
      [
        best("200_FR", 50000, null),
        best("100_FR", 40000, 2),
        best("50_FR", 60000, 1),
        best("100_BK", 10000, 0),
        best("50_BK", 9000, NaN),
      ],
      [],
    );
    expect(highlights.map(({ event }) => event.event)).toEqual([
      "50_FR",
      "100_FR",
      "50_BK",
      "100_BK",
      "200_FR",
    ]);
    expect(
      highlights.every(({ rank, margin }) => !rank && margin === null),
    ).toBe(true);
  });

  it("uses team rank to break equal standards and relative margins", () => {
    const highlights = rankHighlights(
      [best("100_FR", 55000, 5), best("200_FR", 110000, 2)],
      [standards],
    );
    expect(highlights.map(({ event }) => event.event)).toEqual([
      "200_FR",
      "100_FR",
    ]);
  });

  it("excludes absent and ineligible bests while accepting relay leadoffs", () => {
    const ineligible: Partial<Race>[] = [
      { status: "DQ" },
      { time: 0 },
      { time: -1 },
      { time: NaN },
      { time: Infinity },
      { moderationStatus: "flagged" },
      { calculationEligible: false },
      { relay: true },
      { split: true },
      { date: "" },
    ];
    const leadoff = best("100_FR", 55000, 1, {
      split: true,
      resultOrigin: "relay_leadoff",
    });
    const events = [
      ...ineligible.map((change) => best("50_FR", 28000, 1, change)),
      { ...best("200_FR", 110000), race: null },
      leadoff,
    ];
    expect(
      rankHighlights(events, [standards]).map(({ event }) => event),
    ).toEqual([leadoff]);
  });

  it("uses the swim's age, gender, course and historical edition", () => {
    for (const change of [
      { ageAtSwim: null },
      { ageAtSwim: 15 },
      { gender: "M" },
      { course: "LCM" },
      { date: "2024-12-31" },
    ]) {
      const [highlight] = rankHighlights(
        [best("100_FR", 55000, 1, change)],
        [standards],
      );
      expect(highlight.rank).toBeNull();
      expect(highlight.margin).toBeNull();
    }
    const oldEdition = {
      ...standards,
      id: "previous",
      effectiveDate: "2021-01-01",
      expirationDate: "2024-12-31",
    };
    const [historical] = rankHighlights(
      [best("100_FR", 55000, 1, { date: "2024-12-31" })],
      [standards, oldEdition],
    );
    expect(historical.rank?.cut.id).toBe("previous:13-14");
  });

  it("does not mutate source arrays or results and handles an empty profile", () => {
    const events = [best("100_FR", 55000), best("200_FR", 100000)];
    const sets = [standards];
    const before = structuredClone({ events, sets });
    rankHighlights(events, sets);
    expect({ events, sets }).toEqual(before);
    expect(rankHighlights([], sets)).toEqual([]);
  });
});
