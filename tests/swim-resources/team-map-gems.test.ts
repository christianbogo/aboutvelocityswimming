// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { TeamMapGemSections } from "@/components/collection/TeamMapGems";
import {
  buildTeamMap,
  type TeamMapSnapshot,
} from "@/components/collection/team-map-data";

afterEach(cleanup);

function fixture(): TeamMapSnapshot {
  const data = buildTeamMap({
    roster: [
      { athleteId: "avery", name: "Avery Swimmer", trainingGroup: "Senior" },
      { athleteId: "blake", name: "Blake Swimmer", trainingGroup: "Junior" },
      { athleteId: null, name: "Casey Swimmer", trainingGroup: "Novice" },
    ],
    races: [],
    standards: [],
    year: 2026,
    course: "SCY",
    asOf: "2026-11-18",
  });
  // Supply an inventory with deliberately unordered rank keys: presentation
  // must follow rank order, not the order a response's fields arrive in.
  data.roster[0].counts = { AAAA: 1, AA: 1, B: 2, A: 1, AAA: 0, BB: 0 };
  data.roster[0].total = 5;
  data.totalContributions = 5;
  data.rankCounts = { ...data.roster[0].counts };
  data.familyCounts = { IM: 1, FL: 0, BK: 1, BR: 0, FR: 2, DST: 1 };
  data.gemHistory = [
    { date: "2024-05-09", total: 0, counts: {} },
    { date: "2024-05-10", total: 2, counts: { B: 2 } },
    { date: "2025-03-01", total: 2, counts: { B: 1, A: 1 } },
    { date: "2026-11-18", total: 5, counts: { ...data.rankCounts } },
  ];
  return data;
}

it("shows every roster member and sorts one colored square per gem from Bronze to Elite", () => {
  const screen = render(createElement(TeamMapGemSections, { data: fixture() }));
  const roster = screen.getByRole("list", { name: "Active roster gems" });
  const rows = within(roster).getAllByRole("listitem");
  expect(rows).toHaveLength(3);
  const avery = within(rows[0]);
  expect(avery.getByText("Avery Swimmer")).toBeTruthy();
  expect(
    avery.getByRole("img", { name: "2 Bronze, 1 Gold, 1 Platinum, 1 Elite" }),
  ).toBeTruthy();
  expect(
    Array.from(rows[0].querySelectorAll("[data-gem-tier]"), (square) =>
      square.getAttribute("data-gem-tier"),
    ),
  ).toEqual(["B", "B", "A", "AA", "AAAA"]);
  expect(avery.getByLabelText("5 gems")).toBeTruthy();
  expect(within(rows[1]).getByText("Blake Swimmer")).toBeTruthy();
  expect(within(rows[1]).getByText("No gems yet")).toBeTruthy();
  expect(within(rows[2]).getByText("Casey Swimmer")).toBeTruthy();
  expect(within(rows[2]).getByText("Times profile not linked")).toBeTruthy();
  expect(rows[1].querySelector("[data-gem-tier]")).toBeNull();
  expect(rows[2].querySelector("[data-gem-tier]")).toBeNull();
});

it("lets the date slider expose earlier totals and rank counts, including upgrades at an unchanged total", () => {
  const screen = render(createElement(TeamMapGemSections, { data: fixture() }));
  const history = screen.getByRole("region", { name: "Gems over time" });
  const controls = within(history);
  const slider = controls.getByRole("slider", { name: "Gem history date" });
  expect(slider.getAttribute("aria-valuetext")).toBe("Nov 18, 2026: 5 gems");
  expect(
    controls.getByRole("img", { name: /Current roster gem totals over time/ }),
  ).toBeTruthy();

  fireEvent.change(slider, { target: { value: "1" } });
  expect(slider.getAttribute("aria-valuetext")).toBe("May 10, 2024: 2 gems");
  expect(history.querySelector("time")?.getAttribute("dateTime")).toBe(
    "2024-05-10",
  );
  const bronze = controls.getByText("Bronze").closest("li")!;
  const gold = controls.getByText("Gold").closest("li")!;
  expect(within(bronze).getByText("2")).toBeTruthy();
  expect(within(gold).getByText("0")).toBeTruthy();

  fireEvent.change(slider, { target: { value: "2" } });
  expect(slider.getAttribute("aria-valuetext")).toBe("Mar 1, 2025: 2 gems");
  expect(within(bronze).getByText("1")).toBeTruthy();
  expect(within(gold).getByText("1")).toBeTruthy();

  fireEvent.change(slider, { target: { value: "0" } });
  expect(slider.getAttribute("aria-valuetext")).toBe("May 9, 2024: 0 gems");
  expect(within(bronze).getByText("0")).toBeTruthy();
  expect(within(gold).getByText("0")).toBeTruthy();
});

it("describes all six family counts and their common scale without requiring sight or color", () => {
  const screen = render(createElement(TeamMapGemSections, { data: fixture() }));
  const chart = screen.getByRole("img", { name: "Team gem profile" });
  const description = document.getElementById(
    chart.getAttribute("aria-describedby")!,
  );
  expect(description?.textContent).toContain(
    "IM: 1 gem; Fly: 0 gems; Back: 1 gem; Breast: 0 gems; Free: 2 gems; Distance: 1 gem",
  );
  expect(description?.textContent).toContain("Every axis uses the same scale");
  expect(description?.textContent).toContain("2 gems at the outer ring");
});

it("shows meaningful empty states without offering an empty history slider", () => {
  const data = buildTeamMap({
    roster: [],
    races: [],
    standards: [],
    year: 2026,
    course: "LCM",
    asOf: "2026-11-18",
  });
  const screen = render(createElement(TeamMapGemSections, { data }));
  expect(screen.getByText("No active roster members yet.")).toBeTruthy();
  expect(
    screen.getByText("No gems have been earned in this course selection yet."),
  ).toBeTruthy();
  expect(screen.queryByRole("slider", { name: "Gem history date" })).toBeNull();
  const chart = screen.getByRole("img", { name: "Team gem profile" });
  const description = document.getElementById(
    chart.getAttribute("aria-describedby")!,
  );
  expect(description?.textContent).toContain(
    "IM: 0 gems; Fly: 0 gems; Back: 0 gems; Breast: 0 gems; Free: 0 gems; Distance: 0 gems",
  );
});
