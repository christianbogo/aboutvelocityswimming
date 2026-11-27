import { describe, expect, it } from "vitest";
import {
  buildTeamOverview,
  countRanks,
  rankChanges,
  teamBests,
  type TeamData,
} from "@/components/collection/team-data";
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
  it("subtracts the old tier on promotion and counts multiple rounds once", () => {
    const before = [swim("old", 95000)];
    expect(
      rankChanges(before, [swim("prelim", 85000), swim("final", 75000)], sets),
    ).toEqual({ B: -1, BB: 0, A: 1, AA: 0, AAA: 0, AAAA: 0 });
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
