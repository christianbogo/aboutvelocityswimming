import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  watchTimes,
  type TimesReadState,
} from "@/components/collection/watch-times";
import {
  clearTimesCache,
  timesCache,
} from "@/components/collection/times-cache";
import {
  timesRefreshDelay,
  timesRetryDelay,
} from "@/features/swimming/domain/cache-policy";

const fetchMock = vi.fn();
let doc: EventTarget & { visibilityState: string };
let stop: (() => void) | undefined;
const url = "/api/times?view=rankings";
const success = (total = 1) =>
  Response.json({ rows: [], total, expiresAt: Date.now() + 60000 });
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(120001);
  vi.spyOn(Math, "random").mockReturnValue(0);
  vi.stubGlobal("window", new EventTarget());
  doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", doc);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  clearTimesCache();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function visibility(value: string) {
  doc.visibilityState = value;
  doc.dispatchEvent(new Event("visibilitychange"));
}
it("pauses all polling while hidden and refreshes after returning to a visible tab", async () => {
  fetchMock.mockImplementation(() => Promise.resolve(success()));
  const changed = vi.fn();
  stop = watchTimes(url, url, changed, vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  visibility("hidden");
  await vi.advanceTimersByTimeAsync(600000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  visibility("visible");
  await vi.advanceTimersByTimeAsync(249);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("does not start a read for a hidden tab", async () => {
  visibility("hidden");
  fetchMock.mockImplementation(() => Promise.resolve(success()));
  stop = watchTimes(url, url, vi.fn(), vi.fn());
  await vi.advanceTimersByTimeAsync(600000);
  expect(fetchMock).not.toHaveBeenCalled();
  visibility("visible");
  await vi.advanceTimersByTimeAsync(250);
  expect(fetchMock).toHaveBeenCalledOnce();
});
it("keeps same-query results during a failed refresh and recovers with backoff", async () => {
  fetchMock
    .mockImplementationOnce(() => Promise.resolve(success()))
    .mockResolvedValueOnce(Response.json({}, { status: 503 }))
    .mockResolvedValueOnce(Response.json({}, { status: 503 }))
    .mockImplementationOnce(() => Promise.resolve(success(2)));
  const changes: TimesReadState[] = [];
  stop = watchTimes(url, url, (state) => changes.push(state), vi.fn());
  await vi.advanceTimersByTimeAsync(63000);
  expect(changes.at(-1)?.data?.total).toBe(1);
  expect(changes.at(-1)?.error).toContain("couldn’t load");
  await vi.advanceTimersByTimeAsync(4999);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(changes.at(-1)?.data?.total).toBe(2);
  expect(changes.at(-1)?.error).toBe("");
});
it("drops prior results after an authorization failure instead of retaining them", async () => {
  fetchMock
    .mockImplementationOnce(() => Promise.resolve(success()))
    .mockResolvedValueOnce(Response.json({}, { status: 401 }));
  const changed = vi.fn();
  stop = watchTimes(url, url, changed, vi.fn());
  await vi.advanceTimersByTimeAsync(62000);
  expect(changed.mock.lastCall?.[0].data).toBeNull();
  expect(timesCache.has(url)).toBe(false);
  await vi.advanceTimersByTimeAsync(300000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("discards an in-flight result when a write explicitly invalidates results", async () => {
  let finish!: (value: Response) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const changed = vi.fn(),
    invalidated = vi.fn();
  stop = watchTimes(url, url, changed, invalidated);
  clearTimesCache();
  finish(success());
  await vi.advanceTimersByTimeAsync(0);
  expect(invalidated).toHaveBeenCalledOnce();
  expect(changed).not.toHaveBeenCalled();
  expect(timesCache.size).toBe(0);
});
it("spreads refreshes and caps recovery delays even with old server responses", () => {
  expect(timesRefreshDelay(0, 120001, 0)).toBe(3000);
  expect(timesRefreshDelay(180001, 120001, 0.9)).toBe(71000);
  expect(timesRetryDelay(1, 0)).toBe(5000);
  expect(timesRetryDelay(100, 0)).toBe(60000);
});

it("cancels a short pending retry as soon as the tab is hidden", async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json({}, { status: 503 }))
    .mockImplementation(() => Promise.resolve(success()));
  const changed = vi.fn();
  stop = watchTimes(url, url, changed, vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).toHaveBeenCalledOnce();
  visibility("hidden");
  await vi.advanceTimersByTimeAsync(600000);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(changed).not.toHaveBeenCalled();
  visibility("visible");
  await vi.advanceTimersByTimeAsync(250);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(changed.mock.lastCall?.[0].data?.total).toBe(1);
});
