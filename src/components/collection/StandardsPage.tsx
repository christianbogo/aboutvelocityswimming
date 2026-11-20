"use client";

import { Suspense } from "react";
import TimeStandards, {
  TimeStandardsSummary,
  TimeStandardsSummarySkeleton,
  TimeStandardsSkeleton,
  useTimeStandardsSelection,
} from "./TimeStandards";
import { TimesConfigurationNotice } from "./TimesNotices";
import { useStandards } from "./use-standards";
import s from "./TimesDatabase.module.css";

export function StandardsSkeleton() {
  return (
    <main className={s.page} aria-busy="true">
      <header className={s.toolHeader}>
        <TimeStandardsSummarySkeleton />
      </header>
      <div className={`${s.content} ${s.standardsContent}`}>
        <TimeStandardsSkeleton />
      </div>
    </main>
  );
}

export default function StandardsPage() {
  return (
    <Suspense fallback={<StandardsSkeleton />}>
      <StandardsContent />
    </Suspense>
  );
}

function StandardsContent() {
  const standards = useStandards();
  const selection = useTimeStandardsSelection(standards.sets);
  return (
    <main className={s.page} data-times-page="">
      <header className={s.toolHeader}>
        {standards.loading && !selection.set ? (
          <TimeStandardsSummarySkeleton />
        ) : (
          <TimeStandardsSummary state={selection} />
        )}
      </header>
      <div className={`${s.content} ${s.standardsContent}`}>
        <TimesConfigurationNotice />
        <div className={s.workspace}>
          <div className={s.main}>
            <TimeStandards query={standards} state={selection} />
          </div>
        </div>
      </div>
    </main>
  );
}
