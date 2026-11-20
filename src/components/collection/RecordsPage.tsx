"use client";

import { useRouter } from "next/navigation";
import { hasBackendConfiguration } from "@/lib/supabase/client";
import TeamRecords, {
  TeamRecordsSkeleton,
  type RecordSelection,
} from "./TeamRecords";
import { QueryNotice, TimesConfigurationNotice } from "./TimesNotices";
import { timesUrl } from "./times-api";
import { initialFilters } from "./times-data";
import { rankingsHref } from "./times-url-state";
import { useTimes } from "./use-times";
import s from "./TimesDatabase.module.css";

export function RecordsSkeleton() {
  return (
    <main className={s.page}>
      <div className={`${s.content} ${s.recordsContent}`}>
        <TeamRecordsSkeleton />
      </div>
    </main>
  );
}

export default function RecordsPage() {
  const router = useRouter();
  const query = useTimes(
    hasBackendConfiguration ? timesUrl("records_board") : null,
  );
  const data = query.data ?? (query.loading ? query.placeholderData : null);
  const races = data?.races ?? [];
  const names = new Map(
    races.map((race) => [race.athleteId, race.athleteName || race.athleteId]),
  );
  function openRankings(selection: RecordSelection) {
    router.push(
      rankingsHref(
        {
          ...initialFilters,
          course: selection.course,
          event: selection.event,
          genders: [selection.gender],
          ageGroups: [selection.ageGroup],
          mode: selection.relay ? "performances" : "bests",
          relay: selection.relay ?? false,
        },
        window.location.search,
      ),
    );
  }
  return (
    <main className={s.page} data-times-page="">
      <div className={`${s.content} ${s.recordsContent}`}>
        <TimesConfigurationNotice />
        <div className={s.workspace}>
          <div className={s.main}>
            {query.error && <QueryNotice query={query} />}
            <TeamRecords
              races={races}
              recordBoard={data?.records}
              updatedAt={data?.recordsUpdatedAt}
              ready={Boolean(query.data)}
              loading={query.loading}
              names={names}
              onRecord={openRankings}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
