import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  client: vi.fn(),
  cache: new Map<string, unknown>(),
  revalidate: vi.fn(),
  reader: null as null | ((...args: unknown[]) => Promise<unknown>),
}));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.client }));
vi.mock("next/cache", () => ({
  unstable_cache: (reader: (...args: unknown[]) => Promise<unknown>) => {
    mocks.reader = reader;
    return async (...args: unknown[]) => {
      const key = JSON.stringify(args);
      if (!mocks.cache.has(key)) mocks.cache.set(key, await reader(...args));
      return mocks.cache.get(key);
    };
  },
  revalidateTag: mocks.revalidate,
}));
import { readTimes, invalidateTimes } from "@/lib/times/server";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.cache.clear();
  mocks.revalidate.mockImplementation(() => mocks.cache.clear());
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://public-fixture.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
  mocks.client.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: { rows: [], total: 0 }, error: null });
  vi.spyOn(Date, "now").mockReturnValue(120001);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it("enforces Velocity scope even for direct server callers and shares their cache", async () => {
  await readTimes("rankings", { team: "other-club", course: "SCY" });
  await readTimes("rankings", { course: "SCY" });
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.rpc).toHaveBeenCalledWith("ies_times_query", {
    query_kind: "rankings",
    input: { team: "velocity-swimming", course: "SCY" },
  });
});
it("uses stable server keys and response-relative client freshness", async () => {
  const first = await readTimes("rankings", { genders: ["F"] });
  expect(first.expiresAt).toBe(180001);
  await readTimes("rankings", { genders: ["F"] });
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.client.mock.calls[0][2].auth).toEqual({
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  });
  vi.mocked(Date.now).mockReturnValue(180000);
  const later = await readTimes("rankings", { genders: ["F"] });
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(later.expiresAt).toBe(240000);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://another-fixture.supabase.co");
  await readTimes("rankings", { genders: ["F"] });
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  invalidateTimes();
  expect(mocks.revalidate).toHaveBeenCalledWith("ies-times", { expire: 0 });
});
it("does not save failed reads in the cache", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "57014" } });
  await expect(readTimes("facets", {})).rejects.toThrow();
  expect(mocks.cache.size).toBe(0);
  await readTimes("facets", {});
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
});
it("uses the recent results query for a date-ordered ranking page", async () => {
  const input = { mode: "recent", event: "100_FR", offset: 25 };
  await readTimes("rankings", input);
  expect(mocks.rpc).toHaveBeenCalledWith("ies_times_recent", {
    input: { ...input, team: "velocity-swimming" },
  });
});
it("loads personal bests and complete all-time ranks from the dedicated public query", async () => {
  await readTimes("my_times", {
    athleteId: "a",
    course: "SCY",
    startYear: "2024",
    endYear: "2025",
    rankPeriod: "all",
  });
  expect(mocks.rpc).toHaveBeenCalledWith("ies_my_times_all_time", {
    input: {
      team: "velocity-swimming",
      athleteId: "a",
      course: "SCY",
      startYear: "2024",
      endYear: "2025",
      rankPeriod: "all",
    },
  });
});
it("loads filtered bests without invoking the all-time cohort query", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: { personalBests: [] }, error: null });
  const input = { athleteId: "a", course: "SCY", ageAtSwim: 12 };
  expect(await readTimes("my_times_bests", input)).toEqual({
    personalBests: [],
    expiresAt: expect.any(Number),
  });
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.rpc).toHaveBeenCalledWith("ies_my_times_bests", {
    input: { ...input, team: "velocity-swimming" },
  });
});
it.each([
  ["ranking_years", "ies_times_ranking_years", { years: ["2026"] }],
  [
    "records_board",
    "ies_team_records_board",
    { records: {}, races: [], recordsUpdatedAt: null },
  ],
] as const)(
  "loads %s from its dedicated public query",
  async (view, rpc, data) => {
    mocks.rpc.mockResolvedValueOnce({ data, error: null });
    expect(await readTimes(view, {})).toEqual({
      ...data,
      expiresAt: expect.any(Number),
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(rpc, {
      input: { team: "velocity-swimming" },
    });
  },
);
it.each(["facets", "records"] as const)(
  "retains the legacy %s query for open clients",
  async (view) => {
    await readTimes(view, {});
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("ies_times_query", {
      query_kind: view,
      input: { team: "velocity-swimming" },
    });
  },
);
it("preserves the season RPC for clients opened before the all-time update", async () => {
  for (const rankPeriod of [undefined, "season"]) {
    await readTimes("my_times", { athleteId: "a", rankPeriod });
  }
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  expect(mocks.rpc.mock.calls.every(([name]) => name === "ies_my_times")).toBe(
    true,
  );
});

it("coalesces simultaneous cache misses into one database read", async () => {
  let finish!: (value: unknown) => void;
  mocks.rpc.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const reads = Array.from({ length: 8 }, () =>
    readTimes("rankings", { event: "100_FR" }),
  );
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  finish({ data: { rows: [], total: 0 }, error: null });
  await Promise.all(reads);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
});
it("does not let a pre-correction request repopulate the invalidated cache", async () => {
  let finishOld!: (value: unknown) => void;
  mocks.rpc.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  const old = readTimes("rankings", {});
  invalidateTimes();
  mocks.rpc.mockResolvedValueOnce({
    data: { rows: [], total: 2 },
    error: null,
  });
  const current = await readTimes("rankings", {});
  finishOld({ data: { rows: [], total: 1 }, error: null });
  expect((await old).total).toBe(2);
  expect(current.total).toBe(2);
  expect((await readTimes("rankings", {})).total).toBe(2);
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
});

it("also coalesces background revalidation callbacks from separate Next cache reads", async () => {
  let finish!: (value: unknown) => void;
  mocks.rpc.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const reads = Array.from({ length: 8 }, () =>
    mocks.reader!(
      "https://public-fixture.supabase.co",
      "public-test-key",
      "rankings",
      '{"team":"velocity-swimming"}',
    ),
  );
  expect(mocks.rpc).toHaveBeenCalledOnce();
  finish({ data: { rows: [], total: 0 }, error: null });
  await Promise.all(reads);
  expect(mocks.rpc).toHaveBeenCalledOnce();
});
