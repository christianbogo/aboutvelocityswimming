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

export default function UsaStandardsPage() {
  const [motivationalSet, setMotivationalSet] = useState<StandardSet | null>(
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
        const match = currentStandard(sets, "motivational");
        setMotivationalSet(match ?? null);
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
          href={swimResourcesPath("/standards/champ")}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-hover-bg text-text-primary transition-colors"
        >
          <Award size={14} className="text-amber-500" />
          <span>View Championship Cuts</span>
        </Link>
      </div>

      {/* Hero Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <Flame size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-text-primary tracking-tight">
              USA Swimming Motivational Standards
            </h1>
            <p className="text-sm text-text-secondary">
              {motivationalSet
                ? `${motivationalSet.name} · ${motivationalSet.seasonYears}`
                : "No current verified motivational standards have been imported."}
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
          motivationalSet={motivationalSet}
          selectedEvent={selectedEvent}
        />
      )}
    </div>
  );
}
