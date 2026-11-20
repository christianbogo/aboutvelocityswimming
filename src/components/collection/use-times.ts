"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { timesCache as cache, timesGeneration } from "./times-cache";
import {
  watchTimes,
  timesCacheChangedEvent,
  type TimesReadState,
} from "./watch-times";
function subscribeCache(onChange: () => void) {
  window.addEventListener(timesCacheChangedEvent, onChange);
  window.addEventListener("ies-times-changed", onChange);
  return () => {
    window.removeEventListener(timesCacheChangedEvent, onChange);
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
  const [state, setState] = useState<TimesReadState>({
    url: null,
    data: null,
    error: "",
    generation: timesGeneration,
  });
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!url || !enabled) return;
    return watchTimes(url, cacheKey, setState, () => {
      setState({
        url: null,
        data: null,
        error: "",
        generation: timesGeneration,
      });
      retry((n) => n + 1);
    });
  }, [url, cacheKey, attempt, enabled]);
  // A return visit can paint a fresh cache entry immediately, rather than
  // flashing a skeleton until the effect runs. Never reuse another query's data.
  const valid = state.generation === timesGeneration;
  const data =
    cached ?? (valid && url && state.url === url ? state.data : null);
  const error = valid && url && state.url === url && !data ? state.error : "";
  return {
    data,
    // Previous results describe placeholder geometry only, not current results.
    placeholderData: valid ? state.data : null,
    placeholderUrl: valid ? state.url : null,
    placeholderRowCount: valid ? state.data?.rows?.length : undefined,
    error,
    loading: Boolean(enabled && url && !data && !error),
    retry: () => {
      if (url) cache.delete(cacheKey);
      setState({
        url: null,
        data: null,
        error: "",
        generation: timesGeneration,
      });
      retry((n) => n + 1);
    },
  };
}
