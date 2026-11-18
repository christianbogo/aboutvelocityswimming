import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  browserClient: () => ({ rpc: mocks.rpc }),
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
};
const favorite = { id: "b", name: "Jordan Swimmer", teamName: null };
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
});

it("loads account-specific primary and favorite athletes", async () => {
  await expect(loadAccountAthletes("owner")).resolves.toEqual({
    primaryAthlete: swimmer,
    favoriteAthletes: [favorite],
  });
  expect(mocks.rpc).toHaveBeenCalledWith("get_account_athletes", {
    account_user_id: "owner",
  });
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
});
