"use client";

import { swimResourcesPath } from "../../../../../../features/swim-resources/lib/routes.ts";
import EventSelector, {
  SwimEventSelection,
  formatEventName,
} from "@/features/swim-resources/components/admin/EventSelector";
import StandardsEventTable from "@/features/swim-resources/components/standards/StandardsEventTable";
import { currentStandard } from "@/features/swim-resources/lib/domain/standards";
import type { StandardSet } from "@/features/swim-resources/types/schema";
import { loadPublicStandards } from "@/lib/swim-public";
import { ArrowLeft, Award, Flame } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function ChampStandardsPage() {
  const [championshipSet, setChampionshipSet] = useState<StandardSet | null>(
    null,
  );
  const [error, setError] = useState("");

  const [selectedEvent, setSelectedEvent] = useState<SwimEventSelection | null>(
    {
      course: "SCY",
      stroke: "FR",
      distance: 100,
      isRelay: false,
      eventName: formatEventName("SCY", "FR", 100, false),
    },
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadPublicStandards(controller.signal)
      .then((sets) => {
        if (controller.signal.aborted) return;
        const match = currentStandard(sets, "championship");
        setChampionshipSet(match ?? null);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Unable to load standards. Please reload this page.");
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="p-6 max-w-7xl mx-auto w-full flex flex-col gap-6">
      {error && <p role="alert">{error}</p>}
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <Link
          href={swimResourcesPath("/")}
          className="inline-flex items-center gap-2 text-primary-blue font-medium hover:underline text-sm"
        >
          <ArrowLeft size={16} />
          <span>Back to Home</span>
        </Link>

        <Link
          href={swimResourcesPath("/standards/usa")}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-hover-bg text-text-primary transition-colors"
        >
          <Flame size={14} className="text-emerald-500" />
          <span>View USA Motivational Standards</span>
        </Link>
      </div>

      {/* Hero Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400">
            <Award size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-text-primary tracking-tight">
              Championship Qualifying Standards
            </h1>
            <p className="text-sm text-text-secondary">
              {championshipSet
                ? `${championshipSet.name} · ${championshipSet.seasonYears}`
                : "No current verified championship standards have been imported."}
            </p>
          </div>
        </div>
      </div>

      {/* Event Selector */}
      <EventSelector
        value={selectedEvent}
        onChange={(evt) => setSelectedEvent(evt)}
      />

      {/* Standards Display Table */}
      {selectedEvent && (
        <StandardsEventTable
          championshipSet={championshipSet}
          selectedEvent={selectedEvent}
        />
      )}
    </div>
  );
}
