import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  approveImportSelection,
  createImportSelection,
  importIssuesPage,
  importQueuePage,
  resolveImportSwimmerMatch,
} from "@/components/collection/imports-review-api";

const selectionId = "a2a77c1d-5bde-4fa5-9d63-e0f678bd0b6e";
const selectionBody = JSON.stringify({ action: "approve", selectionId });
const receipt = {
  selected: 301,
  approved: 200,
  duplicates: 0,
  blocked: 0,
  remaining: 101,
  done: false,
  published: 100,
};
const fetchImport = vi.fn<typeof fetch>();
const unavailable = (retryable?: boolean) => Response.json(
  { error: "The import request could not be confirmed.", retryable },
  { status: 503 },
);

beforeEach(() => {
  vi.useFakeTimers();
  fetchImport.mockReset();
  vi.stubGlobal("fetch", fetchImport);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Velocity Imports client retries", () => {
  it("retries the same approval through a lost response and six backoff steps", async () => {
    fetchImport.mockRejectedValueOnce(new TypeError("Connection lost"));
    for (let attempt = 0; attempt < 5; attempt++) {
      fetchImport.mockImplementationOnce(async () => unavailable(true));
    }
    fetchImport.mockResolvedValueOnce(Response.json(receipt));
    const controller = new AbortController();
    const approval = approveImportSelection(selectionId, controller.signal);

    await vi.advanceTimersByTimeAsync(15_499);
    expect(fetchImport).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(1);
    await expect(approval).resolves.toEqual(receipt);
    expect(fetchImport).toHaveBeenCalledTimes(7);
    for (const [url, init] of fetchImport.mock.calls) {
      expect(url).toBe("/api/collection/imports");
      expect(init).toMatchObject({ method: "POST", body: selectionBody, signal: controller.signal });
    }
  });

  it("surfaces the last error after the bounded approval retry budget", async () => {
    fetchImport.mockImplementation(async () => unavailable());
    const approval = approveImportSelection(selectionId, new AbortController().signal);
    const failure = expect(approval).rejects.toMatchObject({ status: 503 });
    await vi.runAllTimersAsync();
    await failure;
    expect(fetchImport).toHaveBeenCalledTimes(7);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not retry an explicitly nonretryable 503", async () => {
    fetchImport.mockResolvedValueOnce(unavailable(false));
    await expect(approveImportSelection(selectionId, new AbortController().signal))
      .rejects.toMatchObject({ status: 503, retryable: false });
    expect(fetchImport).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([401, 403, 404, 409])("does not retry HTTP %i", async (status) => {
    fetchImport.mockResolvedValueOnce(Response.json({ error: "Unavailable.", retryable: true }, { status }));
    await expect(approveImportSelection(selectionId, new AbortController().signal))
      .rejects.toMatchObject({ status, retryable: false });
    expect(fetchImport).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not send another approval if cancelled during backoff", async () => {
    fetchImport.mockResolvedValueOnce(unavailable());
    const controller = new AbortController();
    const reason = new DOMException("Stopped", "AbortError");
    const approval = approveImportSelection(selectionId, controller.signal);
    const failure = expect(approval).rejects.toBe(reason);

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImport).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort(reason);
    await vi.runAllTimersAsync();
    await failure;
    expect(fetchImport).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries a transient queue GET once with the same filters", async () => {
    const page = { rows: [{ id: "pending-swim" }], total: 1, hasNext: false };
    fetchImport.mockResolvedValueOnce(unavailable()).mockResolvedValueOnce(Response.json(page));
    const controller = new AbortController();
    const request = importQueuePage(new URLSearchParams({ kind: "swims", offset: "30", search: "free" }), controller.signal);
    await vi.advanceTimersByTimeAsync(500);
    await expect(request).resolves.toEqual(page);
    expect(fetchImport.mock.calls).toEqual([
      ["/api/collection/imports?kind=swims&offset=30&search=free", { cache: "no-store", signal: controller.signal }],
      ["/api/collection/imports?kind=swims&offset=30&search=free", { cache: "no-store", signal: controller.signal }],
    ]);
  });

  it("limits issue GET to one retry", async () => {
    fetchImport.mockImplementation(async () => unavailable());
    const request = importIssuesPage(30, new AbortController().signal);
    const failure = expect(request).rejects.toMatchObject({ status: 503 });
    await vi.runAllTimersAsync();
    await failure;
    expect(fetchImport).toHaveBeenCalledTimes(2);
  });

  it("does not automatically repeat selection creation or swimmer matching", async () => {
    fetchImport.mockImplementation(async () => unavailable());
    await expect(createImportSelection({ matches: [{ kind: "swims" }], preview: false }))
      .rejects.toMatchObject({ status: 503 });
    await expect(resolveImportSwimmerMatch({
      id: selectionId,
      athleteId: "athlete-fixture",
      matchVersion: "fixture-version",
    })).rejects.toMatchObject({ status: 503 });
    expect(fetchImport).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
