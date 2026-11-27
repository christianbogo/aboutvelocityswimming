import type { TimesResponse } from "@/features/swimming/domain/times-query";
export const timesCache = new Map<string, TimesResponse>();
export let timesGeneration = 0;
export function clearTimesCache() {
  timesCache.clear();
  timesGeneration++;
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("ies-times-changed"));
}
