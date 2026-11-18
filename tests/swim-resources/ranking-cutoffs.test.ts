import { describe, expect, it } from "vitest";
import type { StandardSet } from "@/features/swim-resources/types/schema";
import { initialFilters } from "@/components/collection/times-data";
import {
  crossedRankingCutoffs,
  rankingCutoffs,
} from "@/components/collection/ranking-cutoffs";

const standard: StandardSet = {
  id: "current",
  name: "Age group motivational standards",
  governingBody: "USA_Swimming",
  category: "motivational",
  standardType: "age-group",
  effectiveDate: "2025-01-01",
  expirationDate: "2028-12-31",
  seasonYears: "2025–2028",
  cuts: {
    SCY: {
      F: {
        "11-12": {
          "100_FR_SCY": {
            cutsByTier: [
              { tierName: "B", timeMs: 70000, timeDisplay: "1:10.00" },
              { tierName: "AAA", timeMs: 60000, timeDisplay: "1:00.00" },
              { tierName: "AAAA", timeMs: 55000, timeDisplay: "55.00" },
            ],
          },
        },
      },
    },
  },
};
const filters = { ...initialFilters, ageGroups: ["11-12"] };

describe("rank cutoff boundaries", () => {
  it("uses the current selection and orders thresholds fastest first", () => {
    const cutoffs = rankingCutoffs(filters, [standard], "2026-11-18");
    expect(cutoffs.map(({ rank, time }) => [rank.name, time])).toEqual([
      ["Elite", 55000],
      ["Diamond", 60000],
      ["Bronze", 70000],
    ]);
    expect(cutoffs.map(({ seasonYears }) => seasonYears)).toEqual([
      "2025–2028",
      "2025–2028",
      "2025–2028",
    ]);
    expect(
      rankingCutoffs(
        { ...filters, year: "2026" },
        [standard],
        "2026-11-18",
      ).map(({ seasonYears }) => seasonYears),
    ).toEqual(cutoffs.map(({ seasonYears }) => seasonYears));
    expect(rankingCutoffs(filters, [standard], "2029-01-01")).toEqual([]);
    for (const change of [
      { ageGroups: [] },
      { genders: ["F", "M"] },
      { relay: true },
      { mode: "recent" as const },
    ])
      expect(
        rankingCutoffs({ ...filters, ...change }, [standard], "2026-11-18"),
      ).toEqual([]);
  });

  it("keeps every tied cutoff swim above its boundary, including a previous page's final swim", () => {
    const cutoffs = rankingCutoffs(filters, [standard], "2026-11-18");
    expect(crossedRankingCutoffs(cutoffs, 59000, 60000)).toEqual([]);
    expect(crossedRankingCutoffs(cutoffs, 60000, 60000)).toEqual([]);
    expect(
      crossedRankingCutoffs(cutoffs, 60000, 60001).map(({ rank }) => rank.name),
    ).toEqual(["Diamond"]);
    expect(
      crossedRankingCutoffs(cutoffs, 54000, 71000).map(({ rank }) => rank.name),
    ).toEqual(["Elite", "Diamond", "Bronze"]);
    expect(crossedRankingCutoffs(cutoffs, undefined, 71000)).toEqual([]);
  });

  it("uses the edition in force at the selected year's end and never substitutes current cuts for historical gaps", () => {
    const historical: StandardSet = {
      ...standard,
      id: "historical",
      seasonYears: "2020–2024",
      effectiveDate: "2020-01-01",
      expirationDate: "2024-08-31",
      cuts: {
        SCY: {
          F: {
            "11-12": {
              "100_FR_SCY": {
                cutsByTier: [
                  { tierName: "AAA", timeMs: 61000, timeDisplay: "1:01.00" },
                ],
              },
            },
          },
        },
      },
    };
    const replacement: StandardSet = {
      ...standard,
      id: "replacement",
      seasonYears: "2024–2028",
      effectiveDate: "2024-09-01",
    };
    const editions = [replacement, historical];
    expect(
      rankingCutoffs({ ...filters, year: "2023" }, editions, "2026-11-18"),
    ).toMatchObject([{ time: 61000, seasonYears: "2020–2024" }]);
    const transitionYear = rankingCutoffs(
      { ...filters, year: "2024" },
      editions,
      "2026-11-18",
    );
    expect(transitionYear.map(({ seasonYears }) => seasonYears)).toEqual([
      "2024–2028",
      "2024–2028",
      "2024–2028",
    ]);
    expect(transitionYear.find(({ rank }) => rank.tier === "AAA")?.time).toBe(
      60000,
    );
    expect(
      rankingCutoffs({ ...filters, year: "2019" }, editions, "2026-11-18"),
    ).toEqual([]);
    expect(
      rankingCutoffs({ ...filters, year: "2024" }, [historical], "2026-11-18"),
    ).toEqual([]);
  });

  it("keeps the selected current year on today's edition until a later edition takes effect", () => {
    const upcoming: StandardSet = {
      ...standard,
      id: "upcoming",
      seasonYears: "2026–2030",
      effectiveDate: "2026-12-01",
      expirationDate: "2030-12-31",
    };
    expect(
      rankingCutoffs(
        { ...filters, year: "2026" },
        [standard, upcoming],
        "2026-11-18",
      ).map(({ seasonYears }) => seasonYears),
    ).toEqual(["2025–2028", "2025–2028", "2025–2028"]);
    expect(
      rankingCutoffs(
        { ...filters, year: "2026" },
        [standard, upcoming],
        "2026-12-01",
      ).map(({ seasonYears }) => seasonYears),
    ).toEqual(["2026–2030", "2026–2030", "2026–2030"]);
  });
});
