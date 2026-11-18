import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  serverClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
    from: mocks.from,
  }),
}));

import { GET } from "@/app/api/times/team-map/route";
import { parseTeamMapQuery } from "@/lib/team-map/server";

type Row = Record<string, unknown>;
type Filter = { method: string; field: string; value: unknown };
interface Query {
  table: string;
  columns: string;
  options?: { count?: string };
  filters: Filter[];
  start: number;
  end: number;
  order: string;
  signal?: AbortSignal;
}

let queries: Query[];
let records: Record<string, Row[]>;
let pageCap: number;
let failure: { table: string; start: number; code?: string } | null;
let nullCounts: boolean;

function nested(row: Row, field: string) {
  return field
    .split(".")
    .reduce<unknown>(
      (value, part) =>
        value && typeof value === "object" ? (value as Row)[part] : undefined,
      row,
    );
}

function queryResult(query: Query) {
  queries.push({ ...query, filters: [...query.filters] });
  if (failure?.table === query.table && failure.start === query.start)
    return {
      data: null,
      error: {
        code: failure.code ?? "XX000",
        message: "private database detail",
      },
      count: null,
    };
  const rows = [...(records[query.table] ?? [])]
    .filter((row) =>
      query.filters.every((filter) => {
        const value = nested(row, filter.field);
        switch (filter.method) {
          case "eq":
          case "is":
            return value === filter.value;
          case "in":
            return (filter.value as unknown[]).includes(value);
          case "gt":
            return typeof value === "number" && value > Number(filter.value);
          case "lt":
            return typeof value === "string" && value < String(filter.value);
          default:
            throw new Error(`Unsupported query filter ${filter.method}`);
        }
      }),
    )
    .sort((a, b) =>
      String(a[query.order]).localeCompare(String(b[query.order])),
    );
  return {
    data: rows.slice(
      query.start,
      Math.min(query.end + 1, query.start + pageCap),
    ),
    error: null,
    count: nullCounts ? null : rows.length,
  };
}

function fakeQuery(table: string) {
  const query: Query = {
    table,
    columns: "",
    filters: [],
    start: 0,
    end: 999,
    order: "id",
  };
  const builder = {
    select(columns: string, options?: { count?: string }) {
      query.columns = columns;
      query.options = options;
      return builder;
    },
    eq(field: string, value: unknown) {
      query.filters.push({ method: "eq", field, value });
      return builder;
    },
    is(field: string, value: unknown) {
      query.filters.push({ method: "is", field, value });
      return builder;
    },
    in(field: string, value: unknown) {
      query.filters.push({ method: "in", field, value });
      return builder;
    },
    gt(field: string, value: unknown) {
      query.filters.push({ method: "gt", field, value });
      return builder;
    },
    lt(field: string, value: unknown) {
      query.filters.push({ method: "lt", field, value });
      return builder;
    },
    order(field: string) {
      query.order = field;
      return builder;
    },
    range(start: number, end: number) {
      query.start = start;
      query.end = end;
      return builder;
    },
    abortSignal(signal: AbortSignal) {
      query.signal = signal;
      return builder;
    },
    then(
      onfulfilled: (value: ReturnType<typeof queryResult>) => unknown,
      onrejected?: (error: unknown) => unknown,
    ) {
      return Promise.resolve(queryResult(query)).then(onfulfilled, onrejected);
    },
  };
  return builder;
}

function member(id: string, athleteId: string | null, extra: Row = {}): Row {
  return {
    id,
    full_name: `Athlete ${id}`,
    training_group: "Senior",
    times_athlete_id: athleteId,
    is_archived: false,
    workshare_accounts: { is_archived: false },
    emails: ["private-parent@example.test"],
    familyName: "Private Family",
    ...extra,
  };
}

function swim(id: string, athleteId: string, extra: Row = {}): Row {
  return {
    id,
    athlete_id: athleteId,
    swim_date: "2026-03-15",
    times_course: "SCY",
    times_event: "100_FR",
    times_time: 60000,
    times_gender: "F",
    times_age: 13,
    times_official: true,
    times_meet: "meet",
    times_meet_name: "Meet",
    times_status: "OK",
    times_team: "velocity-swimming",
    times_relay: false,
    times_leg: null,
    times_split: false,
    ...extra,
  };
}

function request(search = "") {
  return new Request(`https://velocity.example/api/times/team-map${search}`);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-19T01:00:00Z"));
  vi.clearAllMocks();
  queries = [];
  records = {
    workshare_athletes: [],
    unflagged_times_swims: [],
    standards: [],
  };
  pageCap = 1000;
  failure = null;
  nullCounts = false;
  mocks.from.mockImplementation(fakeQuery);
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "staff-user" } },
    error: null,
  });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});

afterEach(() => vi.useRealTimers());

