import { describe, expect, it } from "vitest";
import type { StandardSet } from "@/features/swim-resources/types/schema";
import type { MyTimesEvent } from "@/components/collection/times-api";
import type { Race } from "@/components/collection/times-data";
import {
  boardGoals,
  closestMove,
  goalAgeGroup,
  standardGoals,
  strongEvents,
  untriedEvents,
} from "@/components/collection/goals-data";

const day = "2026-11-18";
function race(time = 60000, extra: Partial<Race> = {}): Race {
  return {
    id: "swim",
    athleteId: "athlete",
    event: "100_FR",
    course: "SCY",
    time,
    status: "OK",
    round: "F",
    gender: "F",
    ageAtSwim: 12,
    team: "velocity-swimming",
    date: "2026-11-01",
    official: true,
    relay: false,
    meet: "Meet",
    meetId: "meet",
    ...extra,
  };
}
function event(time = 60000, extra: Partial<MyTimesEvent> = {}): MyTimesEvent {
  return {
    event: "100_FR",
    race: race(time),
    rankRace: race(time),
    allTimeRank: 30,
    allTimeCount: 50,
    rankAgeGroup: "11-12",
    rankGender: "F",
    ...extra,
  };
}
function standard(extra: Partial<StandardSet> = {}): StandardSet {
  return {
    id: "motivational",
    name: "USA Swimming Motivational",
    category: "motivational",
    governingBody: "USA_Swimming",
    standardType: "age-group",
    seasonYears: "2024–2028",
    effectiveDate: "2024-09-01",
    expirationDate: "2028-08-31",
    sourceUrl: "https://example.test/standard.pdf",
    cuts: {
      SCY: {
        F: {
          "11-12": {
            "100_FR_SCY": {
              cutsByTier: [
                { tierName: "B", timeMs: 70000, timeDisplay: "1:10.00" },
                { tierName: "BB", timeMs: 60000, timeDisplay: "1:00.00" },
                { tierName: "A", timeMs: 55000, timeDisplay: "55.00" },
                { tierName: "AAAA", timeMs: 50000, timeDisplay: "50.00" },
              ],
            },
          },
        },
      },
    },
    ...extra,
  };
}
function board(times: number[]) {
  return times.map((time, index) => ({
    race: race(time, { id: `r${index}`, athleteId: `a${index}` }),
    rank: times.indexOf(time) + 1,
  }));
}

