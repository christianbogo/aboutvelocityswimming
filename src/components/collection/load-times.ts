import type { TimesResponse } from "@/features/swimming/domain/times-query";
import { timesGeneration } from "./times-cache";

const message = "We couldn’t load these results. Please try again.";
const retryable = new Set([408, 429, 500, 502, 503, 504]);

export class TimesReadError extends Error {
  constructor(readonly retryable: boolean) {
    super(message);
  }
}
function pause(signal: AbortSignal, delay: number) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delay);
    signal.addEventListener("abort", abort, { once: true });
  });
}

// Read-only requests get one bounded retry. Never use this for approval writes.
async function requestTimes(
  url: string,
  signal: AbortSignal,
): Promise<TimesResponse> {
  const view = new URL(url, "https://local.invalid").searchParams.get("view");
  for (let attempt = 1; attempt <= 2; attempt++) {
    signal.throwIfAborted();
    const requestId = crypto.randomUUID();
    const started = performance.now();
    let status: number | undefined;
    let canRetry = true;
    let retryAfterMs = 0;
    try {
      console.info("[velocity:times] request started", {
        view,
        requestId,
        attempt,
      });
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        cache: "no-store",
        headers: { "X-Request-ID": requestId },
      });
      status = response.status;
      canRetry = retryable.has(status);
      const retryAfter = Number(response.headers.get("Retry-After"));
      if (Number.isFinite(retryAfter))
        retryAfterMs = Math.min(30000, Math.max(0, retryAfter * 1000));
      if (!response.ok) throw new TimesReadError(canRetry);
      const data = (await response.json()) as TimesResponse;
      console.info("[velocity:times] request completed", {
        view,
        requestId: response.headers.get("X-Request-ID") ?? requestId,
        attempt,
        status,
        durationMs: Math.round(performance.now() - started),
        serverTiming: response.headers.get("Server-Timing"),
      });
      return data;
    } catch {
      signal.throwIfAborted();
      console.warn("[velocity:times] request failed", {
        view,
        requestId,
        attempt,
        status,
        durationMs: Math.round(performance.now() - started),
        retrying: attempt === 1 && canRetry,
      });
      if (attempt === 2 || !canRetry) throw new TimesReadError(canRetry);
      await pause(
        signal,
        Math.max(1000, retryAfterMs) + Math.floor(Math.random() * 2000),
      );
    }
  }
  throw new TimesReadError(true);
}

// Share simultaneous reads in one tab while keeping cancellation per consumer.
// A route change only aborts the request when nobody still needs its result.
const pending = new Map<
  string,
  {
    controller: AbortController;
    result: Promise<TimesResponse>;
    consumers: number;
  }
>();
export function loadTimes(
  url: string,
  signal: AbortSignal,
): Promise<TimesResponse> {
  signal.throwIfAborted();
  const key = `${timesGeneration}|${url}`;
  let request = pending.get(key);
  if (!request) {
    const controller = new AbortController();
    request = {
      controller,
      result: requestTimes(url, controller.signal),
      consumers: 0,
    };
    pending.set(key, request);
    const current = request;
    void request.result
      .finally(() => {
        if (pending.get(key) === current) pending.delete(key);
      })
      .catch(() => {});
  }
  const shared = request;
  shared.consumers++;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return false;
      settled = true;
      signal.removeEventListener("abort", abort);
      shared.consumers--;
      return true;
    };
    const abort = () => {
      if (!finish()) return;
      reject(signal.reason);
      if (shared.consumers === 0) {
        shared.controller.abort();
        if (pending.get(key) === shared) pending.delete(key);
      }
    };
    signal.addEventListener("abort", abort, { once: true });
    shared.result.then(
      (data) => {
        if (finish()) resolve(data);
      },
      (error) => {
        if (finish()) reject(error);
      },
    );
  });
}
