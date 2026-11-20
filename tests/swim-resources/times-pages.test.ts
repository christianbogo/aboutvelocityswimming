// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialFilters } from "@/components/collection/times-data";
import RankingsPage from "@/components/collection/RankingsPage";
import RecordsPage from "@/components/collection/RecordsPage";
import MyTimesPage from "@/components/collection/MyTimesPage";
import StandardsPage from "@/components/collection/StandardsPage";

const mocks = vi.hoisted(() => ({
  times: vi.fn(),
  standards: vi.fn(),
  standardSelection: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/lib/supabase/client", () => ({
  hasBackendConfiguration: true,
  browserClient: vi.fn(),
}));
vi.mock("@/components/collection/use-times", () => ({
  useTimes: mocks.times,
  useDebouncedSearch: (value: string) => value,
}));
vi.mock("@/components/collection/use-standards", () => ({
  useStandards: mocks.standards,
}));
vi.mock("@/components/collection/MyTimes", () => ({
  default: ({ onRankings }: { onRankings: (selection: object) => void }) =>
    createElement(
      "button",
      {
        onClick: () =>
          onRankings({
            event: "200_IM",
            course: "LCM",
            gender: "M",
            ageGroup: "15-16",
          }),
      },
      "Athlete rankings",
    ),
}));
vi.mock("@/components/collection/TeamRecords", () => ({
  TeamRecordsSkeleton: () => createElement("p", null, "Loading records"),
  default: ({ onRecord }: { onRecord: (selection: object) => void }) =>
    createElement(
      "button",
      {
        onClick: () =>
          onRecord({
            event: "200_FR-R",
            course: "SCY",
            gender: "F",
            ageGroup: "13-14",
            relay: true,
          }),
      },
      "Record rankings",
    ),
}));
vi.mock("@/components/collection/TimeStandards", () => ({
  useTimeStandardsSelection: mocks.standardSelection,
  TimeStandardsSummary: () => createElement("p", null, "Selected standards"),
  TimeStandardsSummarySkeleton: () => null,
  TimeStandardsSkeleton: () => null,
  default: () => createElement("p", null, "Standard cuts"),
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/tools/rankings");
  mocks.times.mockReturnValue({
    data: { rows: [], total: 0, years: ["2026"], races: [], records: {} },
    loading: false,
    error: "",
    retry: vi.fn(),
  });
  mocks.standards.mockReturnValue({ sets: [], loading: false, error: "" });
  mocks.standardSelection.mockReturnValue({ set: { id: "selected" } });
});
afterEach(cleanup);

it("rankings loads only its queries and retains bookmarked filters", () => {
  const filters = {
    ...initialFilters,
    course: "LCM",
    event: "200_IM",
    genders: ["M"],
    ageGroups: ["15-16"],
  };
  window.history.replaceState(
    {},
    "",
    `/tools/rankings?${new URLSearchParams({
      filters: JSON.stringify(filters),
      page: "2",
      search: "Avery",
    })}`,
  );
  render(createElement(RankingsPage));
  const queries = mocks.times.mock.calls.map(
    ([href]) => new URL(href, window.location.origin).searchParams,
  );
  expect(queries.map((query) => query.get("view"))).toEqual([
    "ranking_years",
    "rankings",
  ]);
  expect(Object.fromEntries(queries[1])).toMatchObject({
    course: "LCM",
    event: "200_IM",
    genders: "M",
    ageGroups: "15-16",
    offset: "49",
    limit: "26",
    search: "Avery",
  });
  expect(mocks.standards).toHaveBeenCalledTimes(1);
  expect(mocks.standardSelection).not.toHaveBeenCalled();
});

it("records skips standards and opens relay performance rankings", () => {
  window.history.replaceState({}, "", "/tools/records?page=7&search=old");
  const screen = render(createElement(RecordsPage));
  expect(mocks.times).toHaveBeenCalledExactlyOnceWith(
    "/api/times?view=records_board",
  );
  expect(mocks.standards).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Record rankings" }));
  const url = new URL(mocks.push.mock.calls[0][0], window.location.origin);
  expect(url.pathname).toBe("/tools/rankings");
  expect(url.hash).toBe("#times-rankings");
  expect(JSON.parse(url.searchParams.get("filters")!)).toMatchObject({
    event: "200_FR-R",
    genders: ["F"],
    ageGroups: ["13-14"],
    mode: "performances",
    relay: true,
  });
  expect(url.searchParams.has("page")).toBe(false);
  expect(url.searchParams.has("search")).toBe(false);
});

it("My Times owns its page and keeps the athlete context when opening rankings", () => {
  window.history.replaceState({}, "", "/tools/my-times?myAthlete=avery");
  const screen = render(createElement(MyTimesPage));
  expect(mocks.times).not.toHaveBeenCalled();
  expect(mocks.standards).toHaveBeenCalledTimes(1);
  expect(mocks.standardSelection).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Athlete rankings" }));
  const url = new URL(mocks.push.mock.calls[0][0], window.location.origin);
  expect(url.pathname).toBe("/tools/rankings");
  expect(url.searchParams.get("myAthlete")).toBe("avery");
  expect(JSON.parse(url.searchParams.get("filters")!)).toMatchObject({
    event: "200_IM",
    course: "LCM",
    genders: ["M"],
    ageGroups: ["15-16"],
    mode: "bests",
    relay: false,
  });
});

it("standards owns its selection and does not start results queries", () => {
  const screen = render(createElement(StandardsPage));
  expect(screen.getByText("Standard cuts")).toBeTruthy();
  expect(mocks.standards).toHaveBeenCalledTimes(1);
  expect(mocks.standardSelection).toHaveBeenCalledExactlyOnceWith([]);
  expect(mocks.times).not.toHaveBeenCalled();
});
