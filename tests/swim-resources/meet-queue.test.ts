import { describe, expect, it } from "vitest";
import { parseMeetQueueQuery } from "../../src/lib/collection/meet-queue";

describe("meet inventory filters", () => {
  it("preserves catalog filters and pagination", () => {
    expect(parseMeetQueueQuery(new URLSearchParams("search=%25_FIX&year=1988&team=team-one&ies=confirmed&progress=prepared&offset=30"))).toMatchObject({ search: "%_FIX", year: 1988, team: "team-one", ies: "confirmed", progress: "prepared", offset: 30 });
    expect(parseMeetQueueQuery(new URLSearchParams("selected=false&offset=60"))).toMatchObject({ selected: false, offset: 60 });
  });
  it("rejects invalid filters", () => {
    for (const value of ["year=1888", "offset=-1", "team=../other", "ies=yes", "category=canceled", "selected=1", "progress=done"]) expect(() => parseMeetQueueQuery(new URLSearchParams(value))).toThrow();
  });
});
