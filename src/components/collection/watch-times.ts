import type { TimesResponse } from "@/features/swimming/domain/times-query";
import { loadTimes, TimesReadError } from "./load-times";
import { timesCache, timesGeneration } from "./times-cache";
import {
  timesRefreshDelay,
  timesRetryDelay,
} from "@/features/swimming/domain/cache-policy";

export const timesCacheChangedEvent = "ies-times-cache";
export type TimesReadState = {
  url: string | null;
  data: TimesResponse | null;
  error: string;
  generation: number;
};

/** Own one visible view's refresh lifecycle; an explicit write cancels it. */
export function watchTimes(
  url: string,
  cacheKey: string,
  changed: (state: TimesReadState) => void,
  invalidated: () => void,
) {
  const controller = new AbortController();
  const generation = timesGeneration;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let active: AbortController | undefined;
  let failures = 0;
  let previous = timesCache.get(cacheKey) ?? null;
  const current = () =>
    !controller.signal.aborted && generation === timesGeneration;
  const visible = () => document.visibilityState !== "hidden";
  function schedule(delay: number) {
    clearTimeout(timer);
    if (current() && visible()) timer = setTimeout(() => void load(), delay);
  }
  async function load() {
    if (!current() || !visible() || running) return;
    running = true;
    const request = new AbortController();
    active = request;
    try {
      let data = timesCache.get(cacheKey);
      if (!data || data.expiresAt <= Date.now()) {
        data = await loadTimes(
          url,
          AbortSignal.any([controller.signal, request.signal]),
        );
        if (!current()) return;
        timesCache.set(cacheKey, data);
        if (timesCache.size > 128)
          timesCache.delete(timesCache.keys().next().value!);
        window.dispatchEvent(new Event(timesCacheChangedEvent));
      }
      if (!current()) return;
      previous = data;
      failures = 0;
      changed({ url, data, error: "", generation });
      schedule(timesRefreshDelay(data.expiresAt));
    } catch (error) {
      if (!current() || request.signal.aborted) return;
      const retryable = !(error instanceof TimesReadError) || error.retryable;
      if (!retryable) {
        previous = null;
        timesCache.delete(cacheKey);
        window.dispatchEvent(new Event(timesCacheChangedEvent));
      }
      changed({
        url,
        data: previous,
        error: "We couldn’t load these results. Please try again.",
        generation,
      });
      // Refresh failures keep the displayed results, and retry at a bounded,
      // staggered pace. Permission/validation failures wait for user action.
      if (retryable) schedule(timesRetryDelay(++failures));
    } finally {
      if (active === request) active = undefined;
      running = false;
    }
  }
  const visibility = () => {
    clearTimeout(timer);
    if (visible()) schedule(250 + Math.floor(Math.random() * 4750));
    else active?.abort();
  };
  const invalidate = () => {
    controller.abort();
    clearTimeout(timer);
    invalidated();
  };
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("ies-times-changed", invalidate);
  void load();
  return () => {
    controller.abort();
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("ies-times-changed", invalidate);
  };
}
