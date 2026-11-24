import { describe, expect, it } from "vitest";
import { countColors, planAwards } from "@/components/layout-drafting/awards";
import type {
  DraftingAchievement,
  DraftingAthlete,
} from "@/lib/layout-drafting/types";

function achievement(
  overrides: Partial<DraftingAchievement> = {},
): DraftingAchievement {
  return {
    event: "100_FR",
    course: "SCY",
    ageGroup: "11-12",
    tier: "A",
    ...overrides,
  };
}

function athlete(
  achievements: DraftingAchievement[],
  overrides: Partial<DraftingAthlete> = {},
): DraftingAthlete {
  return {
    id: "linked:avery",
    athleteId: "avery",
    name: "Avery Example",
    trainingGroups: ["Juniors"],
    achievements,
    ...overrides,
  };
}

describe("layout drafting award policies", () => {
  it("keeps event, course, and age-group achievements distinct in age-best", () => {
    const source = [
      athlete([
        achievement({ tier: "B" }),
        achievement({ tier: "A" }),
        achievement({ event: "200_FR", tier: "BB" }),
        achievement({ course: "LCM", tier: "AA" }),
        achievement({ course: "SCM", tier: "AAA" }),
        achievement({ ageGroup: "13-14", tier: "BB" }),
      ]),
    ];
    const [plan] = planAwards(source, "age-best", "all");
    expect(plan.dice).toHaveLength(5);
    expect(plan.dice).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "100_FR",
          course: "SCY",
          ageGroup: "11-12",
          tier: "A",
        }),
        expect.objectContaining({
          event: "200_FR",
          course: "SCY",
          ageGroup: "11-12",
          tier: "BB",
        }),
        expect.objectContaining({
          event: "100_FR",
          course: "LCM",
          ageGroup: "11-12",
          tier: "AA",
        }),
        expect.objectContaining({
          event: "100_FR",
          course: "SCM",
          ageGroup: "11-12",
          tier: "AAA",
        }),
        expect.objectContaining({
          event: "100_FR",
          course: "SCY",
          ageGroup: "13-14",
          tier: "BB",
        }),
      ]),
    );
  });

  it("awards each satisfied color once per bucket instead of once per qualifying swim", () => {
    const source = [
      athlete([
        achievement({ tier: "B" }),
        achievement({ tier: "BB" }),
        achievement({ tier: "A" }),
        achievement({ tier: "A" }),
        achievement({ ageGroup: "13-14", tier: "BB" }),
      ]),
    ];
    const [plan] = planAwards(source, "age-series", "all");
    expect(plan.dice).toHaveLength(5);
    expect(
      plan.dice
        .filter((die) => die.ageGroup === "11-12")
        .map((die) => die.tier),
    ).toEqual(["B", "BB", "A"]);
    expect(
      plan.dice
        .filter((die) => die.ageGroup === "13-14")
        .map((die) => die.tier),
    ).toEqual(["B", "BB"]);
    expect(new Set(plan.dice.map((die) => die.id)).size).toBe(5);
    expect(countColors([plan]).map(({ tier, count }) => [tier, count])).toEqual(
      [
        ["B", 2],
        ["BB", 2],
        ["A", 1],
        ["AA", 0],
        ["AAA", 0],
        ["AAAA", 0],
      ],
    );
  });

  it("career highest preserves courses and events while collapsing only age groups", () => {
    const [plan] = planAwards(
      [
        athlete([
          achievement({ ageGroup: "10&U", tier: "AAA" }),
          achievement({ ageGroup: "11-12", tier: "AA" }),
          achievement({ ageGroup: "13-14", tier: "A" }),
          achievement({ course: "LCM", tier: "BB" }),
          achievement({ event: "100_BK", tier: "B" }),
        ]),
      ],
      "lifetime-best",
      "all",
    );
    expect(plan.dice).toHaveLength(3);
    expect(plan.dice).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "100_FR",
          course: "SCY",
          ageGroup: "10&U",
          tier: "AAA",
        }),
        expect.objectContaining({ event: "100_FR", course: "LCM", tier: "BB" }),
        expect.objectContaining({ event: "100_BK", course: "SCY", tier: "B" }),
      ]),
    );
  });

  it.each(["age-best", "age-series", "lifetime-best"] as const)(
    "SCY-only excludes meter courses under %s",
    (rule) => {
      const [plan] = planAwards(
        [
          athlete([
            achievement({ tier: "A" }),
            achievement({ course: "SCM", tier: "AAAA" }),
            achievement({ course: "LCM", tier: "AAAA" }),
          ]),
        ],
        rule,
        "SCY",
      );
      expect(plan.dice).toHaveLength(rule === "age-series" ? 3 : 1);
      expect(plan.dice.every((die) => die.course === "SCY")).toBe(true);
    },
  );

  it("retains linked and unlinked zero-achievement roster names without inventing dice", () => {
    const source = [
      athlete([]),
      athlete([], { id: "unlinked:b", athleteId: null, name: "Blake Example" }),
      athlete([achievement({ course: "LCM" })], {
        id: "linked:c",
        athleteId: "c",
        name: "Casey Example",
      }),
    ];
    const before = structuredClone(source);
    const plans = planAwards(source, "age-best", "SCY");
    expect(plans.map(({ id, name, dice }) => ({ id, name, dice }))).toEqual(
      source.map(({ id, name }) => ({ id, name, dice: [] })),
    );
    expect(source).toEqual(before);
    expect(countColors(plans).every(({ count }) => count === 0)).toBe(true);
  });

  it("does not merge different athletes with the same name and generates stable unique dice ids", () => {
    const source = [
      athlete([achievement()]),
      athlete([achievement()], { id: "linked:other", athleteId: "other" }),
    ];
    const plans = planAwards(source, "age-series", "all");
    expect(plans).toHaveLength(2);
    const ids = plans.flatMap(({ dice }) => dice.map(({ id }) => id));
    expect(new Set(ids).size).toBe(6);
    expect(planAwards(source, "age-series", "all")).toEqual(plans);
  });
});