describe("goal standards", () => {
  it("uses the next unmet current USA tier, treating exact ties as achieved", () => {
    expect(standardGoals(race(), [standard()], 12, day)).toEqual([
      {
        id: "motivational:11-12:A",
        kind: "motivational",
        label: "USA Swimming A",
        time: 55000,
        drop: 5000,
        percent: (5000 / 60000) * 100,
        sourceUrl: "https://example.test/standard.pdf",
        season: "2024–2028",
      },
    ]);
    expect(standardGoals(race(50000), [standard()], 12, day)).toEqual([]);
    expect(standardGoals(race(), [standard()], 13, day)).toEqual([]);
    expect(standardGoals(race(), [standard()], null, day)).toEqual([]);
    expect(
      standardGoals(race(60000, { course: "LCM" }), [standard()], 12, day),
    ).toEqual([]);
  });

  it("rejects unavailable editions, wrong-body motivation, and ineligible results", () => {
    const editions = [
      standard({ effectiveDate: "2027-01-01" }),
      standard({ expirationDate: "2026-11-17" }),
      standard({ standardType: "para" }),
      standard({ standardType: "single-age" }),
      standard({ governingBody: "LSC" }),
    ];
    expect(standardGoals(race(), editions, 12, day)).toEqual([]);
    for (const change of [
      { status: "DQ" },
      { time: Number.NaN },
      { time: -1 },
      { time: 0 },
      { moderationStatus: "flagged" as const },
      { calculationEligible: false },
      { relay: true },
      { split: true },
    ])
      expect(standardGoals(race(60000, change), [standard()], 12, day)).toEqual(
        [],
      );
    expect(
      standardGoals(
        race(60000, { split: true, resultOrigin: "relay_leadoff" }),
        [standard()],
        12,
        day,
      ),
    ).toHaveLength(1);
    expect(standardGoals(race(), [standard()], 12, "not-a-date")).toEqual([]);
  });

  it("uses the latest effective motivational edition and keeps championship sources", () => {
    const championship = standard({
      id: "sectionals",
      name: "Sectionals",
      governingBody: "LSC",
      category: "championship",
      cuts: {
        SCY: {
          F: {
            Open: {
              "100_FR_SCY": {
                cutsByTier: [
                  { tierName: "Bonus", timeMs: 59000, timeDisplay: "59.00" },
                  {
                    tierName: "Qualifying",
                    timeMs: 56000,
                    timeDisplay: "56.00",
                  },
                  { tierName: "Other", timeMs: Number.NaN, timeDisplay: "" },
                ],
              },
            },
          },
        },
      },
    });
    const next = standard({ id: "new", effectiveDate: "2026-01-01" });
    const goals = standardGoals(
      race(),
      [standard(), next, championship],
      12,
      day,
    );
    expect(goals.map((goal) => [goal.id, goal.time])).toEqual([
      ["sectionals:Open:Qualifying", 56000],
      ["new:11-12:A", 55000],
    ]);
    expect(goals[0]).toMatchObject({
      kind: "championship",
      label: "Sectionals",
      sourceUrl: championship.sourceUrl,
    });
    expect(standardGoals(race(), [championship], null, day)).toHaveLength(1);
    expect(
      standardGoals(
        race(),
        [
          { ...championship, name: "Open Water Championships" },
          { ...championship, name: "Swimmers with Disabilities" },
        ],
        12,
        day,
      ),
    ).toEqual([]);
    expect(
      standardGoals(
        race(),
        [{ ...championship, sourceUrl: "javascript:alert(1)" }],
        12,
        day,
      )[0].sourceUrl,
    ).toBeUndefined();
  });

  it("matches bounded and single-age championship categories without guessing unknown ages", () => {
    const championship = standard({
      category: "championship",
      cuts: {
        SCY: {
          F: Object.fromEntries(
            ["10&U", "11–12", "13&O", "12"].map((age) => [
              age,
              {
                "100_FR_SCY": {
                  cutsByTier: [
                    {
                      tierName: "Qualifying",
                      timeMs: 55000,
                      timeDisplay: "55.00",
                    },
                  ],
                },
              },
            ]),
          ),
        },
      },
    });
    for (const age of [10, 11, 12, 13, 99])
      expect(standardGoals(race(), [championship], age, day)).toHaveLength(1);
    expect(standardGoals(race(), [championship], null, day)).toEqual([]);
  });
});

describe("team-board goals", () => {
  it("calculates unmet top-25/10/5/1 thresholds and tie targets", () => {
    const rows = board(Array.from({ length: 29 }, (_, i) => 30000 + i * 1000));
    const goals = boardGoals(event(), rows);
    expect(goals.map((goal) => [goal.label, goal.time])).toEqual([
      ["All-time top 25", 54000],
      ["All-time top 10", 39000],
      ["All-time top 5", 34000],
      ["Tie the team record", 30000],
    ]);
    expect(
      boardGoals(event(35000, { allTimeRank: 5 }), rows).map((goal) => goal.id),
    ).toEqual(["board:1"]);
    expect(boardGoals(event(30000, { allTimeRank: 1 }), rows)).toEqual([]);
    expect(boardGoals(event(), rows.slice(20))).toEqual([]);
  });

  it("handles competition ties, excludes own rows, and requires complete cutoff evidence", () => {
    const rows = board([30000, 31000, 31000, 31000, 35000]);
    expect(
      boardGoals(event(36000, { allTimeRank: 6 }), rows).map((goal) => [
        goal.id,
        goal.time,
      ]),
    ).toEqual([
      ["board:5", 35000],
      ["board:1", 30000],
    ]);
    expect(
      boardGoals(
        event(36000, { allTimeRank: 6 }),
        rows.filter((_, i) => i !== 1),
      ).map((goal) => goal.id),
    ).toEqual(["board:1"]);
    expect(
      boardGoals(
        event(36000, { allTimeRank: 6 }),
        rows.map((row) => ({
          ...row,
          race: { ...row.race, athleteId: "athlete" },
        })),
      ),
    ).toEqual([]);
    expect(
      boardGoals(
        event(),
        rows.map((row) => ({ ...row, race: { ...row.race, ageAtSwim: 13 } })),
      ),
    ).toEqual([]);
    expect(
      boardGoals(
        event(),
        rows.map((row) => ({ ...row, race: { ...row.race, course: "LCM" } })),
      ),
    ).toEqual([]);
  });

  it("finds the closest faster time across tied ranks without overshooting by .01", () => {
    const rows = board([30000, 40000, 40000, 40010]);
    expect(closestMove(event(40020, { allTimeRank: 5 }), rows)).toMatchObject({
      currentRank: 5,
      targetRank: 4,
      time: 40010,
      drop: 10,
    });
    expect(closestMove(event(40010, { allTimeRank: 4 }), rows)).toMatchObject({
      targetRank: 2,
      time: 40000,
      drop: 10,
    });
    expect(closestMove(event(30000, { allTimeRank: 1 }), rows)).toBeNull();
    expect(closestMove(event(60000, { allTimeRank: null }), rows)).toBeNull();
    expect(closestMove(event(), [])).toBeNull();
  });
});

