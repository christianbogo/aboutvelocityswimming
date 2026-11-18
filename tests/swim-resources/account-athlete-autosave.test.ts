import { describe, expect, it, vi } from "vitest";
import { createAthleteAutosave } from "@/components/shared/AccountAthletes";
import type { AccountAthletePreferences } from "@/lib/account-athletes";

const athlete = (id: string) => ({ id, name: id, teamName: null });
const selection = (...ids: string[]): AccountAthletePreferences => ({
  primaryAthlete: null,
  favoriteAthletes: ids.map(athlete),
});

function deferred() {
  let resolve!: (value: AccountAthletePreferences) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<AccountAthletePreferences>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("athlete following autosave", () => {
  it("serializes writes and preserves the latest selections during a slower save", async () => {
    const first = deferred();
    const last = deferred();
    const persist = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(last.promise);
    const onState = vi.fn();
    const autosave = createAthleteAutosave(selection(), persist, onState);
    autosave.change(selection("Avery"));
    autosave.change(selection("Avery", "Blake"));
    autosave.change(selection("Blake", "Casey"));
    expect(persist).toHaveBeenCalledTimes(1);
    first.resolve(selection("Avery"));
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(2));
    expect(persist).toHaveBeenLastCalledWith(selection("Blake", "Casey"));
    expect(onState).not.toHaveBeenCalledWith({
      draft: selection("Avery"),
      status: "saved",
    });
    last.resolve(selection("Blake", "Casey"));
    await vi.waitFor(() =>
      expect(onState).toHaveBeenLastCalledWith({
        draft: selection("Blake", "Casey"),
        status: "saved",
      }),
    );
  });

  it("persists a removal that returns to the original selection while an addition is saving", async () => {
    const pending = deferred();
    const persist = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(selection());
    const onState = vi.fn();
    const autosave = createAthleteAutosave(selection(), persist, onState);
    autosave.change(selection("Avery"));
    autosave.change(selection());
    pending.resolve(selection("Avery"));
    await vi.waitFor(() =>
      expect(onState).toHaveBeenLastCalledWith({
        draft: selection(),
        status: "saved",
      }),
    );
    expect(persist).toHaveBeenNthCalledWith(2, selection());
  });

  it("keeps failed selections visible and retries them without another edit", async () => {
    const persist = vi
      .fn()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(selection("Avery"));
    const onState = vi.fn();
    const autosave = createAthleteAutosave(selection(), persist, onState);
    autosave.change(selection("Avery"));
    await vi.waitFor(() =>
      expect(onState).toHaveBeenLastCalledWith({
        draft: selection("Avery"),
        status: "error",
      }),
    );
    autosave.retry();
    await vi.waitFor(() =>
      expect(onState).toHaveBeenLastCalledWith({
        draft: selection("Avery"),
        status: "saved",
      }),
    );
    expect(persist).toHaveBeenNthCalledWith(2, selection("Avery"));
  });

  it("saves the latest queued edit if an earlier request fails", async () => {
    const pending = deferred();
    const persist = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(selection("Blake"));
    const onState = vi.fn();
    const autosave = createAthleteAutosave(selection(), persist, onState);
    autosave.change(selection("Avery"));
    autosave.change(selection("Blake"));
    pending.reject(new Error("connection lost"));
    await vi.waitFor(() =>
      expect(onState).toHaveBeenLastCalledWith({
        draft: selection("Blake"),
        status: "saved",
      }),
    );
    expect(persist).toHaveBeenNthCalledWith(2, selection("Blake"));
    expect(onState.mock.calls.some(([state]) => state.status === "error")).toBe(
      false,
    );
  });
});
