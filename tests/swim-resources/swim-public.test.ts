import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  browserClient: () => ({ from: mocks.from }),
}));
import { loadPublicAthleteBests, loadPublicStandards } from "@/lib/swim-public";

beforeEach(() => vi.resetAllMocks());
function result(data: unknown, error: unknown = null) {
  const query = {
    then: (resolve: (value: unknown) => void) =>
      Promise.resolve({ data, error }).then(resolve),
  };
  return Object.assign(
    query,
    Object.fromEntries(
      [
        "select",
        "contains",
        "order",
        "limit",
        "abortSignal",
        "maybeSingle",
        "eq",
      ].map((name) => [name, vi.fn(() => query)]),
    ),
  );
}
it("loads an exact public alias then that athlete's bests without private athlete reads", async () => {
  const athlete = result({
    id: "athlete-1",
    data: {
      name: { first: "Avery", last: "Swimmer" },
      aliases: ["Avery Swimmer"],
    },
  });
  const bests = result([{ data: { eventCode: "100_FR_SCY", timeMs: 60000 } }]);
  mocks.from.mockReturnValueOnce(athlete).mockReturnValueOnce(bests);
  const signal = new AbortController().signal;
  expect(await loadPublicAthleteBests("Avery Swimmer", signal)).toEqual({
    athlete: {
      id: "athlete-1",
      name: { first: "Avery", last: "Swimmer" },
      aliases: ["Avery Swimmer"],
    },
    bests: [{ eventCode: "100_FR_SCY", timeMs: 60000 }],
  });
  expect(mocks.from.mock.calls).toEqual([
    ["public_athletes"],
    ["athlete_bests"],
  ]);
  expect(athlete.contains).toHaveBeenCalledWith("data", {
    aliases: ["Avery Swimmer"],
  });
  expect(bests.eq).toHaveBeenCalledWith("athlete_id", "athlete-1");
  expect(athlete.abortSignal).toHaveBeenCalledWith(signal);
  expect(bests.abortSignal).toHaveBeenCalledWith(signal);
});
it("returns an empty profile without a second query when the alias is absent", async () => {
  mocks.from.mockReturnValue(result(null));
  expect(
    await loadPublicAthleteBests(
      "Missing Swimmer",
      new AbortController().signal,
    ),
  ).toEqual({ athlete: null, bests: [] });
  expect(mocks.from).toHaveBeenCalledOnce();
});
it("loads standards directly and surfaces provider errors", async () => {
  const signal = new AbortController().signal;
  mocks.from.mockReturnValueOnce(
    result([{ id: "standard-1", data: { name: "Current standard" } }]),
  );
  expect(await loadPublicStandards(signal)).toEqual([
    { id: "standard-1", name: "Current standard" },
  ]);
  mocks.from.mockReturnValueOnce(result(null, new Error("Unavailable")));
  await expect(loadPublicStandards(signal)).rejects.toThrow("Unavailable");
});
