import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  in: vi.fn(),
  countAbortSignal: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  browserClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));
vi.mock("@/lib/update-safety", () => ({
  withUpdateHold: (fn: () => Promise<unknown>) => fn(),
}));
import {
  loadAccountAthletes,
  saveAccountAthletes,
  searchAccountAthletes,
  cachedAccountAthletes,
} from "@/lib/account-athletes";

const swimmer = {
  id: "a",
  name: "Alex Swimmer",
  teamName: "Velocity Swimming",
  swimCount: 1234,
};
const favorite = {
  id: "b",
  name: "Jordan Swimmer",
  teamName: null,
  swimCount: 0,
};
const rows = [
  {
    id: "a",
    name: swimmer.name,
    team_name: swimmer.teamName,
    is_primary: true,
  },
  { id: "b", name: favorite.name, team_name: null, is_primary: false },
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.rpc.mockResolvedValue({ data: rows, error: null });
  const counts = {
    data: [
      { id: "a", public_swims: [{ count: 1234 }] },
      { id: "b", public_swims: [{ count: 0 }] },
    ],
    error: null,
  };
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.select.mockReturnValue({ in: mocks.in });
  mocks.in.mockReturnValue(
    Object.assign(Promise.resolve(counts), {
      abortSignal: mocks.countAbortSignal,
    }),
  );
  mocks.countAbortSignal.mockResolvedValue(counts);
});

it("loads account-specific primary and favorite athletes", async () => {
  await expect(loadAccountAthletes("owner")).resolves.toEqual({
    primaryAthlete: swimmer,
    favoriteAthletes: [favorite],
  });
  expect(mocks.rpc).toHaveBeenCalledWith("get_account_athletes", {
    account_user_id: "owner",
  });
  expect(mocks.from).toHaveBeenCalledWith("public_athletes");
  expect(mocks.select).toHaveBeenCalledWith("id, public_swims(count)");
  expect(mocks.in).toHaveBeenCalledExactlyOnceWith("id", ["a", "b"]);
});

it("keeps return-visit snapshots account-scoped and replaces them after a successful save", async () => {
  const saved = await loadAccountAthletes("loading-owner");
  expect(cachedAccountAthletes("loading-owner")).toEqual(saved);
  expect(cachedAccountAthletes("another-loading-owner")).toBeUndefined();
  mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("offline") });
  await expect(loadAccountAthletes("loading-owner")).rejects.toThrow("offline");
  expect(cachedAccountAthletes("loading-owner")).toEqual(saved);
  mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
  await saveAccountAthletes("loading-owner", {
    primaryAthlete: null,
    favoriteAthletes: [],
  });
  expect(cachedAccountAthletes("loading-owner")).toEqual({
    primaryAthlete: null,
    favoriteAthletes: [],
  });
});

it("returns an empty selection only for a successful empty read", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
  await expect(loadAccountAthletes("owner")).resolves.toEqual({
    primaryAthlete: null,
    favoriteAthletes: [],
  });
  mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("offline") });
  await expect(loadAccountAthletes("owner")).rejects.toThrow("offline");
  expect(mocks.from).not.toHaveBeenCalled();
});

it("keeps unknown counts distinct from zero when an athlete is no longer visible", async () => {
  mocks.in.mockResolvedValueOnce({
    data: [{ id: "b", public_swims: [{ count: 0 }] }],
    error: null,
  });
  await expect(loadAccountAthletes("owner")).resolves.toEqual({
    primaryAthlete: { ...swimmer, swimCount: null },
    favoriteAthletes: [favorite],
  });
});

it("keeps selections readable and saved when the optional count query fails", async () => {
  const unavailable = { data: null, error: new Error("count unavailable") };
  mocks.in.mockResolvedValue(unavailable);
  const expected = {
    primaryAthlete: { ...swimmer, swimCount: null },
    favoriteAthletes: [{ ...favorite, swimCount: null }],
  };
  await expect(loadAccountAthletes("owner")).resolves.toEqual(expected);
  await expect(saveAccountAthletes("owner", expected)).resolves.toEqual(
    expected,
  );
  expect(cachedAccountAthletes("owner")).toEqual(expected);
});

it("saves stable IDs and uses canonical returned names instead of draft labels", async () => {
  await expect(
    saveAccountAthletes("owner", {
      primaryAthlete: { ...swimmer, name: "Edited label" },
      favoriteAthletes: [favorite],
    }),
  ).resolves.toEqual({ primaryAthlete: swimmer, favoriteAthletes: [favorite] });
  expect(mocks.rpc).toHaveBeenCalledWith("save_account_athletes", {
    account_user_id: "owner",
    primary_id: "a",
    favorite_ids: ["b"],
  });
});

it("rejects duplicate favorites and overlap with the primary before writing", async () => {
  for (const favoriteAthletes of [[favorite, favorite], [swimmer]]) {
    await expect(
      saveAccountAthletes("owner", {
        primaryAthlete: swimmer,
        favoriteAthletes,
      }),
    ).rejects.toThrow("distinct favorites");
  }
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("supports clearing all selections and preserves retryable save failures", async () => {
  const empty = { primaryAthlete: null, favoriteAthletes: [] };
  mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("offline") });
  await expect(saveAccountAthletes("owner", empty)).rejects.toThrow("offline");
  mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
  await expect(saveAccountAthletes("owner", empty)).resolves.toEqual(empty);
  expect(mocks.rpc).toHaveBeenLastCalledWith("save_account_athletes", {
    account_user_id: "owner",
    primary_id: undefined,
    favorite_ids: [],
  });
});

it("bounds search and propagates cancellation to the backend", async () => {
  await expect(searchAccountAthletes(" a ")).resolves.toEqual([]);
  await expect(searchAccountAthletes("x".repeat(101))).rejects.toThrow("100");
  expect(mocks.rpc).not.toHaveBeenCalled();
  const controller = new AbortController();
  const abortSignal = vi.fn().mockResolvedValue({ data: rows, error: null });
  mocks.rpc.mockReturnValueOnce({ abortSignal });
  await expect(
    searchAccountAthletes(" Alex ", controller.signal),
  ).resolves.toEqual([swimmer, favorite]);
  expect(mocks.rpc).toHaveBeenCalledWith("search_account_athletes", {
    search_text: "Alex",
  });
  expect(abortSignal).toHaveBeenCalledWith(controller.signal);
  expect(mocks.countAbortSignal).toHaveBeenCalledWith(controller.signal);
});

it("preserves search matches when count loading fails", async () => {
  mocks.in.mockRejectedValueOnce(new Error("count connection unavailable"));
  await expect(searchAccountAthletes("Alex")).resolves.toEqual([
    { ...swimmer, swimCount: null },
    { ...favorite, swimCount: null },
  ]);
});