describe("Team Map access and query boundary", () => {
  it("rejects signed-out and nonstaff reads before touching roster data", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await GET(request())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    const denied = await GET(request());
    expect(denied.status).toBe(403);
    expect(denied.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each([
    "?year=2027",
    "?year=1899",
    "?year=2026.5",
    "?year=invalid",
    "?course=all",
    "?course=SCY%27",
  ])("rejects invalid selection %s without a database read", async (search) => {
    const response = await GET(request(search));
    expect(response.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("defaults to the Pacific calendar year and accepts only known selection fields", () => {
    expect(
      parseTeamMapQuery(new URLSearchParams("team=another-club"), "2026-11-18"),
    ).toEqual({ year: 2026, course: "", asOf: "2026-11-18" });
    expect(
      parseTeamMapQuery(
        new URLSearchParams("year=1900&course=LCM"),
        "2026-11-18",
      ),
    ).toMatchObject({ year: 1900, course: "LCM" });
  });
});

describe("complete, private Team Map reads", () => {
  it("filters archived roster rows, deduplicates links, and never returns account contacts", async () => {
    records.workshare_athletes = [
      member("r1", "a1"),
      member("r2", "a1", { training_group: "Prep" }),
      member("r3", "a2"),
      member("r4", null),
      member("r5", "a3", { is_archived: true }),
      member("r6", "a4", { workshare_accounts: { is_archived: true } }),
    ];
    records.unflagged_times_swims = [
      swim("s1", "a1"),
      swim("s2", "a2"),
      swim("excluded-future", "a1", { swim_date: "2026-11-19" }),
      swim("excluded-team", "a1", { times_team: "another-club" }),
      swim("excluded-split", "a1", { times_split: true }),
      swim("excluded-dq", "a1", { times_status: "DQ" }),
      swim("excluded-relay", "a1", { times_relay: true }),
      swim("excluded-leg", "a1", { times_leg: 2 }),
      swim("excluded-roster", "a3"),
    ];
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await response.json();
    expect(body.data).toMatchObject({
      asOf: "2026-11-18",
      year: 2026,
      course: "",
      coverage: {
        rosterEntries: 4,
        linkedAthletes: 2,
        duplicateLinks: 1,
        unlinkedEntries: 1,
        validSwims: 2,
      },
    });
    expect(JSON.stringify(body)).not.toMatch(
      /private-parent|Private Family|emails|full_name|times_athlete_id/,
    );
    const rosterQuery = queries.find(
      (query) => query.table === "workshare_athletes",
    )!;
    expect(rosterQuery.columns).toBe(
      "id,full_name,training_group,times_athlete_id,workshare_accounts!inner(is_archived)",
    );
    const swimQuery = queries.find(
      (query) => query.table === "unflagged_times_swims",
    )!;
    expect(swimQuery.filters).toContainEqual({
      method: "in",
      field: "athlete_id",
      value: ["a1", "a2"],
    });
    expect(swimQuery.columns.split(",")).not.toContain("data");
    expect(queries.every((query) => query.signal instanceof AbortSignal)).toBe(
      true,
    );
  });

  it("exhausts capped pages for roster, standards, and swims instead of treating a short page as complete", async () => {
    pageCap = 2;
    records.workshare_athletes = Array.from({ length: 5 }, (_, index) =>
      member(`r${index}`, `a${index}`),
    );
    records.unflagged_times_swims = Array.from({ length: 5 }, (_, index) =>
      swim(`s${index}`, `a${index}`),
    );
    records.standards = Array.from({ length: 5 }, (_, index) => ({
      id: `std${index}`,
      data: {
        id: `std${index}`,
        name: "Non-motivational fixture",
        category: "championship",
        cuts: {},
        governingBody: "USA_Swimming",
        seasonYears: "2026",
        effectiveDate: "2026-01-01",
        expirationDate: "2026-12-31",
      },
    }));
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.coverage).toMatchObject({
      rosterEntries: 5,
      linkedAthletes: 5,
      validSwims: 5,
    });
    for (const table of [
      "workshare_athletes",
      "standards",
      "unflagged_times_swims",
    ])
      expect(
        queries
          .filter((query) => query.table === table)
          .map((query) => query.start),
      ).toEqual([0, 2, 4]);
  });

  it("bounds ID batches, applies course filters, and includes the entire as-of day", async () => {
    records.workshare_athletes = Array.from({ length: 101 }, (_, index) =>
      member(`r${String(index).padStart(3, "0")}`, `a${index}`),
    );
    records.unflagged_times_swims = [
      swim("today", "a0", {
        swim_date: "2026-11-18T23:59:00",
        times_course: "LCM",
      }),
      swim("wrong-course", "a0"),
      swim("tomorrow", "a0", { swim_date: "2026-11-19", times_course: "LCM" }),
    ];
    const response = await GET(request("?course=LCM&year=2025"));
    expect(response.status).toBe(200);
    expect((await response.json()).data.coverage.validSwims).toBe(1);
    const batches = queries.filter(
      (query) => query.table === "unflagged_times_swims",
    );
    expect(batches).toHaveLength(3);
    expect(
      batches.map(
        (query) =>
          (
            query.filters.find((filter) => filter.method === "in")!
              .value as string[]
          ).length,
      ),
    ).toEqual([50, 50, 1]);
    expect(
      batches.every((query) =>
        query.filters.some(
          (filter) => filter.field === "times_course" && filter.value === "LCM",
        ),
      ),
    ).toBe(true);
  });

  it("does not fetch swims when every active roster entry is unlinked", async () => {
    records.workshare_athletes = [member("unlinked", null)];
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.json()).data.coverage).toMatchObject({
      linkedAthletes: 0,
      unlinkedEntries: 1,
      validSwims: 0,
    });
    expect(
      queries.some((query) => query.table === "unflagged_times_swims"),
    ).toBe(false);
  });

  it("fails the whole read when a later page fails instead of publishing partial totals", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    pageCap = 2;
    records.workshare_athletes = [member("r1", "a1")];
    records.unflagged_times_swims = Array.from({ length: 4 }, (_, index) =>
      swim(`s${index}`, "a1"),
    );
    failure = { table: "unflagged_times_swims", start: 2 };
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Team Map is unavailable. Please try again.",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    vi.restoreAllMocks();
  });

  it("refuses to label unconfirmed row coverage complete", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    nullCounts = true;
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("data");
    vi.restoreAllMocks();
  });
});
