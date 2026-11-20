import type { TimesResponse } from "./times-api";
export const timesCache = new Map<string, TimesResponse>();
export let timesGeneration = 0;
export function clearTimesCache() {
  timesCache.clear();
  timesGeneration++;
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("ies-times-changed"));
}
// Relative deadlines avoid making every open page refresh on the minute.
export function timesExpiry(now = Date.now()) {
  return now + 60000;
}
export function timesRefreshDelay(
  expiresAt: number,
  now = Date.now(),
  random = Math.random(),
) {
  return Math.max(1000, expiresAt - now) + 2000 + Math.floor(random * 10000);
}
export function timesRetryDelay(failures: number, random = Math.random()) {
  return (
    Math.min(60000, 5000 * 2 ** Math.min(Math.max(failures - 1, 0), 4)) +
    Math.floor(random * 5000)
  );
}
