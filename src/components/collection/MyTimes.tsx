"use client";

import Link from "next/link";
import { ArrowUpRight, ChevronDown, UserRound } from "lucide-react";
import { useEffect, useId, useState, type CSSProperties } from "react";
import { useAuth } from "@/features/workshare/contexts/auth";
import { formatSwimTime } from "@/features/swim-resources/lib/domain/swim-time";
import {
  loadAccountAthletes,
  type AccountAthletePreferences,
} from "@/lib/account-athletes";
import { hasBackendConfiguration } from "@/lib/supabase/client";
import { ageGroups, eventLabel } from "./times-data";
import { timesUrl, type MyTimesEvent } from "./times-api";
import { useTimes, useDebouncedSearch } from "./use-times";
import type { useStandards } from "./use-standards";
import { useTimesSelection } from "./use-times-selection";
import { strokeColumns, eventColumn, compareEvents } from "./event-layout";
import { FilterChips } from "./TimesFilters";
import DiscreteSlider from "./DiscreteSlider";
import { MotivationalRankIcon, RankLegend } from "./MotivationalRankIcon";
import { motivationalRankForRace } from "./motivational-ranks";
import grid from "./TimeStandards.module.css";
import times from "./TimesDatabase.module.css";
import filterStyles from "./RankingFilters.module.css";
import s from "./MyTimes.module.css";

export type MyTimesRankingSelection = {
  event: string;
  course: string;
  gender: string;
  ageGroup: string;
};

const defaultFilters = {
  course: "SCY",
  mode: "all",
  age: "",
  startYear: "",
  endYear: "",
};

function swimDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString(
    "en-US",
    {
      month: "numeric",
      day: "numeric",
      year: "2-digit",
      timeZone: "UTC",
    },
  );
}

function swimAgeGroup(age: number | null | undefined) {
  const group = ageGroups.find(
    ([, , min, max]) => age != null && age >= min && age <= max,
  );
  return group ? group[0].replace("-", "–") : "age unavailable";
}

function cohortLabel(ageGroup: string | null, gender?: string | null) {
  return [
    gender === "F" ? "Girls" : gender === "M" ? "Boys" : "",
    ageGroups.find(([key]) => key === ageGroup)?.[1] ?? ageGroup,
  ]
    .filter(Boolean)
    .join(" · ");
}

