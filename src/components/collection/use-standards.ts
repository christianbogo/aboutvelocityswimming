"use client";
import { useEffect, useState } from "react";
import { browserClient, hasBackendConfiguration } from "@/lib/supabase/client";
import type { StandardSet } from "@/features/swim-resources/types/schema";

const cachedStandards = new Map<
  string,
  { sets: StandardSet[]; expiresAt: number }
>();

export function useStandards(enabled = true, refreshOnFocus = true) {
  const cacheKey = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const [sets, setSets] = useState<StandardSet[]>(
    () => cachedStandards.get(cacheKey)?.sets ?? [],
  );
  const [loading, setLoading] = useState(
    () =>
      hasBackendConfiguration &&
      !((cachedStandards.get(cacheKey)?.expiresAt ?? 0) > Date.now()),
  );
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!hasBackendConfiguration || !enabled) return;
    let alive = true;
    let version = 0;
    async function load() {
      const request = ++version;
      setLoading(true);
      setError("");
      try {
        const { data, error } = await browserClient()
          .from("standards")
          .select("id,data")
          .order("id");
        if (error) throw error;
        if (alive && request === version) {
          const next = (data ?? []).map((row) => ({
            ...(row.data as unknown as StandardSet),
            id: row.id,
          }));
          cachedStandards.set(cacheKey, {
            sets: next,
            expiresAt: Date.now() + 60000,
          });
          setSets(next);
        }
      } catch {
        if (alive && request === version)
          setError("Could not load approved standards. Please try again.");
      } finally {
        if (alive && request === version) setLoading(false);
      }
    }
    // Paint the last known layout immediately, then refresh its public data.
    void load();
    const refresh = () => {
      void load();
    };
    window.addEventListener("ies-times-changed", refresh);
    if (refreshOnFocus) window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      window.removeEventListener("ies-times-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [enabled, revision, cacheKey, refreshOnFocus]);
  return {
    sets,
    loading: enabled && loading,
    error: enabled ? error : "",
    retry: () => setRevision((value) => value + 1),
  };
}
