"use client";

import { useEffect, useMemo, useState } from "react";
import type { TeamData, TeamMeetData } from "./team-data";

async function readTeam<T>(query: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/times/team${query}`, {
    cache: "no-store",
    signal,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Couldn’t load Team.");
  return body;
}

export function useTeamData() {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    data?: TeamData;
    error?: string;
    revision: number;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    readTeam<TeamData>("", controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ data, revision });
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted)
          setResult((old) => ({
            data: old?.data,
            error: error.message,
            revision,
          }));
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setRevision((value) => value + 1), 250);
    };
    window.addEventListener("ies-times-changed", refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("ies-times-changed", refresh);
    };
  }, []);
  return {
    data: result?.data,
    error: result?.error,
    loading: result?.revision !== revision,
    retry: () => setRevision((value) => value + 1),
  };
}

/** Cache only in this mounted page; refreshed overview data invalidates meet snapshots. */
export function useTeamMeet(initial: TeamData, selected: string) {
  const cache = useMemo(
    () =>
      new Map<string, TeamMeetData>(
        initial.meet ? [[initial.meet.id, initial]] : [],
      ),
    [initial],
  );
  const id = selected || initial.meet?.id || "";
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    cache: typeof cache;
    id: string;
    data?: TeamMeetData;
    error?: string;
  }>();
  const cached = cache.get(id);
  useEffect(() => {
    if (!id || cache.has(id)) return;
    const controller = new AbortController();
    readTeam<TeamMeetData>(
      `?${new URLSearchParams({ scope: "meet", meet: id })}`,
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) {
          cache.set(id, data);
          setResult({ cache, id, data });
        }
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted)
          setResult({ cache, id, error: error.message });
      });
    return () => controller.abort();
  }, [id, cache, attempt]);
  const current =
    result?.cache === cache && result.id === id ? result : undefined;
  return {
    id,
    data: cached ?? current?.data,
    error: current?.error,
    loading: !!id && !cached && !current,
    retry: () => {
      setResult(undefined);
      setAttempt((value) => value + 1);
    },
  };
}
