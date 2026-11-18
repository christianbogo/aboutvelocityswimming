import { describe, expect, it } from "vitest";
import {
  buildTeamMap,
  type TeamMapInput,
} from "@/components/collection/team-map-data";
import { motivationalRankForRace } from "@/components/collection/motivational-ranks";
import type { Race } from "@/components/collection/times-data";
import type { StandardSet } from "@/features/swim-resources/types/schema";

let nextId = 0;
function race(extra: Partial<Race> = {}): Race {
  return {
    id: `race-${++nextId}`,
    athleteId: "a",
    date: "2026-03-01",
    event: "100_FR",
    course: "SCY",
    time: 55000,
    status: "OK",
    round: "F",
    team: "velocity-swimming",
    gender: "F",
    ageAtSwim: 13,
    official: true,
    relay: false,
    meetId: "meet",
    meet: "Meet",
    ...extra,
  };
}

function standard(extra: Partial<StandardSet> = {}): StandardSet {
  const cutsByTier = ["B", "BB", "A", "AA", "AAA", "AAAA"].map(
    (tierName, index) => ({
      tierName,
      timeMs: [70000, 60000, 55000, 50000, 45000, 40000][index],
      timeDisplay: "",
    }),
  );
  const events = [
    "50_FR",
    "100_FR",
    "200_FR",
    "500_FR",
    "100_BK",
    "100_BR",
    "100_FL",
    "200_IM",
  ];
  return {
    id: "standard",
    name: "USA Swimming Motivational",
    governingBody: "USA_Swimming",
    category: "motivational",
    standardType: "age-group",
    seasonYears: "2024–2028",
    effectiveDate: "2024-01-01",
    expirationDate: "2028-12-31",
    cuts: Object.fromEntries(
      ["SCY", "LCM", "SCM"].map((course) => [
        course,
        {
          F: Object.fromEntries(
            ["10&U", "11-12", "13-14", "15-16", "17-18"].map((age) => [
              age,
              Object.fromEntries(
                events.map((event) => [`${event}_${course}`, { cutsByTier }]),
              ),
            ]),
          ),
        },
      ]),
    ),
    ...extra,
  };
}

function snapshot(extra: Partial<TeamMapInput> = {}) {
  return buildTeamMap({
    roster: [{ athleteId: "a", name: "Avery", trainingGroup: "Senior" }],
    races: [],
    standards: [standard()],
    year: 2026,
    course: "",
    asOf: "2026-11-18",
    ...extra,
  });
}

