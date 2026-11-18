"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { TimesResponse } from "./times-api";
import { timesCache as cache, timesGeneration } from "./times-cache";
import { loadTimes } from "./load-times";
const cacheChangedEvent = "ies-times-cache";
function subscribeCache(onChange: () => void) {
  window.addEventListener(cacheChangedEvent, onChange);
  window.addEventListener("ies-times-changed", onChange);
  return () => {
    window.removeEventListener(cacheChangedEvent, onChange);
    window.removeEventListener("ies-times-changed", onChange);
  };
}
function readFreshCache(key: string) {
  const cached = cache.get(key);
  return cached && cached.expiresAt > Date.now() ? cached : null;
}
function serverCache() {
  return null;
}
export function useDebouncedSearch(value: string) {
  const [search, setSearch] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(value), 250);
    return () => clearTimeout(timer);
  }, [value]);
  return search;
}
export function useTimes(url: string | null, enabled = true) {
  const cacheKey = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}|${url}`;
  const cached = useSyncExternalStore(
    subscribeCache,
    () => (url ? readFreshCache(cacheKey) : null),
    serverCache,
  );
  const [state, setState] = useState<{
    url: string | null;
    data: TimesResponse | null;
    error: string;
  }>({ url: null, data: null, error: "" });
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!url || !enabled) return;
    const controller = new AbortController();
    const generation = timesGeneration;
    let timer: ReturnType<typeof setTimeout>;
    const changed = () => {
      setState({ url: null, data: null, error: "" });
      retry((n) => n + 1);
    };
    window.addEventListener("ies-times-changed", changed);
    async function load() {
      try {
        let data = cache.get(cacheKey);
        if (!data || data.expiresAt <= Date.now()) {
          data = await loadTimes(url!, controller.signal);
          if (controller.signal.aborted || generation !== timesGeneration)
            return;
          cache.set(cacheKey, data);
          if (cache.size > 128) cache.delete(cache.keys().next().value!);
          window.dispatchEvent(new Event(cacheChangedEvent));
        }
        if (!controller.signal.aborted) {
          setState({ url, data, error: "" });
          timer = setTimeout(
            () => retry((n) => n + 1),
            Math.max(1000, data.expiresAt - Date.now() + 10),
          );
        }
      } catch {
        if (!controller.signal.aborted)
          setState({
            url,
            data: null,
            error: "We couldn’t load these results. Please try again.",
          });
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener("ies-times-changed", changed);
    };
  }, [url, cacheKey, attempt, enabled]);
  // A return visit can paint a fresh cache entry immediately, rather than
  // flashing a skeleton until the effect runs. Never reuse another query's data.
  const data = cached ?? (url && state.url === url ? state.data : null);
  const error = url && state.url === url && !data ? state.error : "";
  return {
    data,
    // Previous results describe placeholder geometry only, not current results.
    placeholderData: state.data,
    placeholderUrl: state.url,
    placeholderRowCount: state.data?.rows?.length,
    error,
    loading: Boolean(enabled && url && !data && !error),
    retry: () => {
      if (url) cache.delete(cacheKey);
      setState({ url: null, data: null, error: "" });
      retry((n) => n + 1);
    },
  };
}
