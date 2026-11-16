import { describe, it, expect } from "vitest";
import { parseTimesQuery, timesUrl } from "@/components/collection/times-api";
import {
  timesBucket,
  timesExpiry,
  clearTimesCache,
  timesCache,
  timesGeneration,
} from "@/components/collection/times-cache";
import {
  groupedEvents,
  initialFilters,
  matches,
  type Race,
} from "@/components/collection/times-data";
describe("Velocity times requests", () => {
  it("opts into all-time ranks while preserving legacy requests", () => {
    const legacy = parseTimesQuery(
      new URLSearchParams("view=my_times&athleteId=a"),
    );
    expect(legacy.input).not.toHaveProperty("rankPeriod");
    for (const rankPeriod of ["all", "season"]) {
      expect(
        parseTimesQuery(
          new URLSearchParams({ view: "my_times", athleteId: "a", rankPeriod }),
        ).input.rankPeriod,
      ).toBe(rankPeriod);
    }
    for (const rankPeriod of ["", "recent", "any"]) {
      expect(() =>
        parseTimesQuery(
          new URLSearchParams({ view: "my_times", athleteId: "a", rankPeriod }),
        ),
      ).toThrow("Invalid rankPeriod");
    }
    expect(
      timesUrl("my_times", { athleteId: "a", rankPeriod: "all" }),
    ).toContain("rankPeriod=all");
  });
  it("validates exact-age and inclusive calendar-year personal best filters", () => {
    expect(
      parseTimesQuery(
        new URLSearchParams("view=my_times&athleteId=a&ageAtSwim=12"),
      ).input,
    ).toMatchObject({ athleteId: "a", course: "SCY", ageAtSwim: 12 });
    expect(
      parseTimesQuery(
        new URLSearchParams(
          "view=my_times&athleteId=a&startYear=2024&endYear=2026",
        ),
      ).input,
    ).toMatchObject({ startYear: "2024", endYear: "2026" });
    for (const suffix of [
      "",
      "&ageAtSwim=-1",
      "&ageAtSwim=121",
      "&ageAtSwim=12.5",
      "&ageAtSwim=12&startYear=2024",
      "&startYear=2027&endYear=2026",
      "&startYear=20",
      "&endYear=0000",
    ]) {
      const query = suffix
        ? `view=my_times&athleteId=a${suffix}`
        : "view=my_times";
      expect(() => parseTimesQuery(new URLSearchParams(query))).toThrow();
    }
  });
  it("requires an athlete and one bounded personal-best filter", () => {
    const base = "view=my_times_bests&athleteId=a";
    expect(
      parseTimesQuery(new URLSearchParams(`${base}&ageAtSwim=0`)),
    ).toMatchObject({
      kind: "my_times_bests",
      input: { athleteId: "a", course: "SCY", ageAtSwim: 0 },
    });
    expect(
      parseTimesQuery(
        new URLSearchParams(`${base}&course=LCM&startYear=2026&endYear=2026`),
      ),
    ).toMatchObject({
      kind: "my_times_bests",
      input: {
        athleteId: "a",
        course: "LCM",
        startYear: "2026",
        endYear: "2026",
      },
    });
    for (const invalid of [
      base,
      `${base}&ageAtSwim=121`,
      `${base}&ageAtSwim=12&startYear=2024&endYear=2026`,
      `${base}&startYear=2024`,
      `${base}&endYear=2026`,
      `${base}&startYear=2026&endYear=2024`,
      `${base}&startYear=0001&endYear=2026`,
      "view=my_times_bests&ageAtSwim=12",
    ]) {
      expect(() => parseTimesQuery(new URLSearchParams(invalid))).toThrow();
    }
  });
  it("keeps season date bounds and rejects impossible or reversed dates", () => {
    const input = parseTimesQuery(
      new URLSearchParams(
        "view=rankings&startDate=2026-09-01&endDate=2027-08-31",
      ),
    ).input;
    expect(input).toMatchObject({
      startDate: "2026-09-01",
      endDate: "2027-08-31",
    });
    for (const suffix of [
      "startDate=2026-02-29",
      "endDate=2026-2-01",
      "startDate=2027-01-01&endDate=2026-01-01",
      "startDate=0000-01-01",
    ])
      expect(() =>
        parseTimesQuery(new URLSearchParams(`view=rankings&${suffix}`)),
      ).toThrow();
  });
  it("always scopes reads to Velocity and ignores legacy team selections", () => {
    for (const view of ["rankings", "records", "facets"]) {
      for (const team of ["", "other-club", "velocity-swimming"]) {
        expect(
          parseTimesQuery(new URLSearchParams({ view, team })).input.team,
        ).toBe("velocity-swimming");
      }
    }
    expect(timesUrl("rankings", { team: "other-club" })).toBe(
      "/api/times?view=rankings",
    );
    expect(() =>
      parseTimesQuery(new URLSearchParams("view=record_teams")),
    ).toThrow();
  });
  it("defaults to female bests and canonicalizes multiple selections", () => {
    expect(
      parseTimesQuery(new URLSearchParams("view=rankings")).input,
    ).toMatchObject({ genders: ["F"], mode: "bests", offset: 0, limit: 25 });
    expect(
      parseTimesQuery(new URLSearchParams("view=rankings&genders=M,F,M")).input
        .genders,
    ).toEqual(["F", "M"]);
    expect(timesUrl("rankings", { genders: ["M", "F"], team: "a&b" })).toBe(
      timesUrl("rankings", { team: "a&b", genders: ["F", "M"] }),
    );
  });
  it("rejects the removed Meets and Athletes views", () => {
    for (const view of [
      "meets",
      "meet_results",
      "meet_events",
      "athletes",
      "profile",
      "athlete_history",
      "athlete_relays",
    ]) {
      expect(() =>
        parseTimesQuery(
          new URLSearchParams({
            view,
            meetId: "m",
            athleteId: "a",
            historyEvent: "100_FR_SCY",
          }),
        ),
      ).toThrow("Choose a valid times view.");
    }
  });
  it("rejects unsupported views, invalid filters and unbounded pages", () => {
    for (const query of [
      "view=private",
      "view=rankings&genders=",
      "view=rankings&genders=unknown",
      "view=rankings&offset=-1",
      "view=rankings&limit=101",
      "view=rankings&course=bad",
      "view=rankings&relay=1",
      "view=profile",
      "view=athlete_relays",
      "view=race",
    ])
      expect(() => parseTimesQuery(new URLSearchParams(query))).toThrow();
  });
  it("expires cached data at a shared minute boundary and clears browser data after writes", () => {
    expect(timesBucket(120001)).toBe(2);
    expect(timesExpiry(timesBucket(120001))).toBe(180000);
    timesCache.set("fixture", { expiresAt: 180000 });
    const generation = timesGeneration;
    clearTimesCache();
    expect(timesCache.size).toBe(0);
    expect(timesGeneration).toBe(generation + 1);
  });
  it("groups strokes and sorts distances numerically", () => {
    const groups = groupedEvents([
      ["1000_FR", "1000"],
      ["100_BR", "100 breast"],
      ["50_FR", "50"],
      ["200_IM", "200 IM"],
      ["100_MED-R", "relay"],
      ["100_FR", "100"],
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      "Freestyle",
      "Breaststroke",
      "Individual Medley",
      "Medley Relays",
    ]);
    expect(groups[0].options.map(([id]) => id)).toEqual([
      "50_FR",
      "100_FR",
      "1000_FR",
    ]);
  });
  it("female is the default while both sexes exclude mixed and unknown genders", () => {
    const race = {
      relay: false,
      course: "SCY",
      event: "100_FR",
      date: "2026-01-01",
      gender: "M",
    } as Race;
    expect(matches(race, initialFilters)).toBe(false);
    expect(matches(race, { ...initialFilters, genders: ["F", "M"] })).toBe(
      true,
    );
    expect(
      matches(
        { ...race, gender: "X" },
        { ...initialFilters, genders: ["F", "M"] },
      ),
    ).toBe(false);
  });
});

describe("relay result requests", () => {
  it("supports individual race detail lookups and relay rankings", () => {
    expect(
      parseTimesQuery(new URLSearchParams("view=race&raceId=relay-a")).input,
    ).toMatchObject({ raceId: "relay-a" });
    expect(
      parseTimesQuery(
        new URLSearchParams(
          "view=rankings&relay=true&genders=X&mode=performances",
        ),
      ).input,
    ).toMatchObject({ relay: true, genders: ["X"], mode: "performances" });
  });
});