describe("current roster contribution inventory", () => {
  it("adds four age11–12 Golds and three age13–14 Golds without counting repeat swims", () => {
    const old = ["100_FR", "200_FR", "100_BK", "100_BR"].map((event) =>
      race({ event, ageAtSwim: 12, date: "2025-02-01" }),
    );
    const current = ["100_FR", "200_FR", "100_BK"].map((event) =>
      race({ event }),
    );
    const repeated = race({ event: "100_FR", time: 54000 });
    const result = snapshot({
      races: [...old, ...current, repeated, repeated],
    });
    expect(result.totalContributions).toBe(7);
    expect(result.rankCounts.A).toBe(7);
    expect(result.leaders[0]).toMatchObject({
      athleteId: "a",
      total: 7,
      counts: { A: 7 },
    });
    expect(
      result.ageGroups.map((group) => [
        group.ageGroup,
        group.total,
        group.counts.A,
      ]),
    ).toEqual([
      ["11-12", 4, 4],
      ["13-14", 3, 3],
    ]);
    expect(result.coverage.validSwims).toBe(8);
  });

  it("deduplicates linked athletes, merges training groups, and excludes people outside the current linked roster", () => {
    const result = snapshot({
      roster: [
        { athleteId: "a", name: "Avery", trainingGroup: "Senior" },
        {
          athleteId: "a",
          name: "Duplicate roster name",
          trainingGroup: "Gold",
        },
        { athleteId: "b", name: "Blake", trainingGroup: "" },
        { athleteId: null, name: "Unlinked", trainingGroup: "Novice" },
      ],
      races: [race(), race({ athleteId: "outsider", time: 40000 })],
    });
    expect(result.coverage).toMatchObject({
      rosterEntries: 4,
      linkedAthletes: 2,
      duplicateLinks: 1,
      unlinkedEntries: 1,
      athletesWithSwims: 1,
      validSwims: 1,
    });
    expect(result.leaders).toHaveLength(1);
    expect(result.leaders[0].name).toBe("Avery");
    expect(result.leaders[0].trainingGroups).toEqual(["Gold", "Senior"]);
  });

  it("retains only the highest tier per event/course/gender/USA age band", () => {
    const result = snapshot({
      races: [
        race({ ageAtSwim: 9, time: 60000 }),
        race({ ageAtSwim: 10, time: 55000 }),
        race({ ageAtSwim: 10, time: 50000 }),
        race({ ageAtSwim: 10, time: 50000, course: "LCM" }),
      ],
    });
    expect(result.totalContributions).toBe(2);
    expect(result.rankCounts).toEqual({
      B: 0,
      BB: 0,
      A: 0,
      AA: 2,
      AAA: 0,
      AAAA: 0,
    });
    expect(result.ageGroups[0].ageGroup).toBe("10&U");
    expect(
      snapshot({ course: "SCY", races: [race(), race({ course: "LCM" })] })
        .totalContributions,
    ).toBe(1);
  });

  it("keeps contributions and activity scoped to Velocity even for a linked athlete", () => {
    const result = snapshot({
      races: [race(), race({ team: "another-club", time: 40000 })],
    });
    expect(result.coverage.validSwims).toBe(1);
    expect(result.activity.swims).toBe(1);
    expect(result.rankCounts.A).toBe(1);
    expect(result.rankCounts.AAAA).toBe(0);
  });

  it("preserves an earned historical rank even when a later faster PB earns a lower tier", () => {
    const old = standard({
      id: "old",
      effectiveDate: "2020-01-01",
      expirationDate: "2024-12-31",
    });
    old.cuts.SCY!.F!["13-14"]!["100_FR_SCY"].cutsByTier = [
      { tierName: "B", timeMs: 80000, timeDisplay: "" },
      { tierName: "BB", timeMs: 70000, timeDisplay: "" },
      { tierName: "A", timeMs: 60000, timeDisplay: "" },
    ];
    const newer = standard({ id: "new", effectiveDate: "2025-01-01" });
    const result = snapshot({
      standards: [old, newer],
      races: [race({ time: 60000, date: "2024-06-01" }), race({ time: 58000 })],
    });
    expect(result.rankCounts.A).toBe(1);
    expect(result.rankCounts.BB).toBe(0);
    expect(result.activity.rankUpgrades).toBe(0);
    expect(result.activity.improvedEvents).toBe(1);
  });

  it("matches shared rank-chip rules for overlapping editions and exact threshold ties", () => {
    const newer = standard({ id: "newer", effectiveDate: "2026-01-01" });
    const earlier = standard();
    earlier.cuts.SCY!.F!["13-14"]!["100_FR_SCY"].cutsByTier = [
      { tierName: "AAAA", timeMs: 60000, timeDisplay: "" },
    ];
    const sets = [newer, earlier];
    for (const time of [70001, 70000, 60000, 55000, 40000]) {
      const swim = race({ time });
      const expected = motivationalRankForRace(swim, sets)?.rank.tier;
      const result = snapshot({ standards: sets, races: [swim] });
      expect(result.totalContributions).toBe(expected ? 1 : 0);
      if (expected) expect(result.rankCounts[expected]).toBe(1);
    }
  });

  it("excludes disqualifications, flagged/ineligible swims, relays, arbitrary splits, and future results", () => {
    const changes: Partial<Race>[] = [
      { status: "DQ" },
      { time: 0 },
      { time: Number.NaN },
      { moderationStatus: "flagged" },
      { calculationEligible: false },
      { relay: true },
      { relayLeg: 2 },
      { split: true },
      { date: "2026-11-19" },
      { date: "2026-02-30" },
      { course: "UNKNOWN" },
    ];
    const result = snapshot({
      races: [
        ...changes.map((change) => race(change)),
        race({ split: true, resultOrigin: "relay_leadoff" }),
      ],
    });
    expect(result.coverage.validSwims).toBe(1);
    expect(result.totalContributions).toBe(1);
  });

  it("reports below-B times and missing age/edition as unassigned without inferring ranks", () => {
    const result = snapshot({
      races: [
        race({ ageAtSwim: null }),
        race({ ageAtSwim: 12.5 }),
        race({ ageAtSwim: 121 }),
        race({ time: 70001 }),
        race({ date: "2010-01-01" }),
        race(),
      ],
    });
    expect(result.coverage).toMatchObject({
      validSwims: 6,
      ungradedSwims: 5,
      missingAgeSwims: 3,
    });
    expect(result.rankCounts.A).toBe(1);
  });

  it("ignores championship, single-age, para, wrong-body and malformed standards", () => {
    const result = snapshot({
      standards: [
        standard({ category: "championship" }),
        standard({ standardType: "single-age" }),
        standard({ standardType: "para" }),
        standard({ governingBody: "LSC" }),
        standard({ name: "Open Water Motivational" }),
        standard({ effectiveDate: "2026-02-30" }),
      ],
      races: [race()],
    });
    expect(result.totalContributions).toBe(0);
    expect(result.coverage.ungradedSwims).toBe(1);
  });
});

