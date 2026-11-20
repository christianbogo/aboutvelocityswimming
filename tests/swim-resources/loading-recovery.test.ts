import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadTimes } from "@/components/collection/load-times";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const response = (status: number, body: object) =>
  Response.json(body, { status });

it("recovers a temporary results failure without requiring a second user action", async () => {
  fetchMock
    .mockResolvedValueOnce(response(503, { error: "temporarily unavailable" }))
    .mockResolvedValueOnce(response(200, { rows: [], expiresAt: 180000 }));
  const loaded = loadTimes(
    "/api/times?view=rankings&search=private-search",
    new AbortController().signal,
  );
  await vi.advanceTimersByTimeAsync(1000);
  expect(await loaded).toEqual({ rows: [], expiresAt: 180000 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(
    "private-search",
  );
  expect(fetchMock.mock.calls[0][1].headers["X-Request-ID"]).toMatch(
    /^[a-f0-9-]{36}$/,
  );
});
it.each([401, 403, 400])(
  "does not retry a %s results response",
  async (status) => {
    fetchMock.mockResolvedValue(response(status, { error: "denied" }));
    await expect(
      loadTimes("/api/times?view=rankings", new AbortController().signal),
    ).rejects.toThrow("couldn’t load");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  },
);
it("stops after two failed results reads", async () => {
  fetchMock.mockResolvedValue(response(503, {}));
  const failed = expect(
    loadTimes("/api/times?view=rankings", new AbortController().signal),
  ).rejects.toThrow("couldn’t load");
  await vi.advanceTimersByTimeAsync(1000);
  await failed;
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("cancels a pending retry when the user leaves or changes filters", async () => {
  const controller = new AbortController();
  fetchMock.mockResolvedValue(response(503, {}));
  const failed = expect(
    loadTimes("/api/times?view=rankings", controller.signal),
  ).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(100);
  controller.abort();
  await failed;
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("shares a pending read without letting one cancelled consumer cancel another", async () => {
  let finish!: (value: Response) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = new AbortController();
  const second = new AbortController();
  const cancelled = expect(
    loadTimes("/api/times?view=rankings", first.signal),
  ).rejects.toThrow();
  const loaded = loadTimes("/api/times?view=rankings", second.signal);
  first.abort();
  await cancelled;
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
  finish(response(200, { rows: [], expiresAt: 180000 }));
  expect(await loaded).toEqual({ rows: [], expiresAt: 180000 });
});
it("honors a bounded Retry-After before retrying", async () => {
  fetchMock
    .mockResolvedValueOnce(
      Response.json({}, { status: 503, headers: { "Retry-After": "5" } }),
    )
    .mockResolvedValueOnce(response(200, { rows: [], expiresAt: 180000 }));
  const loaded = loadTimes(
    "/api/times?view=rankings",
    new AbortController().signal,
  );
  await vi.advanceTimersByTimeAsync(4999);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await loaded;
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
