"use client";

import { Suspense, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { hasBackendConfiguration } from "@/lib/supabase/client";
import {
  ageGroups,
  timesEvents,
  hide25sForAgeGroups,
  changeResultCategory,
  changeTimesCourse,
  eventLabel,
  initialFilters,
  type Filters,
} from "@/features/swimming/domain/times";
import s from "./TimesDatabase.module.css";
import loadingStyles from "./TimesLoading.module.css";
import { SkeletonText, SkeletonStatus } from "./LoadingSkeleton";
import { PopupPicker } from "./TimesFilters";
import RankingFilters, { RankingFiltersSkeleton } from "./RankingFilters";
import { timesUrl } from "@/features/swimming/domain/times-query";
import { useTimes, useDebouncedSearch } from "./use-times";
import SelectionDropdown from "./TimesSelectionDropdown";
import selectionStyles from "./TimesSelectionDropdown.module.css";
import { rankingCutoffs } from "./ranking-cutoffs";
import RankingsTable, { RankingsTableSkeleton } from "./RankingsTable";

import { useTimesSelection } from "./use-times-selection";
import { normalizeRankingFilters } from "./times-url-state";
import { QueryNotice, TimesConfigurationNotice } from "./TimesNotices";

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

function AgeGroupPicker({
  value,
  onChange,
  options = ageOptions,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  options?: [string, string][];
}) {
  return (
    <SelectionDropdown
      label="Age group"
      highlighted={!options.some(([key]) => value.includes(key))}
      selection={
        options
          .filter(([key]) => value.includes(key))
          .map(([, text]) => text)
          .join(", ") || "All ages"
      }
    >
      {(close) => (
        <>
          <button
            type="button"
            aria-pressed={!value.length}
            onClick={() => {
              onChange([]);
              close();
            }}
          >
            All ages
          </button>
          {options.map(([key, text]) => (
            <button
              key={key}
              type="button"
              aria-pressed={value.includes(key)}
              onClick={() => {
                onChange(
                  value.includes(key)
                    ? value.filter((age) => age !== key)
                    : [...value, key],
                );
                close();
              }}
            >
              {text}
            </button>
          ))}
        </>
      )}
    </SelectionDropdown>
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
function RankingsFilterSkeleton() {
  return (
    <div aria-hidden="true" className={loadingStyles.pulse}>
      <div className={`${selectionStyles.filterPanel} ${s.rankingFilters}`}>
        {["Event", "Course", "Gender", "Age group", "Results", "Year"].map(
          (label) => (
            <div
              className={`${selectionStyles.dropdown} ${selectionStyles.skeletonFilter}`}
              key={label}
            >
              <span className={selectionStyles.selectionLabel}>{label}</span>
              <SkeletonText width="70%" height={13} />
            </div>
          ),
        )}
      </div>
      <div className={`${s.toolbar} ${s.rankingToolbar}`}>
        <span className={`${s.eventTrigger} ${s.searchSkeleton}`}>
          <SkeletonText width={150} height={13} />
        </span>
      </div>
    </div>
  );
}

export function RankingsSkeleton() {
  return (
    <main className={s.page} aria-busy="true">
      <SkeletonStatus>Loading rankings…</SkeletonStatus>
      <div className={`${s.content} ${s.rankingsContent}`}>
        <div className={s.main}>
          <section
            className={`${s.panel} ${s.rankingsPanel}`}
            aria-label="Rankings"
          >
            <RankingFiltersSkeleton />
            <RankingsFilterSkeleton />
            <RankingsTableSkeleton pageSize={pageSize} />
            <Pager page={0} total={0} onChange={() => {}} loading />
          </section>
        </div>
      </div>
    </main>
  );
}

export default function RankingsPage() {
  return (
    <Suspense fallback={<RankingsSkeleton />}>
      <RankingsContent />
    </Suspense>
  );
}

function RankingsContent() {
  const router = useRouter();
  const standards = useStandards();
  const [savedFilters, setSavedFilters] = useTimesSelection<Filters>(
    "filters",
    initialFilters,
  );
  const filters = normalizeRankingFilters(savedFilters);
  function setFilters(action: SetStateAction<Filters>) {
    setSavedFilters((current) =>
      normalizeRankingFilters(
        typeof action === "function"
          ? action(normalizeRankingFilters(current))
          : action,
      ),
    );
  }
  const [search, setSearch] = useTimesSelection("search", "");
  const searchTerm = useDebouncedSearch(search);
  const [page, setPage] = useTimesSelection("page", 0);
  const enabled = hasBackendConfiguration;
  const rankingYears = useTimes(enabled ? timesUrl("ranking_years") : null);
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
    enabled
      ? timesUrl("rankings", {
          ...queryFilters,
          search: searchTerm,
          offset: Math.max(0, page * pageSize - (page > 0 ? 1 : 0)),
          limit: pageSize + (page > 0 ? 1 : 0),
        })
      : null,
  );
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
  const hide25s = hide25sForAgeGroups(filters.course, filters.ageGroups);
  const rankingEvents = [
    ...timesEvents(filters.course),
    ...timesEvents(filters.course, true),
  ].filter((event) => !hide25s || !event.startsWith("25_"));
  const selectedGenderLabel = filters.genders[0] === "M" ? "Male" : "Female";
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
  const tableRelay = Boolean(filters.relay);
  const resultMode =
    tableRelay && filters.mode === "bests" ? "performances" : filters.mode;
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
      <RankingsTable
        rows={rankingsQuery.loading ? placeholderRows : displayed}
        previousTime={
          rankingsQuery.loading ? placeholderPreviousTime : previousPageTime
        }
        loading={rankingsQuery.loading}
        pageSize={pageSize}
        mode={filters.mode}
        relay={tableRelay}
        cutoffs={cutoffs}
        standards={standards.sets}
        formatDate={date}
        onNavigate={(href) => router.push(href)}
      />
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
      <div className={`${s.content} ${s.rankingsContent}`}>
        <TimesConfigurationNotice />
        {rankingYears.error && <QueryNotice query={rankingYears} />}
        <div className={s.workspace}>
          <div className={s.main}>
            <section
              id="times-rankings"
              className={`${s.panel} ${s.rankingsPanel}`}
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
                      – {filters.endDate ? date(filters.endDate) : "Present"}
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
              >
                <div
                  className={`${selectionStyles.filterPanel} ${s.rankingFilters}`}
                >
                  <PopupPicker
                    label="Event"
                    compact
                    course={filters.course}
                    onCourseChange={(course) => updateFilter("course", course)}
                    value={filters.event}
                    onChange={(event) => {
                      updateResultCategory(event.endsWith("-R"));
                      updateFilter("event", event);
                    }}
                    options={rankingEvents.map((e) => [e, eventLabel(e)])}
                  />
                  <SelectionDropdown
                    label="Course"
                    selection={filters.course || "All courses"}
                  >
                    {(close) =>
                      [
                        ["SCY", "Short Course Yards"],
                        ["LCM", "Long Course Meters"],
                        ["SCM", "Short Course Meters"],
                      ].map(([course, label]) => (
                        <button
                          key={course}
                          type="button"
                          aria-pressed={filters.course === course}
                          onClick={() => {
                            updateFilter("course", course);
                            close();
                          }}
                        >
                          {label}
                        </button>
                      ))
                    }
                  </SelectionDropdown>
                  <SelectionDropdown
                    label="Gender"
                    selection={selectedGenderLabel}
                  >
                    {(close) =>
                      [
                        ["F", "Female"],
                        ["M", "Male"],
                      ].map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          aria-pressed={filters.genders.includes(id)}
                          onClick={() => {
                            updateFilter("genders", [id]);
                            close();
                          }}
                        >
                          {label}
                        </button>
                      ))
                    }
                  </SelectionDropdown>
                  <AgeGroupPicker
                    value={filters.ageGroups}
                    onChange={(value) => updateFilter("ageGroups", value)}
                  />
                  <SelectionDropdown
                    label="Results"
                    selection={
                      rankingResultModes.find(
                        ([mode]) => mode === resultMode,
                      )?.[1] || "Bests"
                    }
                  >
                    {(close) =>
                      rankingResultModes
                        .filter(([mode]) => !filters.relay || mode !== "bests")
                        .map(([mode, label]) => (
                          <button
                            key={mode}
                            type="button"
                            aria-pressed={mode === resultMode}
                            onClick={() => {
                              updateFilter("mode", mode);
                              close();
                            }}
                          >
                            {label}
                          </button>
                        ))
                    }
                  </SelectionDropdown>
                  <SelectionDropdown
                    label="Year"
                    selection={filters.year || "All years"}
                  >
                    {(close) =>
                      [
                        ["", "All years"],
                        ...years.map((year) => [year, year]),
                      ].map(([year, label]) => (
                        <button
                          key={year}
                          type="button"
                          aria-pressed={filters.year === year}
                          onClick={() => {
                            updateFilter("year", year);
                            close();
                          }}
                        >
                          {label}
                        </button>
                      ))
                    }
                  </SelectionDropdown>
                </div>
                <div className={`${s.toolbar} ${s.rankingToolbar}`}>
                  {searchField}
                </div>
              </RankingFilters>
              <QueryNotice query={rankingsQuery} />
              {(rankingsQuery.data || rankingsQuery.loading) && table}
            </section>
            <p className={s.footer}>
              Approved Velocity Swimming results only; coverage may be
              incomplete. Rankings exclude disqualifications, scratches, and
              missing times. Verified flat-start relay lead-offs can count
              toward individual personal bests; flying-start splits remain relay
              details. Relay rankings use complete team results. Equal times
              share a rank. Individual age groups use age at the swim; relay
              groups use the reported event age group. Gender filters include
              only the selected reported gender. Unreported ages are included
              when no age group is selected.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