describe("calendar year current-roster activity", () => {
  it("compares with pre-year ranks and counts genuine PB improvement, not repeated qualifiers", () => {
    const result = snapshot({
      races: [
        race({ date: "2025-12-31", time: 65000 }),
        race({ date: "2026-01-01", time: 58000 }),
        race({ date: "2026-02-01", time: 56000 }),
        race({
          date: "2026-03-01",
          event: "100_BK",
          time: 55000,
          meetId: "second",
        }),
        race({ date: "2026-02-01", event: "100_BR", time: 65000 }),
        race({ date: "2026-04-01", event: "100_BR", time: 55000 }),
        race({ date: "2026-12-01", time: 40000 }),
      ],
    });
    expect(result.activity).toMatchObject({
      swims: 5,
      swimmers: 1,
      meets: 2,
      improvedEvents: 2,
      newRankedEvents: 2,
      rankUpgrades: 1,
    });
    expect(result.activity.months).toHaveLength(12);
    expect(result.activity.months[1]).toEqual({
      month: "2026-02",
      swims: 2,
      swimmers: 1,
    });
    expect(result.activity.months[11]).toEqual({
      month: "2026-12",
      swims: 0,
      swimmers: 0,
    });
    expect(
      result.activity.recent.map((item) => [item.event, item.kind, item.tier]),
    ).toEqual([
      ["100_BR", "first", "A"],
      ["100_BK", "first", "A"],
      ["100_FR", "upgrade", "BB"],
    ]);
  });

  it("does not call a first-ever swim or ambiguous same-day sequence a PB improvement", () => {
    expect(snapshot({ races: [race()] }).activity.improvedEvents).toBe(0);
    expect(
      snapshot({ races: [race({ time: 60000 }), race({ time: 50000 })] })
        .activity.improvedEvents,
    ).toBe(0);
    expect(
      snapshot({
        races: [
          race({ date: "2026-03-02", time: 50000 }),
          race({ date: "2026-03-01", time: 60000 }),
        ],
      }).activity.improvedEvents,
    ).toBe(1);
  });

  it("keeps lifetime inventory independent of the selected activity year and allows empty linked coverage", () => {
    const swims = [
      race({ date: "2025-01-01" }),
      race({ date: "2026-01-01", event: "100_BK" }),
    ];
    const result = snapshot({ year: 2025, races: swims });
    expect(result.totalContributions).toBe(2);
    expect(result.activity.swims).toBe(1);
    expect(result.activity.newRankedEvents).toBe(1);
    const empty = snapshot({
      roster: [{ athleteId: null, name: "Not linked", trainingGroup: "" }],
      races: swims,
    });
    expect(empty.coverage).toMatchObject({
      rosterEntries: 1,
      linkedAthletes: 0,
      unlinkedEntries: 1,
      validSwims: 0,
    });
    expect(empty.leaders).toEqual([]);
    expect(empty.totalContributions).toBe(0);
  });

  it("rejects invalid selection metadata", () => {
    for (const change of [
      { course: "bogus" },
      { year: 1800 },
      { year: 2026.5 },
      { asOf: "2026-02-30" },
    ])
      expect(() => snapshot(change)).toThrow("Invalid Team Map selection");
  });
});