function MyTimesResults({
  preferences,
  standards,
  onRankings,
}: {
  preferences: AccountAthletePreferences;
  standards: ReturnType<typeof useStandards>;
  onRankings: (selection: MyTimesRankingSelection) => void;
}) {
  const cardId = useId();
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [athleteId, setAthleteId] = useTimesSelection("myAthlete", "");
  const [filters, setFilters] = useTimesSelection("myFilters", defaultFilters);
  const athletes = [
    ...(preferences.primaryAthlete ? [preferences.primaryAthlete] : []),
    ...preferences.favoriteAthletes.filter(
      (athlete) => athlete.id !== preferences.primaryAthlete?.id,
    ),
  ];
  const athlete = athletes.find((item) => item.id === athleteId) ?? athletes[0];
  const course = ["SCY", "LCM", "SCM"].includes(filters.course)
    ? filters.course
    : "SCY";
  const mode = ["all", "age", "years"].includes(filters.mode)
    ? filters.mode
    : "all";
  const baseUrl = athlete
    ? timesUrl("my_times", { athleteId: athlete.id, course, rankPeriod: "all" })
    : null;
  const overview = useTimes(baseUrl);
  const details =
    overview.data?.myTimes?.period === "all"
      ? overview.data.myTimes
      : undefined;
  const ages = details?.ages ?? [];
  const years = [...(details?.years ?? [])].sort();
  const age = ages.some((value) => String(value) === filters.age)
    ? filters.age
    : String(ages.at(-1) ?? "");
  const startYear = years.includes(filters.startYear)
    ? filters.startYear
    : (years[0] ?? "");
  const endYear = years.includes(filters.endYear)
    ? filters.endYear
    : (years.at(-1) ?? "");
  const invalidYears = mode === "years" && startYear > endYear;
  const unavailableFilter =
    (mode === "age" && !age) || (mode === "years" && !years.length);
  const filteredUrl =
    !baseUrl || !details || mode === "all" || invalidYears || unavailableFilter
      ? null
      : timesUrl("my_times", {
          athleteId: athlete.id,
          course,
          rankPeriod: "all",
          ...(mode === "age"
            ? { ageAtSwim: Number(age) }
            : { startYear, endYear }),
        });
  const debouncedUrl = useDebouncedSearch(filteredUrl ?? "");
  const filtered = useTimes(
    filteredUrl && debouncedUrl === filteredUrl ? filteredUrl : null,
  );
  const result = mode === "all" ? overview : filtered;
  const data =
    result.data?.myTimes?.period === "all" ? result.data.myTimes : undefined;
  const loading =
    overview.loading ||
    (Boolean(filteredUrl) &&
      (debouncedUrl !== filteredUrl || filtered.loading));
  const events = data?.events ?? [];
  const bestCount = events.filter((event) => event.race !== null).length;
  const eventRanks = new Map(
    events.map((event) => [
      event.event,
      event.race ? motivationalRankForRace(event.race, standards.sets) : null,
    ]),
  );
  const rankCounts: Record<string, number> = {};
  for (const result of eventRanks.values()) {
    if (result) {
      const tier = result.rank.tier;
      rankCounts[tier] = (rankCounts[tier] ?? 0) + 1;
    }
  }
  const bestDescription =
    mode === "age"
      ? `Best at age ${age}`
      : mode === "years"
        ? `Best in ${startYear === endYear ? startYear : `${startYear}–${endYear}`}`
        : "All-time best";

  function openRankings(event: MyTimesEvent) {
    if (!details) return;
    const race = event.rankRace ?? event.race;
    const fallbackAge = race?.ageAtSwim;
    onRankings({
      event: event.event,
      course,
      gender: event.rankGender || race?.gender || "",
      ageGroup:
        event.rankAgeGroup ||
        details.latestAgeGroup ||
        ageGroups.find(
          ([, , min, max]) =>
            fallbackAge != null && fallbackAge >= min && fallbackAge <= max,
        )?.[0] ||
        "",
    });
  }

  if (!athlete)
    return (
      <div className={s.empty}>
        <UserRound size={28} aria-hidden="true" />
        <h2>Make these times yours</h2>
        <p>
          Choose a Primary Athlete or add Favorite Athletes in your account to
          see their times here.
        </p>
        <Link href="/tools" className={s.accountLink}>
          Choose your athletes <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      </div>
    );

  return (
    <>
      <RankLegend counts={rankCounts} />
      <section className={s.filterPanel} aria-label="Times filters">
        <div
          className={`${filterStyles.heading} ${!filtersOpen ? s.collapsedHeading : ""}`}
        >
          <button
            type="button"
            className={filterStyles.toggle}
            aria-expanded={filtersOpen}
            aria-controls={`${cardId}-filters`}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <ChevronDown size={17} aria-hidden="true" />
            Time filters
          </button>
        </div>
        <div id={`${cardId}-filters`} hidden={!filtersOpen}>
          <div className={`${times.filters} ${s.filters}`}>
            <fieldset className={`${times.courseField} ${s.athletes}`}>
              <legend>Athlete</legend>
              <div className={`${times.chips} ${s.athleteChips}`}>
                {athletes.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={athlete.id === item.id}
                    title={`${item.name} · ${item.id === preferences.primaryAthlete?.id ? "Primary" : "Favorite"} Athlete`}
                    onClick={() => {
                      setAthleteId(item.id);
                      setFilters({ ...defaultFilters, course });
                    }}
                  >
                    {item.name}
                  </button>
                ))}
                <Link href="/tools" className={s.manage}>
                  Manage athletes <ArrowUpRight size={15} aria-hidden="true" />
                </Link>
              </div>
            </fieldset>
            <FilterChips
              label="Course"
              value={course}
              options={[
                ["SCY", "SCY"],
                ["LCM", "LCM"],
                ["SCM", "SCM"],
              ]}
              onChange={(value) => setFilters({ ...filters, course: value })}
            />
            <FilterChips
              label="Best times from"
              value={mode}
              options={[
                ["all", "All time"],
                ["age", "Age"],
                ["years", "Year range"],
              ]}
              onChange={(value) =>
                setFilters({
                  ...filters,
                  mode: value,
                  age,
                  startYear,
                  endYear,
                })
              }
            />
            {mode === "age" && (
              <DiscreteSlider
                label="Age at swim"
                value={age}
                options={ages.map((value) => [String(value), String(value)])}
                onChange={(value) => setFilters({ ...filters, age: value })}
              />
            )}
            {mode === "years" && (
              <div className={s.yearRange}>
                <div className={times.field}>
                  <label htmlFor={`${cardId}-start-year`}>Start year</label>
                  <select
                    id={`${cardId}-start-year`}
                    value={startYear}
                    disabled={!years.length}
                    onChange={(event) =>
                      setFilters({ ...filters, startYear: event.target.value })
                    }
                  >
                    {!years.length && (
                      <option value="">No recorded years</option>
                    )}
                    {years.map((year) => (
                      <option key={year}>{year}</option>
                    ))}
                  </select>
                </div>
                <div className={times.field}>
                  <label htmlFor={`${cardId}-end-year`}>End year</label>
                  <select
                    id={`${cardId}-end-year`}
                    value={endYear}
                    disabled={!years.length}
                    onChange={(event) =>
                      setFilters({ ...filters, endYear: event.target.value })
                    }
                  >
                    {!years.length && (
                      <option value="">No recorded years</option>
                    )}
                    {years.map((year) => (
                      <option key={year}>{year}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            {invalidYears && (
              <p className={s.filterNotice} role="alert">
                Start year must be earlier than or equal to end year.
              </p>
            )}
          </div>
        </div>
      </section>
      {details && (
        <div className={s.summary}>
          <span>
            {bestDescription} · {course}
          </span>
          <span>
            All-time team ranks
            {details.latestAgeGroup
              ? ` · ${cohortLabel(details.latestAgeGroup)}`
              : ""}
          </span>
        </div>
      )}
      {(overview.error || result.error) && (
        <p role="alert" className={s.notice}>
          {overview.error || result.error}{" "}
          <button
            type="button"
            className={times.link}
            onClick={() => (overview.error ? overview : result).retry()}
          >
            Try again
          </button>
        </p>
      )}
      {loading && (
        <p role="status" className={s.notice}>
          Loading athlete times…
        </p>
      )}
      {!loading &&
        !overview.error &&
        !result.error &&
        !invalidYears &&
        (unavailableFilter ? (
          <p role="status" className={s.notice}>
            No recorded {mode === "age" ? "ages" : "years"} are available for
            this athlete and course.
          </p>
        ) : data && events.length === 0 ? (
          <p role="status" className={s.notice}>
            No eligible individual times are available for {athlete.name} in{" "}
            {course} yet.
          </p>
        ) : (
          data && (
            <>
              {bestCount === 0 && (
                <p role="status" className={s.notice}>
                  No times match these filters. All-time team ranks are still
                  shown where available.
                </p>
              )}
              <div className={grid.grid}>
                {strokeColumns.map(([stroke, heading, title]) => {
                  const cards = events
                    .filter((event) => eventColumn(event.event) === stroke)
                    .sort((a, b) => compareEvents(a.event, b.event));
                  return (
                    <section
                      className={grid.column}
                      key={stroke}
                      aria-label={title}
                    >
                      <h2 title={title}>{heading}</h2>
                      {cards.length === 0 && (
                        <p className={s.noEvents}>No events</p>
                      )}
                      {cards.map((event) => {
                        const rank = eventRanks.get(event.event);
                        return (
                          <button
                            type="button"
                            key={event.event}
                            className={`${grid.chip} ${s.card}`}
                            data-rank={rank?.rank.tier}
                            style={
                              rank
                                ? ({
                                    "--rank-color": rank.rank.color,
                                  } as CSSProperties)
                                : undefined
                            }
                            aria-label={`View ${eventLabel(event.event)} rankings`}
                            aria-describedby={`${cardId}-${event.event}-time ${cardId}-${event.event}-date ${cardId}-${event.event}-rank${rank ? ` ${cardId}-${event.event}-motivational` : ""}`}
                            onClick={() => openRankings(event)}
                          >
                            <span className={s.cardHeading}>
                              <span className={grid.distance}>
                                {event.event.split("_")[0]}{" "}
                                {stroke === "DST" ? "Free" : heading}
                              </span>
                              {rank && (
                                <>
                                  <MotivationalRankIcon
                                    tier={rank.rank.tier}
                                    size={24}
                                  />
                                  <span
                                    className="sr-only"
                                    id={`${cardId}-${event.event}-motivational`}
                                  >
                                    {rank.rank.name} rank: {rank.rank.tier}{" "}
                                    motivational standard
                                  </span>
                                </>
                              )}
                            </span>
                            <strong id={`${cardId}-${event.event}-time`}>
                              <span className="sr-only">Best time: </span>
                              {event.race
                                ? formatSwimTime(event.race.time)
                                : "—"}
                            </strong>
                            <span
                              className={s.raceDate}
                              id={`${cardId}-${event.event}-date`}
                            >
                              {event.race ? (
                                <>
                                  <time dateTime={event.race.date.slice(0, 10)}>
                                    {swimDate(event.race.date)}
                                  </time>{" "}
                                  <span className={s.swimAge}>
                                    ({swimAgeGroup(event.race.ageAtSwim)})
                                  </span>
                                </>
                              ) : (
                                "No time in this selection"
                              )}
                            </span>
                            <span
                              className={s.teamRank}
                              id={`${cardId}-${event.event}-rank`}
                            >
                              {event.allTimeRank !== null ? (
                                <>
                                  Team #{event.allTimeRank}
                                  <span>
                                    of {event.allTimeCount} ·{" "}
                                    {cohortLabel(
                                      event.rankAgeGroup,
                                      event.rankGender,
                                    )}
                                  </span>
                                </>
                              ) : (
                                <>
                                  {data.latestAgeGroup
                                    ? "No all-time rank"
                                    : "Age unavailable"}
                                </>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </section>
                  );
                })}
              </div>
            </>
          )
        ))}
      {standards.error && (
        <p className={s.notice} role="alert">
          Motivational ranks are temporarily unavailable.{" "}
          <button
            type="button"
            className={times.link}
            onClick={standards.retry}
          >
            Retry standards
          </button>
        </p>
      )}
      <p className={s.explainer}>
        Team ranks compare all recorded times within the selected athlete’s
        latest recorded age group. Select a card for all-time rankings of
        swimmers in the same age group, gender, event, and course. Icons use the
        USA Swimming standard in effect on the displayed swim’s date.
      </p>
    </>
  );
}

function FollowedAthletes({
  userId,
  ...props
}: { userId: string } & Omit<
  Parameters<typeof MyTimesResults>[0],
  "preferences"
>) {
  const [preferences, setPreferences] = useState<AccountAthletePreferences>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let version = 0;
    const refresh = () => {
      const request = ++version;
      void loadAccountAthletes(userId)
        .then((result) => {
          if (active && request === version) {
            setPreferences(result);
            setFailed(false);
          }
        })
        .catch(() => {
          if (active && request === version) setFailed(true);
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, [userId, attempt]);
  if (failed)
    return (
      <p role="alert" className={s.notice}>
        Your followed athletes couldn’t be loaded.{" "}
        <button
          type="button"
          className={times.link}
          onClick={() => {
            setFailed(false);
            setAttempt((value) => value + 1);
          }}
        >
          Try again
        </button>
      </p>
    );
  if (!preferences)
    return (
      <p role="status" className={s.notice}>
        Loading your athletes…
      </p>
    );
  return <MyTimesResults preferences={preferences} {...props} />;
}

export default function MyTimes(
  props: Omit<Parameters<typeof MyTimesResults>[0], "preferences">,
) {
  const { user, loading } = useAuth();
  return (
    <section className={`${grid.page} ${s.page}`} aria-label="Times">
      {loading ? (
        <p role="status">Loading your account…</p>
      ) : !user ? (
        <p className={s.notice}>
          <Link href="/login">Sign in</Link> to see the athletes you follow.
        </p>
      ) : hasBackendConfiguration ? (
        <FollowedAthletes key={user.uid} userId={user.uid} {...props} />
      ) : (
        <p className={s.notice}>
          Your times are unavailable while the database is disconnected.
        </p>
      )}
    </section>
  );
}
