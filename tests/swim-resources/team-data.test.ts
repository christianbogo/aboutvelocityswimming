import { describe, expect, it } from "vitest";
import {
  bestRankRaces,
  competitiveProfile,
  buildTeamOverview,
  countRanks,
  rankChanges,
  rankTeamRoster,
  teamBests,
  type TeamData,
  type RankCounts,
} from "@/components/collection/team-data";
import {
  pointsForCounts,
  pointsForRank,
} from "@/components/collection/rank-points";
import type { Race } from "@/components/collection/times-data";
import type { StandardSet } from "@/features/swim-resources/types/schema";

const tiers = ["B", "BB", "A", "AA", "AAA", "AAAA"];
const sets: StandardSet[] = [
  {
    id: "standard",
    name: "Motivational",
    governingBody: "USA_Swimming",
    category: "motivational",
    standardType: "age-group",
    seasonYears: "2025–2028",
    effectiveDate: "2025-01-01",
    expirationDate: "2028-12-31",
    cuts: Object.fromEntries(
      ["SCY", "LCM"].map((course) => [
        course,
        {
          F: {
            "13-14": {
              [`100_FR_${course}`]: {
                cutsByTier: tiers.map((tierName, index) => ({
                  tierName,
                  timeMs: 100000 - index * 10000,
                  timeDisplay: "",
                })),
              },
            },
          },
        },
      ]),
    ),
  },
];
function swim(id: string, time: number, overrides: Partial<Race> = {}): Race {
  return {
    id,
    time,
    athleteId: "one",
    date: "2026-11-01",
    event: "100_FR",
    course: "SCY",
    status: "OK",
    round: "F",
    team: "velocity-swimming",
    gender: "F",
    ageAtSwim: 14,
    official: true,
    relay: false,
    meetId: "meet",
    meet: "Meet",
    ...overrides,
  };
}
describe("Team ranks", () => {
  it("counts one highest rank per best event/course, excluding ineligible results", () => {
    const races = [
      swim("one", 95000),
      swim("two", 85000),
      swim("long", 75000, { course: "LCM" }),
      swim("flag", 40000, { moderationStatus: "flagged" }),
      swim("dq", 40000, { status: "DQ" }),
      swim("relay", 40000, { relay: true }),
      swim("split", 40000, { split: true }),
      swim("excluded", 40000, { calculationEligible: false }),
    ];
    expect(countRanks(races, sets)).toEqual({
      B: 0,
      BB: 1,
      A: 1,
      AA: 0,
      AAA: 0,
      AAAA: 0,
    });
    expect(
      teamBests(races)
        .map((race) => race.id)
        .sort(),
    ).toEqual(["long", "two"]);
  });
  it("counts promotions without subtracting the old tier and counts multiple rounds once", () => {
    const before = [swim("old", 95000)];
    expect(
      rankChanges(before, [swim("prelim", 85000), swim("final", 75000)], sets),
    ).toEqual({ B: 0, BB: 0, A: 1, AA: 0, AAA: 0, AAAA: 0 });
    expect(
      rankChanges(
        before,
        [swim("slower", 99000), swim("dq", 1000, { status: "DQ" })],
        sets,
      ),
    ).toEqual({ B: 0, BB: 0, A: 0, AA: 0, AAA: 0, AAAA: 0 });
  });
  it("handles first swims, ties, and standards at the swim's age and date", () => {
    expect(rankChanges([], [swim("new", 65000)], sets).AA).toBe(1);
    expect(
      teamBests([
        swim("old", 65000),
        swim("new", 65000, { date: "2026-11-02" }),
      ])[0].id,
    ).toBe("new");
    expect(countRanks([swim("older", 65000, { ageAtSwim: 19 })], sets).AA).toBe(
      0,
    );
    expect(
      countRanks([swim("expired", 65000, { date: "2029-01-01" })], sets).AA,
    ).toBe(0);
  });
  it("keeps unlinked members, deduplicates links, and selects three leaders by rank counts", () => {
    const data: TeamData = {
      asOf: "2026-11-27",
      seasonStart: "2026-09-01",
      seasonSwims: [swim("season", 85000)],
      roster: [
        { id: "a", name: "A", group: "Prep", athleteId: "one" },
        { id: "duplicate", name: "Duplicate", group: "Prep", athleteId: "one" },
        { id: "unlinked", name: "Unlinked", group: "Prep", athleteId: null },
        ...["two", "three", "four"].map((id) => ({
          id,
          name: id,
          group: "Seniors",
          athleteId: id,
        })),
      ],
      bests: [
        swim("a", 95000),
        swim("b", 45000, { athleteId: "two" }),
        swim("c", 55000, { athleteId: "three" }),
        swim("d", 65000, { athleteId: "four" }),
      ],
      meets: [],
      meet: null,
      before: [],
      swims: [],
    };
    const result = buildTeamOverview(data, sets);
    expect(result.groups[0].roster).toHaveLength(3);
    expect(result.groups[0].counts.B).toBe(1);
    expect(result.groups[0].seasonCounts.BB).toBe(1);
    expect(result.leaders.map((leader) => leader.athleteId)).toEqual([
      "two",
      "three",
      "four",
    ]);
    expect(result.groups.map((group) => group.name)).toEqual([
      "Prep",
      "Age Groupers",
      "Juniors",
      "Seniors",
    ]);
  });
});

