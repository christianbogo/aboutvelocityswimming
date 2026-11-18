"use client";

import { Fragment, Suspense, useId, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  X,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import { hasBackendConfiguration } from "@/lib/supabase/client";
import type { TimesView } from "@/lib/tool-directory";
import { formatSwimTime } from "@/features/swim-resources/lib/domain/swim-time";
import {
  ageGroups,
  timesEvents,
  hide25sForAgeGroups,
  changeResultCategory,
  changeTimesCourse,
  eventLabel,
  initialFilters,
  type Filters,
} from "./times-data";
import s from "./TimesDatabase.module.css";
import loadingStyles from "./TimesLoading.module.css";
import { SkeletonText, SkeletonStatus } from "./LoadingSkeleton";
import TimeStandards, {
  TimeStandardsSummary,
  TimeStandardsSummarySkeleton,
  TimeStandardsSkeleton,
  useTimeStandardsSelection,
} from "./TimeStandards";
import { FilterChips, FilterSummary, PopupPicker } from "./TimesFilters";
import RankingFilters, { RankingFiltersSkeleton } from "./RankingFilters";
import { ModerationNotice } from "./ResultModeration";
import RelayLineup from "./RelayLineup";
import { timesUrl, type TimesResponse } from "./times-api";
import { useTimes, useDebouncedSearch } from "./use-times";
import TeamRecords, {
  TeamRecordsSkeleton,
  type RecordSelection,
} from "./TeamRecords";
import { strokeColumns, eventColumn } from "./event-layout";
import MyTimes, { type MyTimesRankingSelection } from "./MyTimes";
import { MyTimesPageSkeleton } from "./MyTimesSkeleton";
import {
  crossedRankingCutoffs,
  rankingCutoffs,
  type RankingCutoff,
} from "./ranking-cutoffs";

import { useTimesSelection } from "./use-times-selection";
import {
  athleteTimesHref,
  timesViewHref,
  writeTimesSelection,
} from "./times-url-state";

import CutChips from "./CutChips";
import { useStandards } from "./use-standards";

const pageSize = 25;
const ageOptions: [string, string][] = ageGroups.map(([key, label]) => [
  key,
  label,
]);
const rankingResultModes: [Filters["mode"], string][] = [
  ["bests", "Bests"],
  ["performances", "Performances"],
  ["recent", "Recent"],
];
const number = (n: number) => n.toLocaleString("en-US");
function date(value: string) {
  return value
    ? new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "Date unavailable";
}

function QueryNotice({ query }: { query: ReturnType<typeof useTimes> }) {
  return query.loading ? (
    <p className="sr-only" role="status">
      Loading results…
    </p>
  ) : query.error ? (
    <p className={s.notice} role="alert">
      {query.error}{" "}
      <button className={s.link} onClick={query.retry}>
        Try again
      </button>
    </p>
  ) : null;
}
function AgeGroupPicker({
  value,
  onChange,
  options = ageOptions,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  options?: [string, string][];
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  function selectGroups(groups: string[]) {
    onChange(groups);
    dialog.current?.close();
  }
  return (
    <div className={s.field}>
      <label htmlFor={id}>Age group</label>
      <button
        id={id}
        className={s.eventTrigger}
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        <span>
          {value.length
            ? options
                .filter(([key]) => value.includes(key))
                .map(([, text]) => text)
                .join(", ")
            : "All ages"}
        </span>
        <ChevronDown size={16} />
      </button>
      <dialog
        ref={dialog}
        className={s.eventDialog}
        aria-labelledby={`${id}-title`}
      >
        <div className={s.popupHead}>
          <h2 id={`${id}-title`}>Age group</h2>
          <button
            className={s.button}
            aria-label="Close age group picker"
            onClick={() => dialog.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        <p className={s.muted}>Select one or more recorded age groups.</p>
        <div className={s.eventGrid}>
          <button aria-pressed={!value.length} onClick={() => selectGroups([])}>
            All ages
          </button>
          {options.map(([key, text]) => (
            <button
              key={key}
              aria-pressed={value.includes(key)}
              onClick={() =>
                selectGroups(
                  value.includes(key)
                    ? value.filter((age) => age !== key)
                    : [...value, key],
                )
              }
            >
              {text}
            </button>
          ))}
        </div>
        <button className={s.button} onClick={() => dialog.current?.close()}>
          Done
        </button>
      </dialog>
    </div>
  );
}
function Pager({
  page,
  total,
  onChange,
  loading = false,
}: {
  page: number;
  total: number;
  onChange: (page: number) => void;
  loading?: boolean;
}) {
  return (
    <nav className={s.pager} aria-label="Result pages">
      <button
        className={s.button}
        disabled={loading || page === 0}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft size={14} />
        Previous
      </button>
      <span className={s.pageCount}>
        {loading ? (
          <SkeletonText width={100} height={14} />
        ) : (
          <>
            {total ? page * pageSize + 1 : 0}–
            {Math.min((page + 1) * pageSize, total)} of {number(total)}
          </>
        )}
      </span>
      <button
        className={s.button}
        disabled={loading || (page + 1) * pageSize >= total}
        onClick={() => onChange(page + 1)}
      >
        Next
        <ChevronRight size={14} />
      </button>
    </nav>
  );
}
function CutoffDivider({
  cutoff,
  columns,
  loading = false,
}: {
  cutoff: RankingCutoff;
  columns: number;
  loading?: boolean;
}) {
  const label = `${formatSwimTime(cutoff.time)} ${cutoff.rank.name.toUpperCase()} CUTOFF · ${cutoff.seasonYears}`;
  return (
    <tr className={s.cutoffRow} aria-hidden={loading || undefined}>
      {[false, true].map((wide) => (
        <td
          key={String(wide)}
          colSpan={wide ? columns : columns - 1}
          className={wide ? s.cutoffWide : s.cutoffCompact}
        >
          {!loading && <span className="sr-only">{label}</span>}
          <div
            className={`${s.cutoffLine} ${loading ? s.cutoffLoading : ""}`}
            style={loading ? undefined : { backgroundColor: cutoff.rank.color }}
            aria-hidden="true"
          >
            {Array.from({ length: 8 }, (_, index) => (
              <span key={index}>
                {loading ? <SkeletonText width={200} height={9} /> : label}
              </span>
            ))}
          </div>
        </td>
      ))}
    </tr>
  );
}

function RankingTableHead({
  showRank,
  relay,
}: {
  showRank: boolean;
  relay: boolean;
}) {
  return (
    <thead>
      <tr>
        {showRank && (
          <th scope="col" className={s.rank}>
            <span className="sr-only">Rank</span>
          </th>
        )}
        <th scope="col" className={s.rankingAthlete}>
          {relay ? "Relay team" : "Athlete"}
        </th>
        <th scope="col">Time</th>
        <th scope="col" className={s.rankingDate}>
          Date
        </th>
        <th scope="col" className={s.rankingMeet}>
          Meet
        </th>
      </tr>
    </thead>
  );
}

function RankingsLoadingRows({
  rows = [],
  previousTime,
  cutoffs = [],
  showRank = true,
  relay = false,
}: {
  rows?: NonNullable<TimesResponse["rows"]>;
  previousTime?: number;
  cutoffs?: RankingCutoff[];
  showRank?: boolean;
  relay?: boolean;
}) {
  return (
    <tbody
      className={loadingStyles.pulse}
      data-loading-skeleton="rankings"
      aria-hidden="true"
    >
      {Array.from({ length: rows.length || pageSize }, (_, index) => (
        <Fragment key={index}>
          {rows[index] &&
            crossedRankingCutoffs(
              cutoffs,
              index > 0 ? rows[index - 1].race.time : previousTime,
              rows[index].race.time,
            ).map((cutoff) => (
              <CutoffDivider
                key={cutoff.rank.tier}
                cutoff={cutoff}
                columns={showRank ? 5 : 4}
                loading
              />
            ))}
          <tr className={s.rankingLoadingRow}>
            {showRank && (
              <td className={s.rank}>
                <SkeletonText width={16} height={13} />
              </td>
            )}
            <td className={s.rankingAthlete}>
              <div className={s.rankingAthleteContent}>
                {relay ? (
                  <div className={s.rankingRelaySkeleton}>
                    {Array.from({ length: 4 }, (_, leg) => (
                      <SkeletonText key={leg} width={72} height={13} />
                    ))}
                  </div>
                ) : (
                  <SkeletonText width={150} height={13} />
                )}
              </div>
            </td>
            <td>
              <div className={s.rankingTimeContent}>
                <span className={s.rankingTimeValue}>
                  <SkeletonText width={62} height={18} />
                </span>
                <span className={s.rankingCutSlot}>
                  <SkeletonText width={24} height={24} />
                </span>
              </div>
            </td>
            <td className={s.rankingDate}>
              <SkeletonText width={85} height={13} />
            </td>
            <td className={s.rankingMeet}>
              <SkeletonText width="70%" height={13} />
            </td>
          </tr>
        </Fragment>
      ))}
    </tbody>
  );
}

function RankingsFilterSkeleton() {
  const events = [...timesEvents("SCY"), ...timesEvents("SCY", true)];
  return (
    <div aria-hidden="true" className={loadingStyles.pulse}>
      <div className={s.filters}>
        <div className={`${s.field} ${s.eventField}`}>
          <div className={s.inlineEventSelector}>
            <div className={s.strokeSelector}>
              <div className={s.strokeColumns}>
                {strokeColumns.map(([stroke]) => (
                  <section key={stroke}>
                    <h3>
                      <SkeletonText width={24} height={10} />
                    </h3>
                    {events
                      .filter((event) => eventColumn(event) === stroke)
                      .map((event) => (
                        <span key={event} className={s.strokeSkeletonChoice}>
                          <SkeletonText width={22} height={12} />
                        </span>
                      ))}
                    {["FL", "BK", "BR"].includes(stroke) && (
                      <span className={s.strokeSkeletonChoice}>
                        <SkeletonText width={22} height={12} />
                      </span>
                    )}
                  </section>
                ))}
              </div>
            </div>
          </div>
          <span className={s.eventTrigger}>
            <SkeletonText width="70%" height={13} />
          </span>
        </div>
        <div className={s.secondaryFilters}>
          {["Gender", "Age group", "Results", "Year"].map((label) =>
            label === "Gender" || label === "Results" ? (
              <fieldset className={s.courseField} key={label}>
                <legend>
                  <SkeletonText width={56} height={10} />
                </legend>
                <div className={s.chips}>
                  {Array.from(
                    { length: label === "Gender" ? 2 : 3 },
                    (_, index) => (
                      <span className={s.filterControlSkeleton} key={index}>
                        <SkeletonText width={44} height={12} />
                      </span>
                    ),
                  )}
                </div>
              </fieldset>
            ) : (
              <div className={s.field} key={label}>
                <span className={s.filterSkeletonLabel}>
                  <SkeletonText width={56} height={10} />
                </span>
                <span className={s.eventTrigger}>
                  <SkeletonText width="60%" height={13} />
                </span>
              </div>
            ),
          )}
        </div>
      </div>
      <div className={`${s.toolbar} ${s.rankingToolbar}`}>
        <span className={`${s.eventTrigger} ${s.searchSkeleton}`}>
          <SkeletonText width={150} height={13} />
        </span>
        <SkeletonText width={76} height={13} />
      </div>
    </div>
  );
}

export function RankingsSkeleton() {
  return (
    <main className={s.page} aria-busy="true">
      <SkeletonStatus>Loading rankings…</SkeletonStatus>
      <header className={s.toolHeader} aria-hidden="true">
        <div className={`${s.filterSummary} ${s.summarySkeleton}`}>
          {[28, 90, 50, 48].map((width, index) => (
            <SkeletonText key={index} width={width} height={13} />
          ))}
        </div>
      </header>
      <div className={s.content}>
        <div className={s.main}>
          <section className={s.panel} aria-label="Rankings">
            <RankingFiltersSkeleton />
            <RankingsFilterSkeleton />
            <div className={s.tableWrap}>
              <table
                className={`${s.table} ${s.rankingTable}`}
                aria-busy="true"
              >
                <RankingTableHead showRank relay={false} />
                <RankingsLoadingRows />
              </table>
            </div>
            <Pager page={0} total={0} onChange={() => {}} loading />
          </section>
        </div>
      </div>
    </main>
  );
}

export function RecordsSkeleton() {
  return (
    <main className={s.page}>
      <div className={`${s.content} ${s.recordsContent}`}>
        <TeamRecordsSkeleton />
      </div>
    </main>
  );
}

export function TimesPageSkeleton({ view }: { view: TimesView }) {
  if (view === "rankings") return <RankingsSkeleton />;
  if (view === "records") return <RecordsSkeleton />;
  if (view === "my-times") return <MyTimesPageSkeleton />;
  return (
    <main className={s.page} aria-busy="true">
      <header className={s.toolHeader}>
        <TimeStandardsSummarySkeleton />
      </header>
      <div className={s.content}>
        <TimeStandardsSkeleton />
      </div>
    </main>
  );
}

export default function TimesDatabase({ view }: { view: TimesView }) {
  return (
    <Suspense fallback={<TimesPageSkeleton view={view} />}>
      <TimesDatabaseContent key={view} view={view} />
    </Suspense>
  );
}

function TimesDatabaseContent({ view }: { view: TimesView }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const standards = useStandards(view !== "records");
  const standardSelection = useTimeStandardsSelection(
    standards.sets,
    view === "standards",
  );
  const [filters, setFilters] = useTimesSelection<Filters>(
    "filters",
    initialFilters,
  );
  const [search, setSearch] = useTimesSelection("search", "");
  const searchTerm = useDebouncedSearch(search);
  const [page, setPage] = useTimesSelection("page", 0);
  const enabled = hasBackendConfiguration;
  const rankingYears = useTimes(
    enabled && view === "rankings" ? timesUrl("ranking_years") : null,
  );
  const years = [
    ...new Set([
      ...(rankingYears.data?.years ??
        rankingYears.placeholderData?.years ??
        []),
      ...(filters.year ? [filters.year] : []),
    ]),
  ].sort((a, b) => b.localeCompare(a));
  const queryFilters = {
    ...filters,
    genders: filters.genders.length ? filters.genders : undefined,
  };
  const rankingsQuery = useTimes(
    enabled && view === "rankings"
      ? timesUrl("rankings", {
          ...queryFilters,
          search: searchTerm,
          offset: Math.max(0, page * pageSize - (page > 0 ? 1 : 0)),
          limit: pageSize + (page > 0 ? 1 : 0),
        })
      : null,
  );
  const recordsQuery = useTimes(
    enabled && view === "records" ? timesUrl("records_board") : null,
  );
  const recordData =
    recordsQuery.data ??
    (recordsQuery.loading ? recordsQuery.placeholderData : null);
  const races = recordData?.races ?? [];
  const placeholderOffset = rankingsQuery.placeholderUrl
    ? Number(
        new URL(
          rankingsQuery.placeholderUrl,
          "https://local.test",
        ).searchParams.get("offset"),
      )
    : 0;
  const placeholderRows = (rankingsQuery.placeholderData?.rows ?? []).slice(
    placeholderOffset > 0 ? 1 : 0,
  );
  const placeholderPreviousTime =
    placeholderOffset > 0
      ? rankingsQuery.placeholderData?.rows?.[0]?.race.time
      : undefined;
  const rankingRows = rankingsQuery.data?.rows ?? [];
  const previousPageTime = page > 0 ? rankingRows[0]?.race.time : undefined;
  const displayed = rankingRows.slice(page > 0 ? 1 : 0);
  const cutoffs = rankingCutoffs(filters, standards.sets);
  const names = new Map(
    [...displayed.map(({ race }) => race), ...races].map((r) => [
      r.athleteId,
      r.athleteName || r.athleteId,
    ]),
  );
  const hide25s = hide25sForAgeGroups(filters.course, filters.ageGroups);
  const rankingEvents = [
    ...timesEvents(filters.course),
    ...timesEvents(filters.course, true),
  ].filter((event) => !hide25s || !event.startsWith("25_"));
  const selectedAgeLabels =
    ageOptions
      .filter(([key]) => filters.ageGroups.includes(key))
      .map(([, label]) => label)
      .join(", ") || "All ages";
  const selectedGenderLabels =
    filters.genders
      .map((gender) => ({ F: "Female", M: "Male", X: "Mixed" })[gender])
      .join(" / ") || "All genders";
  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => {
      const next =
        key === "course"
          ? changeTimesCourse(f, String(value))
          : { ...f, [key]: value };
      if (key === "year") {
        next.startDate = "";
        next.endDate = "";
      }
      if (
        hide25sForAgeGroups(next.course, next.ageGroups) &&
        next.event.startsWith("25_")
      ) {
        const sameStroke50 = next.event.replace(/^25_/, "50_");
        const available = timesEvents(next.course, next.relay);
        next.event = available.includes(sameStroke50)
          ? sameStroke50
          : available.find((event) => !event.startsWith("25_")) || "";
      }
      return next;
    });
    setPage(0);
  }
  function applyRankingFilters(next: Filters, search: string) {
    setFilters(next);
    setSearch(search);
    setPage(0);
  }
  function updateResultCategory(relay: boolean) {
    if (Boolean(filters.relay) === relay) return;
    setFilters((current) => {
      const next = changeResultCategory(current, relay);
      return !next.genders.length ? { ...next, genders: ["F"] } : next;
    });
    setPage(0);
    setSearch("");
  }
  function openRankings(next: Filters, collapseFilters = false) {
    const url = new URL(
      timesViewHref("rankings", window.location.search, "#times-rankings"),
      window.location.origin,
    );
    if (collapseFilters) url.searchParams.set("eventFilters", "closed");
    router.push(writeTimesSelection(url, "filters", next, initialFilters));
  }
  function openRecord(selection: RecordSelection) {
    openRankings(
      {
        ...initialFilters,
        course: selection.course,
        event: selection.event,
        genders: [selection.gender],
        ageGroups: [selection.ageGroup],
        mode: selection.relay ? "performances" : "bests",
        relay: selection.relay ?? false,
      },
      true,
    );
  }
  function openMyTimesRankings(selection: MyTimesRankingSelection) {
    openRankings({
      ...initialFilters,
      course: selection.course,
      event: selection.event,
      genders: selection.gender ? [selection.gender] : [],
      ageGroups: selection.ageGroup ? [selection.ageGroup] : [],
    });
  }
  const tableRelay = Boolean(filters.relay);
  const showRank = filters.mode !== "recent";
  const searchField = (
    <label className={s.field}>
      <span className="sr-only">
        {filters.relay ? "Search relay teams" : "Search athletes"}
      </span>
      <input
        type="search"
        maxLength={100}
        placeholder={
          filters.relay ? "Search relay team…" : "Search athlete name…"
        }
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(0);
        }}
      />
    </label>
  );
  const table = (
    <>
      <div className={s.tableWrap}>
        <table
          aria-busy={rankingsQuery.loading}
          className={`${s.table} ${s.rankingTable} ${tableRelay ? s.relayRankings : ""}`}
        >
          <caption className="sr-only">
            {filters.mode === "recent"
              ? "Recent event results, newest first"
              : filters.mode === "bests" && !tableRelay
                ? "Rankings, one best swim per athlete in the selected age groups"
                : "Rankings, every matching performance"}
          </caption>
          <RankingTableHead showRank={showRank} relay={tableRelay} />
          {rankingsQuery.loading ? (
            <RankingsLoadingRows
              rows={placeholderRows}
              previousTime={placeholderPreviousTime}
              cutoffs={cutoffs}
              showRank={showRank}
              relay={tableRelay}
            />
          ) : (
            <tbody>
              {displayed.map(({ race, rank }, index) => (
                <Fragment key={race.id}>
                  {crossedRankingCutoffs(
                    cutoffs,
                    index > 0
                      ? displayed[index - 1].race.time
                      : previousPageTime,
                    race.time,
                  ).map((cutoff) => (
                    <CutoffDivider
                      key={cutoff.rank.tier}
                      cutoff={cutoff}
                      columns={showRank ? 5 : 4}
                    />
                  ))}
                  <tr
                    onClick={
                      race.relay
                        ? undefined
                        : (event) => {
                            if (
                              (event.target as HTMLElement).closest("a, button")
                            )
                              return;
                            router.push(
                              athleteTimesHref(race.athleteId, race.course),
                            );
                          }
                    }
                  >
                    {showRank && <td className={s.rank}>{rank}</td>}
                    <td className={s.rankingAthlete}>
                      <div className={s.rankingAthleteContent}>
                        {race.relay ? (
                          <RelayLineup race={race} linkProfiles />
                        ) : (
                          (names.get(race.athleteId) ?? race.athleteId)
                        )}
                      </div>
                    </td>
                    <td>
                      <div className={s.rankingTimeContent}>
                        {race.relay ? (
                          <span className={`${s.time} ${s.rankingTimeValue}`}>
                            {race.status === "OK"
                              ? formatSwimTime(race.time)
                              : race.status || "—"}
                          </span>
                        ) : (
                          <Link
                            className={`${s.time} ${s.rankingTimeValue}`}
                            href={athleteTimesHref(race.athleteId, race.course)}
                            aria-label={`View Times profile for ${names.get(race.athleteId) ?? race.athleteId}`}
                          >
                            {race.status === "OK"
                              ? formatSwimTime(race.time)
                              : race.status || "—"}
                          </Link>
                        )}
                        <span className={s.rankingCutSlot}>
                          <CutChips
                            race={race}
                            sets={standards.sets}
                            inline
                            motivationalIcons
                          />
                        </span>
                      </div>
                      <ModerationNotice race={race} />
                    </td>
                    <td className={s.rankingDate}>{date(race.date)}</td>
                    <td className={s.rankingMeet}>
                      {race.meet || "Meet unavailable"}
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          )}
        </table>
      </div>
      {!rankingsQuery.loading && !displayed.length && (
        <div className={s.empty}>
          <Search size={24} style={{ margin: "auto" }} />
          <h3>No matching results</h3>
          <p>Try another event or broaden your filters.</p>
        </div>
      )}
      <Pager
        page={page}
        total={
          rankingsQuery.data?.total ?? rankingsQuery.placeholderData?.total ?? 0
        }
        onChange={setPage}
        loading={rankingsQuery.loading}
      />
    </>
  );
  return (
    <main className={s.page} data-times-page="">
      {view !== "records" && view !== "my-times" && (
        <header className={s.toolHeader}>
          {view === "standards" ? (
            standards.loading && !standardSelection.set ? (
              <TimeStandardsSummarySkeleton />
            ) : (
              <TimeStandardsSummary state={standardSelection} />
            )
          ) : (
            <FilterSummary
              label="Selected times filters"
              compact
              items={[
                ["Course", filters.course || "All courses"],
                [
                  "Event",
                  filters.event ? eventLabel(filters.event) : "All events",
                ],
                ["Age group", selectedAgeLabels],
                ["Gender", selectedGenderLabels],
              ]}
            />
          )}
        </header>
      )}
      <div
        className={`${s.content} ${view === "records" ? s.recordsContent : ""}`}
      >
        {!hasBackendConfiguration && (
          <div className={s.notice} role="status">
            The times database is not connected yet. Approved results will
            appear here once it is available.
          </div>
        )}
        {rankingYears.error && <QueryNotice query={rankingYears} />}
        <div className={s.workspace}>
          <div className={s.main}>
            {view === "my-times" ? (
              <MyTimes standards={standards} onRankings={openMyTimesRankings} />
            ) : view === "standards" ? (
              <TimeStandards query={standards} state={standardSelection} />
            ) : view === "records" ? (
              <>
                {recordsQuery.error && <QueryNotice query={recordsQuery} />}
                <TeamRecords
                  races={races}
                  recordBoard={recordData?.records}
                  updatedAt={recordData?.recordsUpdatedAt}
                  ready={Boolean(recordsQuery.data)}
                  loading={recordsQuery.loading}
                  names={names}
                  onRecord={openRecord}
                />
              </>
            ) : (
              <>
                <section
                  id="times-rankings"
                  className={s.panel}
                  aria-label="Rankings"
                >
                  {(filters.startDate || filters.endDate) && (
                    <div className={s.recordBreadcrumb}>
                      <>
                        <span>
                          Season rankings ·{" "}
                          {filters.startDate
                            ? date(filters.startDate)
                            : "All dates"}{" "}
                          –{" "}
                          {filters.endDate ? date(filters.endDate) : "Present"}
                        </span>
                        <button
                          className={s.link}
                          onClick={() => {
                            setFilters((current) => ({
                              ...current,
                              startDate: "",
                              endDate: "",
                            }));
                            setPage(0);
                          }}
                        >
                          Clear date range
                        </button>
                      </>
                    </div>
                  )}
                  <RankingFilters
                    filters={filters}
                    search={search}
                    onApply={applyRankingFilters}
                    initialOpen={searchParams.get("eventFilters") !== "closed"}
                  >
                    <div className={s.filters}>
                      <PopupPicker
                        label="Event"
                        course={filters.course}
                        onCourseChange={(course) =>
                          updateFilter("course", course)
                        }
                        value={filters.event}
                        onChange={(event) => {
                          updateResultCategory(event.endsWith("-R"));
                          updateFilter("event", event);
                        }}
                        options={rankingEvents.map((e) => [e, eventLabel(e)])}
                      />
                      <div className={s.secondaryFilters}>
                        <fieldset className={s.courseField}>
                          <legend>Gender</legend>
                          <div className={s.chips}>
                            {[
                              ["F", "Female"],
                              ["M", "Male"],
                              ...(filters.relay ? [["X", "Mixed"]] : []),
                            ].map(([id, label]) => (
                              <button
                                key={id}
                                aria-pressed={filters.genders.includes(id)}
                                onClick={() => {
                                  const current = filters.genders;
                                  const next = current.includes(id)
                                    ? current.filter((g) => g !== id)
                                    : [...current, id];
                                  if (next.length)
                                    updateFilter("genders", next);
                                }}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </fieldset>
                        <AgeGroupPicker
                          options={ageOptions}
                          value={filters.ageGroups}
                          onChange={(v) => updateFilter("ageGroups", v)}
                        />
                        <FilterChips
                          label="Results"
                          value={
                            filters.relay && filters.mode === "bests"
                              ? "performances"
                              : filters.mode
                          }
                          onChange={(value) =>
                            updateFilter("mode", value as Filters["mode"])
                          }
                          options={rankingResultModes.filter(
                            ([mode]) => !filters.relay || mode !== "bests",
                          )}
                        />
                        <PopupPicker
                          label="Year"
                          value={filters.year}
                          onChange={(v) => updateFilter("year", v)}
                          all="All years"
                          options={years.map((y) => [y, y])}
                        />
                      </div>
                    </div>
                    <div className={`${s.toolbar} ${s.rankingToolbar}`}>
                      {searchField}
                      <button
                        className={s.link}
                        onClick={() => applyRankingFilters(initialFilters, "")}
                      >
                        Reset filters
                      </button>
                    </div>
                  </RankingFilters>
                  <QueryNotice query={rankingsQuery} />
                  {(rankingsQuery.data || rankingsQuery.loading) && table}
                </section>
                <p className={s.footer}>
                  Approved Velocity Swimming results only; coverage may be
                  incomplete. Rankings exclude disqualifications, scratches, and
                  missing times. Verified flat-start relay lead-offs can count
                  toward individual personal bests; flying-start splits remain
                  relay details. Relay rankings use complete team results. Equal
                  times share a rank. Individual age groups use age at the swim;
                  relay groups use the reported event age group. Gender filters
                  include only the selected reported genders. Unreported ages
                  are included when no age group is selected.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
