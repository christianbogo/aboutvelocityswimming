"use client";

import AthleteBestTimes from "@/features/swim-resources/components/AthleteBestTimes";
import type { PublicAthlete } from "@/features/swim-resources/lib/domain/athlete";
import type { AthleteBest } from "@/features/swim-resources/types/schema";
import { loadPublicAthleteBests } from "@/lib/swim-public";
import { useParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function AthleteContainer() {
  const params = useParams();
  const rawName = decodeURIComponent((params.name as string) || "");

  // Format: "Christian_Cutter" or "Emma_Knott"
  const nameParts = rawName.split("_");
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";
  const athleteName = `${firstName} ${lastName}`.trim();

  const [snapshot, setSnapshot] = useState<{
    name: string;
    results: AthleteBest[];
    athlete: PublicAthlete | null;
    error: string;
  }>();
  const current = snapshot?.name === athleteName ? snapshot : undefined;

  useEffect(() => {
    const controller = new AbortController();
    void loadPublicAthleteBests(athleteName, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setSnapshot({
          name: athleteName,
          athlete: result.athlete,
          results: result.bests,
          error: "",
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSnapshot({
            name: athleteName,
            athlete: null,
            results: [],
            error: "Unable to load this swimmer. Please reload this page.",
          });
        }
      });
    return () => controller.abort();
  }, [athleteName]);

  return (
    <div className="w-full">
      {current?.error && <p role="alert">{current.error}</p>}
      <AthleteBestTimes
        results={current?.results ?? []}
        isLoading={!current}
        athleteName={athleteName}
        athlete={current?.athlete ?? null}
      />
    </div>
  );
}

export default function AthletePage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center items-center h-[60vh] text-text-secondary">
          Loading Profile...
        </div>
      }
    >
      <AthleteContainer />
    </Suspense>
  );
}
