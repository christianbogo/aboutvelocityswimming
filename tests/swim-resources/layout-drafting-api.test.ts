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

import { GET } from "@/app/api/times/layout-drafting/route";

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
    .replace("->>", ".")
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
    training_group: "Seniors",
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
  return new Request(
    `https://velocity.example/api/times/layout-drafting${search}`,
  );
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
    data: {
      user: {
        id: "staff-user",
        email: "christiancutter02@gmail.com",
        email_confirmed_at: "2026-01-01",
      },
    },
    error: null,
  });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});

afterEach(() => vi.useRealTimers());

describe("Layout Drafting private inventory", () => {
  it("authenticates the verified owner and database staff role before reading", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await GET(request())).status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    for (const user of [
      { email: "coach@example.test", email_confirmed_at: "2026-01-01" },
      { email: "christiancutter02@gmail.com", email_confirmed_at: null },
      {
        email: "christiancutter02@gmail.com",
        email_confirmed_at: "2026-01-01",
        is_anonymous: true,
      },
    ]) {
      mocks.getUser.mockResolvedValueOnce({ data: { user }, error: null });
      expect((await GET(request())).status).toBe(403);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("reads only active competitive accounts and retains athletes without swims or a link", async () => {
    records.workshare_athletes = [
      member("r1", "a1"),
      member("r2", "a1", { training_group: "Prep" }),
      member("r3", "a2", { training_group: "Age Groupers" }),
      member("r4", null, { training_group: "Juniors" }),
      member("r5", "archived", { is_archived: true }),
      member("r6", "archived-account", {
        workshare_accounts: { is_archived: true },
      }),
      member("r7", "rec", { training_group: "Rec Team" }),
      member("r8", "masters", { training_group: "Masters" }),
    ];
    records.unflagged_times_swims = [
      swim("s1", "a1"),
      swim("s2", "a1", { times_team: "prior-club" }),
      swim("excluded-future", "a1", { swim_date: "2026-11-19" }),
      swim("excluded-dq", "a1", { times_status: "DQ" }),
      swim("excluded-split", "a1", { times_split: true }),
      swim("excluded-leg", "a1", { times_leg: 2 }),
      swim("excluded-relay", "a1", { times_relay: true }),
      swim("excluded-rec", "rec"),
    ];
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.data).toMatchObject({
      asOf: "2026-11-18",
      coverage: {
        rosterEntries: 4,
        linkedAthletes: 2,
        unlinkedEntries: 1,
        duplicateLinks: 1,
        athletesWithSwims: 1,
        validSwims: 2,
        missingStandardsSwims: 2,
      },
    });
    expect(body.data.athletes).toHaveLength(3);
    expect(body.data.athletes[0].trainingGroups).toEqual(["Prep", "Seniors"]);
    expect(JSON.stringify(body)).not.toMatch(
      /private-parent|Private Family|emails|full_name|times_athlete_id/,
    );
    expect(
      queries
        .find((query) => query.table === "unflagged_times_swims")
        ?.columns.split(","),
    ).not.toContain("data");
    expect(queries.every((query) => query.signal instanceof AbortSignal)).toBe(
      true,
    );
  });

  it("exhausts short pages and keeps groups with no results", async () => {
    pageCap = 2;
    records.workshare_athletes = Array.from({ length: 5 }, (_, i) =>
      member(`r${i}`, `a${i}`),
    );
    records.unflagged_times_swims = Array.from({ length: 5 }, (_, i) =>
      swim(`s${i}`, `a${i}`),
    );
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.json()).data.coverage.validSwims).toBe(5);
    for (const table of ["workshare_athletes", "unflagged_times_swims"])
      expect(
        queries
          .filter((query) => query.table === table)
          .map((query) => query.start),
      ).toEqual([0, 2, 4]);
  });

  it("does not return partial plans when a later page fails or counts are unavailable", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    pageCap = 2;
    records.workshare_athletes = [member("r1", "a1")];
    records.unflagged_times_swims = Array.from({ length: 4 }, (_, i) =>
      swim(`s${i}`, "a1"),
    );
    failure = { table: "unflagged_times_swims", start: 2 };
    let response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Layout Drafting is unavailable. Please try again.",
    });
    failure = null;
    nullCounts = true;
    response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("data");
    log.mockRestore();
  });
});
