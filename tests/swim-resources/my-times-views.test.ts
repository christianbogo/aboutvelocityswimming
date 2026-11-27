// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MyTimes from "@/components/collection/MyTimes";
import type { MyTimesEvent } from "@/features/swimming/domain/times-query";
import type { AccountAthletePreferences } from "@/lib/account-athletes";

const mocks = vi.hoisted(() => ({
  times: vi.fn(),
  cachedAthletes: vi.fn(),
  loadAthletes: vi.fn(),
  onRankings: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/features/auth/context", () => ({
  useAuth: () => ({ user: { uid: "user" }, loading: false }),
}));
vi.mock("@/lib/supabase/client", () => ({
  hasBackendConfiguration: true,
}));
vi.mock("@/lib/account-athletes", () => ({
  cachedAccountAthletes: mocks.cachedAthletes,
  loadAccountAthletes: mocks.loadAthletes,
  loadAccountAthlete: vi.fn(),
  accountAthletesChangedEvent: "athletes-changed",
}));
vi.mock("@/components/collection/use-times", () => ({
  useTimes: mocks.times,
  useDebouncedSearch: (value: string) => value,
}));
vi.mock("@/components/collection/use-times-display", () => ({
  useTimesDisplay: () => ({
    show25s: false,
    showTimeStats: false,
    showDateAge: false,
    change: vi.fn(),
    status: "",
    ready: true,
  }),
}));

const preferences: AccountAthletePreferences = {
  primaryAthlete: { id: "avery", name: "Avery Swimmer", teamName: "Velocity" },
  favoriteAthletes: [],
};
const eventCodes = [
  "100_FR",
  "200_FR",
  "50_FR",
  "100_BK",
  "200_BK",
  "100_BR",
  "200_BR",
  "100_FL",
  "200_IM",
];
const events: MyTimesEvent[] = eventCodes.map((event, index) => {
  const race = {
    id: `race-${event}`,
    athleteId: "avery",
    event,
    course: "SCY",
    time: 60000 + index * 1000,
    date: "2026-05-10",
    ageAtSwim: 14,
    gender: "F",
    status: "OK",
    round: "F",
    team: "velocity-swimming",
    official: true,
    relay: false,
    meetId: "meet",
    meet: "Spring Invitational",
  };
  return {
    event,
    race,
    rankRace: race,
    allTimeRank: index + 1,
    allTimeCount: 25,
    rankAgeGroup: "13-14",
    rankGender: "F",
  };
});
const standards = { sets: [], loading: false, error: "", retry: vi.fn() };
const page = () =>
  createElement(MyTimes, { standards, onRankings: mocks.onRankings });

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/tools/my-times");
  mocks.cachedAthletes.mockReturnValue(preferences);
  mocks.loadAthletes.mockResolvedValue(preferences);
  mocks.times.mockImplementation((url: string | null) => ({
    data: url
      ? {
          myTimes: {
            period: "all",
            athleteId: "avery",
            ages: [14],
            years: ["2026"],
            latestAge: 14,
            latestAgeGroup: "13-14",
            events,
          },
        }
      : undefined,
    loading: false,
    error: "",
    retry: vi.fn(),
  }));
});
afterEach(cleanup);

it("opens Highlights by default and limits the ranked cards to three featured and five compact bests", async () => {
  const screen = render(page());
  await screen.findByRole("button", { name: "View: Highlights" });
  const cards = screen.getAllByRole("button", { name: /^View .* rankings$/ });
  expect(cards).toHaveLength(8);
  expect(cards[0].getAttribute("aria-label")).toBe(
    "View 100 Freestyle rankings",
  );
  for (const card of cards) {
    const description = document.getElementById(
      card.getAttribute("aria-describedby") ?? "",
    );
    expect(description?.textContent).toMatch(/Best time .* in SCY/);
    expect(description?.textContent).toContain("All-time team rank");
  }
  expect(
    document.getElementById(cards[0].getAttribute("aria-describedby")!)
      ?.textContent,
  ).toContain("Spring Invitational");
  expect(
    screen.container.querySelectorAll('[data-highlight-size="featured"]'),
  ).toHaveLength(3);
  expect(
    screen.container.querySelectorAll('[data-highlight-size="compact"]'),
  ).toHaveLength(5);
  expect(
    screen.getByRole("heading", { name: "Standards achieved" }),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Stroke coverage" })).toBeTruthy();
  expect(
    screen.queryByRole("button", {
      name: "View 200 Individual Medley rankings",
    }),
  ).toBeNull();
});

it("keeps athlete and time filters when switching views, and restores the selected grid from the URL", async () => {
  const filters = {
    course: "SCY",
    mode: "years",
    age: "13-14",
    startYear: "2026",
    endYear: "2026",
  };
  window.history.replaceState(
    {},
    "",
    `/tools/my-times?${new URLSearchParams({
      myAthlete: "avery",
      myFilters: JSON.stringify(filters),
    })}`,
  );
  const screen = render(page());
  fireEvent.click(
    await screen.findByRole("button", { name: "View: Highlights" }),
  );
  fireEvent.click(
    within(screen.getByRole("group", { name: "View options" })).getByRole(
      "button",
      { name: "Bests Grid" },
    ),
  );
  screen.rerender(page());
  const params = new URLSearchParams(window.location.search);
  expect(params.get("myView")).toBe("bests-grid");
  expect(params.get("myAthlete")).toBe("avery");
  expect(JSON.parse(params.get("myFilters")!)).toEqual(filters);
  expect(screen.getByRole("button", { name: "View: Bests Grid" })).toBeTruthy();
  expect(
    screen.getAllByRole("button", { name: /^View .* rankings$/ }),
  ).toHaveLength(9);

  screen.unmount();
  const restored = render(page());
  expect(
    await restored.findByRole("button", { name: "View: Bests Grid" }),
  ).toBeTruthy();
  fireEvent.click(restored.getByRole("button", { name: "View: Bests Grid" }));
  fireEvent.click(
    within(restored.getByRole("group", { name: "View options" })).getByRole(
      "button",
      { name: "Highlights" },
    ),
  );
  restored.rerender(page());
  expect(new URLSearchParams(window.location.search).has("myView")).toBe(false);
  expect(
    restored.getByRole("button", { name: "View: Highlights" }),
  ).toBeTruthy();
});

it("falls back to Highlights for an unknown shared view and preserves rankings navigation", async () => {
  window.history.replaceState({}, "", "/tools/my-times?myView=unknown");
  const screen = render(page());
  expect(
    await screen.findByRole("button", { name: "View: Highlights" }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "View 100 Freestyle rankings" }),
  );
  expect(mocks.onRankings).toHaveBeenCalledExactlyOnceWith({
    event: "100_FR",
    course: "SCY",
    gender: "F",
    ageGroup: "13-14",
  });
});

it("does not invent additional highlight cards when the athlete has fewer than eight bests", async () => {
  mocks.times.mockReturnValue({
    data: {
      myTimes: {
        period: "all",
        athleteId: "avery",
        ages: [14],
        years: ["2026"],
        latestAge: 14,
        latestAgeGroup: "13-14",
        events: [events[0], { ...events[1], race: null }],
      },
    },
    loading: false,
    error: "",
    retry: vi.fn(),
  });
  const screen = render(page());
  await screen.findByRole("button", { name: "View: Highlights" });
  expect(
    screen.getAllByRole("button", { name: /^View .* rankings$/ }),
  ).toHaveLength(1);
  expect(
    screen.getByRole("heading", { name: "Standards achieved" }),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Stroke coverage" })).toBeTruthy();
});
