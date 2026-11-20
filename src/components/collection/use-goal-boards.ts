"use client";

import { useEffect, useState } from "react";
import { loadTimes } from "./load-times";
import {
  timesCache,
  timesGeneration,
  timesExpiry,
  timesRefreshDelay,
} from "./times-cache";
import { timesUrl, type MyTimesEvent, type TimesResponse } from "./times-api";

export type GoalBoard = {
  rows: NonNullable<TimesResponse["rows"]>;
  error: boolean;
};

/** Small ranking pages, bounded concurrency, and the same cache as Rankings. */
export function useGoalBoards(events: MyTimesEvent[], enabled: boolean) {
  const specification = JSON.stringify(
    events
      .filter(
        (event) =>
          event.race &&
          event.allTimeRank != null &&
          event.rankGender &&
          event.rankAgeGroup,
      )
      .map((event) => ({
        event: event.event,
        course: event.race!.course,
        gender: event.rankGender!,
        age: event.rankAgeGroup!,
        rank: event.allTimeRank!,
        race: event.race!.id,
        time: event.race!.time,
      })),
  );
  const [revision, setRevision] = useState(0);
  const key = `${enabled}|${specification}|${revision}`;
  const [state, setState] = useState<{
    key: string;
    boards: Record<string, GoalBoard>;
    done: boolean;
  }>({ key: "", boards: {}, done: false });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const generation = timesGeneration;
    const descriptors = JSON.parse(specification) as {
      event: string;
      course: string;
      gender: string;
      age: string;
      rank: number;
    }[];
    const boards: Record<string, GoalBoard> = {};
    let index = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function read(url: string) {
      const cacheKey = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}|${url}`;
      const cached = timesCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached;
      const result = await loadTimes(url, controller.signal);
      if (!controller.signal.aborted && generation === timesGeneration) {
        timesCache.set(cacheKey, result);
        if (timesCache.size > 128)
          timesCache.delete(timesCache.keys().next().value!);
      }
      return result;
    }
    async function worker() {
      while (
        index < descriptors.length &&
        !controller.signal.aborted &&
        document.visibilityState !== "hidden"
      ) {
        const descriptor = descriptors[index++];
        const input = {
          course: descriptor.course,
          event: descriptor.event,
          genders: [descriptor.gender],
          ageGroups: [descriptor.age],
          mode: "bests",
          relay: false,
        };
        const urls = [timesUrl("rankings", { ...input, limit: 25 })];
        // R−1 athletes are faster; the last of those is the next rank to catch.
        if (descriptor.rank > 25)
          urls.push(
            timesUrl("rankings", {
              ...input,
              offset: descriptor.rank - 2,
              limit: 1,
            }),
          );
        try {
          const responses = await Promise.all(urls.map(read));
          const rows = new Map(
            responses
              .flatMap((response) => response.rows ?? [])
              .map((row) => [row.race.id, row]),
          );
          boards[descriptor.event] = { rows: [...rows.values()], error: false };
        } catch {
          if (controller.signal.aborted) return;
          boards[descriptor.event] = { rows: [], error: true };
        }
        if (!controller.signal.aborted && generation === timesGeneration)
          setState({ key, boards: { ...boards }, done: false });
      }
    }
    void Promise.all(
      Array.from({ length: Math.min(4, descriptors.length) }, worker),
    ).then(() => {
      if (!controller.signal.aborted && generation === timesGeneration) {
        setState({ key, boards: { ...boards }, done: true });
        if (document.visibilityState !== "hidden")
          timer = setTimeout(refresh, timesRefreshDelay(timesExpiry()));
      }
    });
    const refresh = () => setRevision((value) => value + 1);
    const visibility = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "hidden")
        timer = setTimeout(refresh, 250 + Math.floor(Math.random() * 4750));
      else controller.abort();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("ies-times-changed", refresh);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("ies-times-changed", refresh);
    };
  }, [enabled, specification, key]);

  const current = state.key === key;
  return {
    boards: current ? state.boards : {},
    loading: enabled && (!current || !state.done),
    retry: () => setRevision((value) => value + 1),
  };
}
