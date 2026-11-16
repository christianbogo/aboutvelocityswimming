import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Race } from "@/components/collection/times-data";
import type { StandardSet } from "@/features/swim-resources/types/schema";
import {
  motivationalRankForRace,
  motivationalRankForTier,
} from "@/components/collection/motivational-ranks";
import CutChips from "@/components/collection/CutChips";
import { RankLegend } from "@/components/collection/MotivationalRankIcon";

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
const thresholds = [
  ["B", "Bronze", 65000],
  ["BB", "Silver", 62000],
  ["A", "Gold", 59000],
  ["AA", "Platinum", 56000],
  ["AAA", "Diamond", 53000],
  ["AAAA", "Elite", 50000],
] as const;
const motivational: StandardSet = {
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
        "13-14": {
          "100_FR_SCY": {
            cutsByTier: thresholds.map(([tierName, , timeMs]) => ({
              tierName,
              timeMs,
              timeDisplay: "",
            })),
          },
        },
      },
    },
  },
};
const championship: StandardSet = {
  ...motivational,
  id: "futures",
  name: "USA Swimming Futures",
  category: "championship",
  cuts: {
    SCY: {
      F: {
        Open: {
          "100_FR_SCY": {
            cutsByTier: [
              { tierName: "Qualifying", timeMs: 56000, timeDisplay: "56.00" },
            ],
          },
        },
      },
    },
  },
};

describe("motivational rank icons", () => {
  it("awards each icon at its exact threshold, with Bronze beginning at B", () => {
    for (const [tier, name, time] of thresholds) {
      expect(
        motivationalRankForRace({ ...race, time }, [motivational])?.rank,
      ).toMatchObject({ tier, name });
    }
    expect(
      motivationalRankForRace({ ...race, time: 65001 }, [motivational]),
    ).toBeNull();
    expect(
      motivationalRankForRace({ ...race, time: 50001 }, [motivational])?.rank
        .name,
    ).toBe("Diamond");
    expect(
      motivationalRankForRace({ ...race, time: 40000 }, [motivational])?.rank
        .name,
    ).toBe("Elite");
  });

  it("requires a valid result and the matching age, course, gender and historical edition", () => {
    for (const change of [
      { ageAtSwim: null },
      { ageAtSwim: 15 },
      { gender: "M" },
      { course: "LCM" },
      { date: "2024-12-31" },
      { status: "DQ" },
      { calculationEligible: false },
      { moderationStatus: "flagged" as const },
      { time: NaN },
    ]) {
      expect(
        motivationalRankForRace({ ...race, ...change }, [motivational]),
      ).toBeNull();
    }
    expect(motivationalRankForRace(race, [championship])).toBeNull();
    expect(motivationalRankForTier("Qualifying")).toBeUndefined();
  });

  it("replaces only the motivational chip when requested and preserves its accessible detail", () => {
    const html = renderToStaticMarkup(
      createElement(CutChips, {
        race,
        sets: [motivational, championship],
        inline: true,
        motivationalIcons: true,
      }),
    );
    expect(html).toContain("/assets/ranks/platinum.svg");
    expect(html).toContain(
      'aria-label="Platinum rank: AA motivational standard"',
    );
    expect(html).toContain("age and standards at the swim date");
    expect(html).toContain("Futures");
    const original = renderToStaticMarkup(
      createElement(CutChips, { race, sets: [motivational] }),
    );
    expect(original).not.toContain("/assets/ranks/");
    expect(original).toContain(">AA</button>");
  });

  it("explains all six supplied icons in the legend", () => {
    const html = renderToStaticMarkup(createElement(RankLegend));
    for (const [tier, name] of thresholds) {
      expect(html).toContain(name);
      expect(html).toContain(`<strong>${tier}</strong>`);
    }
    expect(html).not.toContain("Champion");
    expect(html).not.toContain("Unreal");
  });
});
