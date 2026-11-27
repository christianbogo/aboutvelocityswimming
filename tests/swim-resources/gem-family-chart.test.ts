// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GemFamilyChart } from "@/components/collection/GemFamilyChart";
import TimesHighlights from "@/components/collection/TimesHighlights";
import type { MyTimesEvent } from "@/components/collection/times-api";
import type { StandardSet } from "@/features/swim-resources/types/schema";

afterEach(cleanup);

it("describes all six point totals on one common scale, including empty families", () => {
  const screen = render(
    createElement(GemFamilyChart, {
      points: { IM: 2, FR: 7, DST: 3 },
    }),
  );
  const chart = screen.getByRole("img", {
    name: "Rank points by event family",
  });
  const description = document.getElementById(
    chart.getAttribute("aria-describedby")!,
  )!.textContent;
  expect(description).toContain(
    "IM: 2 points; Fly: 0 points; Back: 0 points; Breast: 0 points; Free: 7 points; Distance: 3 points",
  );
  expect(description).toContain("to 8 points at the outer ring");
  expect(screen.getByText("12")).toBeTruthy();
});

it("renders a readable empty hexagon when no points have been achieved", () => {
  const screen = render(createElement(GemFamilyChart, { points: {} }));
  expect(
    screen.getByRole("img", { name: "Rank points by event family" }),
  ).toBeTruthy();
  expect(
    screen.getByText("No rank points in this selection yet."),
  ).toBeTruthy();
});

it("weights all matched bests once and separates distance from freestyle above highlights", () => {
  const codes = [
    "50_FR",
    "100_FR",
    "200_FR",
    "400_FR",
    "500_FR",
    "100_BK",
    "100_BR",
    "100_FL",
    "200_IM",
  ];
  const events: MyTimesEvent[] = codes.map((event) => ({
    event,
    race: {
      id: event,
      athleteId: "athlete",
      event,
      course: "SCY",
      time:
        (
          {
            "100_BK": 120000,
            "50_FR": 45000,
            "100_FR": 55000,
            "200_FR": 85000,
            "100_BR": 95000,
            "200_IM": 65000,
          } as Record<string, number>
        )[event] ?? 75000,
      date: "2026-06-01",
      ageAtSwim: 14,
      gender: "F",
      status: "OK",
      round: "F",
      team: "velocity-swimming",
      official: true,
      relay: false,
      meetId: "meet",
      meet: "Meet",
    },
    rankRace: null,
    allTimeRank: 1,
    allTimeCount: 1,
    rankAgeGroup: "13-14",
    rankGender: "F",
  }));
  const standard: StandardSet = {
    id: "motivational",
    name: "USA Swimming Motivational",
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
            codes
              .filter((event) => event !== "100_FL")
              .map((event) => [
                `${event}_SCY`,
                {
                  cutsByTier: [
                    { tierName: "B", timeMs: 100000, timeDisplay: "" },
                    { tierName: "BB", timeMs: 90000, timeDisplay: "" },
                    { tierName: "A", timeMs: 80000, timeDisplay: "" },
                    { tierName: "AA", timeMs: 70000, timeDisplay: "" },
                    { tierName: "AAA", timeMs: 60000, timeDisplay: "" },
                    { tierName: "AAAA", timeMs: 50000, timeDisplay: "" },
                  ],
                },
              ]),
          ),
        },
      },
    },
  };
  const screen = render(
    createElement(TimesHighlights, {
      events,
      sets: [standard],
      onRankings: vi.fn(),
      onBestsGrid: vi.fn(),
    }),
  );
  const chart = screen.getByRole("img", {
    name: "Your rank points by event family",
  });
  expect(
    document.getElementById(chart.getAttribute("aria-describedby")!)!
      .textContent,
  ).toContain(
    "IM: 10 points; Fly: 0 points; Back: 0 points; Breast: 1 point; Free: 77 points; Distance: 10 points",
  );
  expect(
    screen.getByText("Rank points across bests in this selection"),
  ).toBeTruthy();
  expect(
    chart.compareDocumentPosition(
      screen.getByRole("list", { name: "Top highlights" }),
    ) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