it("keeps additions that would cancel out in a net tier total", () => {
  const before = [swim("old-bronze", 95000)];
  const after = [
    swim("silver", 85000),
    swim("new-bronze", 95000, { course: "LCM" }),
  ];
  expect(rankChanges(before, after, sets)).toMatchObject({ B: 1, BB: 1 });
});
it("season achievements retain the best rank even if a faster swim earns a lower rank after aging up", () => {
  const seasonalSets = structuredClone(sets);
  seasonalSets[0].cuts.SCY!.F!["15-16"] = {
    "100_FR_SCY": {
      cutsByTier: [{ tierName: "B", timeMs: 60000, timeDisplay: "" }],
    },
  };
  const races = [
    swim("younger", 65000),
    swim("older", 59000, { ageAtSwim: 15 }),
  ];
  expect(countRanks(bestRankRaces(races, seasonalSets), seasonalSets).AA).toBe(
    1,
  );
  expect(countRanks(teamBests(races), seasonalSets).B).toBe(1);
});
it("scores profile bests at the assigned age and current edition, with unranked bests in the total", () => {
  const result = competitiveProfile(
    [
      swim("young", 85000, { ageAtSwim: 10, date: "2020-01-01" }),
      swim("slow", 110000, { course: "LCM" }),
    ],
    "Juniors",
    sets,
    "2026-11-27",
  );
  expect(result).toMatchObject({ counts: { BB: 1 }, total: 2, unranked: 1 });
});
it("uses the tougher senior cuts when no 15&O standard is published, preferring an explicit 15&O band", () => {
  const seniorSets = structuredClone(sets);
  seniorSets[0].cuts.SCY!.F = {
    "15-16": {
      "100_FR_SCY": {
        cutsByTier: [{ tierName: "B", timeMs: 80000, timeDisplay: "" }],
      },
    },
    "17-18": {
      "100_FR_SCY": {
        cutsByTier: [{ tierName: "B", timeMs: 70000, timeDisplay: "" }],
      },
    },
  };
  expect(
    competitiveProfile(
      [swim("senior", 75000)],
      "Seniors",
      seniorSets,
      "2026-11-27",
    ).unranked,
  ).toBe(1);
  seniorSets[0].cuts.SCY!.F!["15&O"] = seniorSets[0].cuts.SCY!.F!["15-16"];
  expect(
    competitiveProfile(
      [swim("senior", 75000)],
      "Seniors",
      seniorSets,
      "2026-11-27",
    ).counts.B,
  ).toBe(1);
});

it("uses the requested rank weights and gives unranked results zero points", () => {
  expect(tiers.map(pointsForRank)).toEqual([1, 2, 5, 10, 25, 50]);
  expect(pointsForCounts({ B: 1, BB: 1, A: 1, AA: 1, AAA: 1, AAAA: 1 })).toBe(
    93,
  );
  expect(pointsForRank(null)).toBe(0);
  expect(pointsForRank("unranked")).toBe(0);
  expect(pointsForCounts({})).toBe(0);
});
it("ranks a group's athletes by the selected view's points and shares places for ties", () => {
  const roster: {
    id: string;
    name: string;
    counts: RankCounts;
    seasonCounts: RankCounts;
  }[] = [
    {
      id: "elite",
      name: "Elite",
      counts: { AAAA: 1 },
      seasonCounts: { AAAA: 1 },
    },
    {
      id: "diamond",
      name: "Diamond",
      counts: { AAA: 3 },
      seasonCounts: { B: 1 },
    },
    { id: "tie", name: "Another", counts: { AAA: 3 }, seasonCounts: { B: 1 } },
    { id: "empty", name: "No results", counts: {}, seasonCounts: {} },
  ];
  expect(
    rankTeamRoster(roster, false).map(({ id, points, place }) => ({
      id,
      points,
      place,
    })),
  ).toEqual([
    { id: "tie", points: 75, place: 1 },
    { id: "diamond", points: 75, place: 1 },
    { id: "elite", points: 50, place: 3 },
    { id: "empty", points: 0, place: 4 },
  ]);
  expect(
    rankTeamRoster(roster, true).map(({ id, points, place }) => ({
      id,
      points,
      place,
    })),
  ).toEqual([
    { id: "elite", points: 50, place: 1 },
    { id: "tie", points: 1, place: 2 },
    { id: "diamond", points: 1, place: 2 },
    { id: "empty", points: 0, place: 4 },
  ]);
  expect(roster[0].id).toBe("elite");
});
