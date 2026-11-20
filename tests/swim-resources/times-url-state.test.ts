import { describe, expect, it } from "vitest";
import { initialFilters } from "@/components/collection/times-data";
import {
  athleteTimesHref,
  rankingsHref,
  readTimesSelection,
  writeTimesSelection,
  timesViewHref,
} from "@/components/collection/times-url-state";

describe("shared times selections", () => {
  it("opens selected rankings without carrying stale pagination or searches", () => {
    const filters = {
      ...initialFilters,
      course: "LCM",
      event: "200_FR-R",
      genders: ["F"],
      ageGroups: ["13-14"],
      mode: "performances" as const,
      relay: true,
    };
    const url = new URL(
      rankingsHref(
        filters,
        "page=8&search=previous&view=records&team=other&myAthlete=swimmer&standard=cuts",
      ),
      "https://example.com",
    );
    expect(url.pathname).toBe("/tools/rankings");
    expect(url.hash).toBe("#times-rankings");
    expect(
      readTimesSelection(url.searchParams.get("filters"), initialFilters),
    ).toEqual(filters);
    for (const key of ["page", "search", "view", "team"])
      expect(url.searchParams.has(key)).toBe(false);
    expect(url.searchParams.get("myAthlete")).toBe("swimmer");
    expect(url.searchParams.get("standard")).toBe("cuts");
  });
  it("opens a swimmer’s Times profile in the ranked course with all-time results", () => {
    const url = new URL(
      athleteTimesHref("swimmer + & /", "LCM"),
      "https://example.com",
    );
    expect(url.pathname).toBe("/tools/my-times");
    expect(url.searchParams.get("myAthlete")).toBe("swimmer + & /");
    expect(JSON.parse(url.searchParams.get("myFilters")!)).toEqual({
      course: "LCM",
      mode: "all",
      age: "",
      startYear: "",
      endYear: "",
    });
    expect(url.searchParams.has("filters")).toBe(false);
  });
  it("uses separate tool pages and clears ranking state when changing tools", () => {
    for (const [view, path] of [
      ["my-times", "/tools/my-times"],
      ["rankings", "/tools/rankings"],
      ["records", "/tools/records"],
      ["standards", "/tools/standards"],
    ] as const) {
      const url = new URL(
        timesViewHref(
          view,
          "view=records&page=4&search=Avery&source=shared&standardCourse=LCM&eventFilters=closed",
          "#results",
        ),
        "https://example.com",
      );
      expect(url.pathname).toBe(path);
      for (const key of ["view", "page", "search", "eventFilters"]) {
        expect(url.searchParams.has(key)).toBe(false);
      }
      expect(url.searchParams.get("standardCourse")).toBe("LCM");
      expect(url.searchParams.get("source")).toBe("shared");
      expect(url.hash).toBe("#results");
    }
  });
  it("upgrades older bookmarks and preserves season ranges through sharing", () => {
    const legacy = { ...initialFilters, year: "2025", ageGroups: ["11-12"] };
    delete legacy.startDate;
    delete legacy.endDate;
    expect(readTimesSelection(JSON.stringify(legacy), initialFilters)).toEqual({
      ...legacy,
      startDate: "",
      endDate: "",
    });
    const season = {
      ...initialFilters,
      startDate: "2026-09-01",
      endDate: "2027-08-31",
    };
    const url = new URL("https://example.com/tools/times");
    const href = writeTimesSelection(url, "filters", season, initialFilters);
    expect(
      readTimesSelection(
        new URL(href, url).searchParams.get("filters"),
        initialFilters,
      ),
    ).toEqual(season);
    expect(
      readTimesSelection(
        JSON.stringify({ ...season, startDate: null }),
        initialFilters,
      ),
    ).toEqual(initialFilters);
  });
  it("drops old team filters from shared links and saved bookmarks", () => {
    const oldFilters = { ...initialFilters, team: "other-club", year: "2026" };
    expect(
      readTimesSelection(JSON.stringify(oldFilters), initialFilters),
    ).toEqual({ ...initialFilters, year: "2026" });
    const url = new URL(
      "https://example.com/tools/times?team=other&recordTeam=other&meetTeam=other",
    );
    url.searchParams.set("filters", JSON.stringify(oldFilters));
    const href = writeTimesSelection(url, "page", 1, 0);
    expect(href).not.toMatch(/team|Team/);
    expect(timesViewHref("records", url.search)).not.toMatch(/team|Team/);
  });
  it("round trips multi-selects, relay settings, empty selections and special characters", () => {
    const filters = {
      ...initialFilters,
      genders: [],
      ageGroups: ["8&U", "19&O"],
      relay: true,
    };
    const url = new URL(
      "https://example.com/tools/times?source=shared#results",
    );
    const href = writeTimesSelection(url, "filters", filters, initialFilters);
    const shared = new URL(href, url);
    expect(
      readTimesSelection(shared.searchParams.get("filters"), initialFilters),
    ).toEqual(filters);
    expect(shared.searchParams.get("source")).toBe("shared");
    expect(shared.hash).toBe("#results");
  });

  it("keeps consecutive updates and removes defaults without losing other selections", () => {
    const url = new URL("https://example.com/tools/times");
    writeTimesSelection(url, "view", "standards", "rankings");
    writeTimesSelection(url, "standardCourse", "LCM", "");
    writeTimesSelection(url, "search", "Qualifying & Motivational", "");
    writeTimesSelection(url, "standardCourse", "", "");
    expect(url.searchParams.get("view")).toBe("standards");
    expect(url.searchParams.has("standardCourse")).toBe(false);
    expect(readTimesSelection(url.searchParams.get("search"), "")).toBe(
      "Qualifying & Motivational",
    );
  });

  it("rejects malformed shared state and invalid pagination", () => {
    for (const raw of [
      "{",
      "null",
      "[]",
      '{"genders":null}',
      JSON.stringify({ ...initialFilters, ageGroups: [null] }),
    ])
      expect(readTimesSelection(raw, initialFilters)).toEqual(initialFilters);
    for (const raw of ["-1", "1.5", "null", '"2"', "1e100"])
      expect(readTimesSelection(raw, 0)).toBe(0);
    expect(readTimesSelection("2", 0)).toBe(2);
    expect(readTimesSelection("false", true)).toBe(false);
  });
});