describe("event discovery", () => {
  it("orders strengths by relative AAAA performance rather than raw time", () => {
    const freestyle = event(60000);
    const back = event(50000, {
      event: "50_BK",
      race: race(50000, { event: "50_BK" }),
      allTimeRank: 2,
    });
    const set = standard();
    set.cuts.SCY!.F!["11-12"]!["50_BK_SCY"] = {
      cutsByTier: [{ tierName: "AAAA", timeMs: 30000, timeDisplay: "30.00" }],
    };
    expect(
      strongEvents([back, freestyle], [set], 12, day).map((item) => item.event),
    ).toEqual(["100_FR", "50_BK"]);
    expect(
      strongEvents([back, freestyle], [], 12, day).map((item) => item.event),
    ).toEqual(["50_BK", "100_FR"]);
  });

  it("suggests only course-catalog events without a recorded race and explains the connection", () => {
    const swum = event(60000);
    const empty = event(60000, { event: "200_FR", race: null, rankRace: null });
    const suggestions = untriedEvents([swum, empty], "SCY", 12, [swum]);
    expect(suggestions.some((item) => item.event === "100_FR")).toBe(false);
    expect(suggestions.some((item) => item.event.startsWith("25_"))).toBe(
      false,
    );
    expect(suggestions[0]).toMatchObject({ event: "200_FR" });
    expect(suggestions[0].reason).toContain("100 Freestyle");
    expect(suggestions.every((item) => !item.event.includes("-R"))).toBe(true);
    const lcm = untriedEvents([], "LCM", 12, []);
    expect(lcm.some((item) => item.event === "100_IM")).toBe(false);
    expect(lcm.some((item) => item.event === "400_FR")).toBe(true);
    expect(lcm.some((item) => item.event === "500_FR")).toBe(false);
    expect(
      untriedEvents([], "SCY", 8, []).some((item) => item.event === "25_FR"),
    ).toBe(true);
    expect(untriedEvents([], "bad-course", 12, [])).toEqual([]);
  });

  it("maps only valid known ages to the existing team cohorts", () => {
    expect([8, 9, 10, 11, 12, 18, 19].map(goalAgeGroup)).toEqual([
      "8&U",
      "9-10",
      "9-10",
      "11-12",
      "11-12",
      "17-18",
      "19&O",
    ]);
    for (const age of [null, -1, 12.5, Number.NaN, 121])
      expect(goalAgeGroup(age)).toBeNull();
  });

  it("prioritizes nearby distances and a balanced medley before large distance jumps", () => {
    const strengths = ["100_FR", "100_BK", "100_BR"].map((code) =>
      event(60000, { event: code, race: race(60000, { event: code }) }),
    );
    const suggestions = untriedEvents(strengths, "SCY", 13, strengths).map(
      (item) => item.event,
    );
    expect(suggestions.indexOf("200_BK")).toBeLessThan(
      suggestions.indexOf("1000_FR"),
    );
    expect(suggestions.indexOf("100_IM")).toBeLessThan(
      suggestions.indexOf("500_FR"),
    );
  });
});
