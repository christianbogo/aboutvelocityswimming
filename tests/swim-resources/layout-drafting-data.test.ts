import { describe, expect, it } from "vitest";
import type { Race } from "@/components/collection/times-data";
import type { StandardSet } from "@/features/swim-resources/types/schema";
import { buildDraftingSnapshot } from "@/lib/layout-drafting/data";

function standard(extra: Partial<StandardSet> = {}): StandardSet {
  return {
    id: "standard",
    name: "USA Swimming Motivational",
    governingBody: "USA_Swimming",
    category: "motivational",
    standardType: "age-group",
    seasonYears: "2024-2028",
    effectiveDate: "2024-09-01",
    expirationDate: "2028-08-31",
    cuts: Object.fromEntries(
      ["SCY", "LCM", "SCM"].map((course) => [
        course,
        {
          F: Object.fromEntries(
            ["10&U", "11-12", "13-14"].map((age) => [
              age,
              {
                [`100_FR_${course}`]: {
                  cutsByTier: ["B", "BB", "A", "AA", "AAA", "AAAA"].map(
                    (tierName, i) => ({
                      tierName,
                      timeMs: 70000 - i * 5000,
                      timeDisplay: "",
                    }),
                  ),
                },
              },
            ]),
          ),
        },
      ]),
    ),
    ...extra,
  };
}
function race(id: string, extra: Partial<Race> = {}): Race {
  return {
    id,
    athleteId: "a",
    date: "2026-03-01",
    event: "100_FR",
    course: "SCY",
    time: 60000,
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
function snapshot(races: Race[], standards = [standard()]) {
  return buildDraftingSnapshot({
    asOf: "2026-11-23",
    races,
    standards,
    roster: [
      { id: "r1", athleteId: "a", name: "Avery", trainingGroup: "Seniors" },
      { id: "r2", athleteId: "b", name: "Blake", trainingGroup: "Prep" },
      {
        id: "r3",
        athleteId: null,
        name: "Casey",
        trainingGroup: "Age Groupers",
      },
    ],
  });
}

describe("historical achievement inventory for physical drafting", () => {
  it("retains highest per event, course and age group; includes prior teams and no-result names", () => {
    const repeated = race("fast", { time: 50000 });
    const data = snapshot([
      race("first"),
      repeated,
      repeated,
      race("young", { ageAtSwim: 12, team: "another-club" }),
      race("long", { course: "LCM" }),
      race("outsider", { athleteId: "not-on-roster" }),
    ]);
    expect(data.athletes).toHaveLength(3);
    expect(data.athletes[0].achievements).toEqual([
      { event: "100_FR", course: "LCM", ageGroup: "13-14", tier: "A" },
      { event: "100_FR", course: "SCY", ageGroup: "11-12", tier: "A" },
      { event: "100_FR", course: "SCY", ageGroup: "13-14", tier: "AAA" },
    ]);
    expect(
      data.athletes.slice(1).every((athlete) => !athlete.achievements.length),
    ).toBe(true);
    expect(data.coverage.validSwims).toBe(4);
  });

  it("uses the historical edition and distinguishes missing age, missing cuts, and below B", () => {
    const historical = standard({
      id: "old",
      effectiveDate: "2020-09-01",
      expirationDate: "2024-08-31",
    });
    const modern = standard();
    modern.cuts.SCY!.F!["13-14"]!["100_FR_SCY"].cutsByTier = [
      { tierName: "B", timeMs: 61000, timeDisplay: "" },
    ];
    const data = snapshot(
      [
        race("old", { date: "2023-03-01" }),
        race("new"),
        race("missing-age", { ageAtSwim: null }),
        race("missing-benchmark", { event: "25_FR" }),
        race("below", { time: 90000 }),
        race("before-history", { date: "2019-01-01" }),
      ],
      [historical, modern],
    );
    expect(data.athletes[0].achievements[0].tier).toBe("A");
    expect(data.coverage).toMatchObject({
      validSwims: 6,
      missingAgeSwims: 1,
      missingStandardsSwims: 2,
      belowStandardSwims: 1,
      ungradedSwims: 4,
    });
  });

  it("rejects flagged, relay, split, future and invalid swims and accepts verified lead-offs", () => {
    const data = snapshot([
      race("flag", { moderationStatus: "flagged" }),
      race("ineligible", { calculationEligible: false }),
      race("relay", { relay: true }),
      race("leg", { relayLeg: 2 }),
      race("split", { split: true }),
      race("dq", { status: "DQ" }),
      race("future", { date: "2027-01-01" }),
      race("invalid", { date: "2026-02-30" }),
      race("zero", { time: 0 }),
      race("lead", { resultOrigin: "relay_leadoff", split: true }),
    ]);
    expect(data.coverage.validSwims).toBe(1);
    expect(data.athletes[0].achievements).toHaveLength(1);
  });
});
