"use client";

import { Suspense } from "react";
import { useRouter } from "next/navigation";
import MyTimes, { type MyTimesRankingSelection } from "./MyTimes";
import { MyTimesPageSkeleton } from "./MyTimesSkeleton";
import { TimesConfigurationNotice } from "./TimesNotices";
import { initialFilters } from "./times-data";
import { rankingsHref } from "./times-url-state";
import { useStandards } from "./use-standards";
import s from "./TimesDatabase.module.css";

export default function MyTimesPage() {
  return (
    <Suspense fallback={<MyTimesPageSkeleton />}>
      <MyTimesContent />
    </Suspense>
  );
}

function MyTimesContent() {
  const router = useRouter();
  const standards = useStandards();
  function openRankings(selection: MyTimesRankingSelection) {
    router.push(
      rankingsHref(
        {
          ...initialFilters,
          course: selection.course,
          event: selection.event,
          genders: selection.gender ? [selection.gender] : [],
          ageGroups: selection.ageGroup ? [selection.ageGroup] : [],
        },
        window.location.search,
      ),
    );
  }
  return (
    <main className={s.page} data-times-page="">
      <div className={`${s.content} ${s.myTimesContent}`}>
        <TimesConfigurationNotice />
        <div className={s.workspace}>
          <div className={s.main}>
            <MyTimes standards={standards} onRankings={openRankings} />
          </div>
        </div>
      </div>
    </main>
  );
}
