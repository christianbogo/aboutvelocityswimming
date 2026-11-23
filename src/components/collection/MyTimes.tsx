"use client";

import Link from "next/link";
import { ArrowUpRight, UserRound } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useAuth } from "@/features/workshare/contexts/auth";
import { formatSwimTime } from "@/features/swim-resources/lib/domain/swim-time";
import {
  loadAccountAthlete,
  type AccountAthlete,
  loadAccountAthletes,
  cachedAccountAthletes,
  accountAthletesChangedEvent,
  type AccountAthletePreferences,
} from "@/lib/account-athletes";
import { hasBackendConfiguration } from "@/lib/supabase/client";
import { ageGroups, eventLabel } from "./times-data";
import { timesUrl, type MyTimesEvent } from "./times-api";
import { useTimes, useDebouncedSearch } from "./use-times";
import type { useStandards } from "./use-standards";
import { useTimesSelection } from "./use-times-selection";
import { useTimesDisplay } from "./use-times-display";
import { strokeColumns, eventColumn, compareEvents } from "./event-layout";
import { MotivationalRankIcon } from "./MotivationalRankIcon";
import { motivationalRankForRace } from "./motivational-ranks";
import grid from "./TimeStandards.module.css";
import times from "./TimesDatabase.module.css";
import s from "./MyTimes.module.css";
import MyTimesSkeleton from "./MyTimesSkeleton";
import { SkeletonText } from "./LoadingSkeleton";
import SelectionDropdown from "./TimesSelectionDropdown";
import selectionStyles from "./TimesSelectionDropdown.module.css";

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

function DisplayToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={s.displayToggle}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
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
  const [athleteId, setAthleteId] = useTimesSelection("myAthlete", "");
  const [filters, setFilters] = useTimesSelection("myFilters", defaultFilters);
  const { show25s, showTimeStats, showDateAge, change, status, ready } =
    useTimesDisplay();
  const athletes = [
    ...(preferences.primaryAthlete ? [preferences.primaryAthlete] : []),
    ...preferences.favoriteAthletes.filter(
      (athlete) => athlete.id !== preferences.primaryAthlete?.id,
    ),
  ];
  const followed = athletes.find((item) => item.id === athleteId);
  const [sharedAthlete, setSharedAthlete] = useState<{
    id: string;
    athlete: AccountAthlete | null;
    failed: boolean;
  } | null>(null);
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const needsLookup = Boolean(athleteId && !followed);
  useEffect(() => {
    if (!needsLookup) return;
    const controller = new AbortController();
    void loadAccountAthlete(athleteId, controller.signal).then(
      (athlete) => {
        if (!controller.signal.aborted)
          setSharedAthlete({ id: athleteId, athlete, failed: false });
      },
      () => {
        if (!controller.signal.aborted)
          setSharedAthlete({ id: athleteId, athlete: null, failed: true });
      },
    );
    return () => controller.abort();
  }, [athleteId, needsLookup, lookupAttempt]);
  const resolved = sharedAthlete?.id === athleteId ? sharedAthlete : null;
  const athlete = athleteId ? (followed ?? resolved?.athlete) : athletes[0];
  if (needsLookup && resolved?.athlete) athletes.push(resolved.athlete);
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
    overview.data?.myTimes?.period === "all" &&
    overview.data.myTimes.athleteId === athlete?.id
      ? overview.data.myTimes
      : undefined;
  const ages = details?.ages ?? [];
  const years = [...(details?.years ?? [])].sort();
  const fallbackAge = /^\d{1,3}$/.test(filters.age)
    ? Number(filters.age)
    : (details?.latestAge ?? ages.at(-1) ?? -1);
  const age = ageGroups.some(([key]) => key === filters.age)
    ? filters.age
    : (ageGroups.find(
        ([, , min, max]) => fallbackAge >= min && fallbackAge <= max,
      )?.[0] ?? "11-12");
  const startYear = years.includes(filters.startYear)
    ? filters.startYear
    : (years[0] ?? "");
  const endYear = years.includes(filters.endYear)
    ? filters.endYear
    : (years.at(-1) ?? "");
  const invalidYears = mode === "years" && startYear > endYear;
  const unavailableFilter = mode === "years" && !years.length;
  const filteredUrl =
    !athlete ||
    !baseUrl ||
    !details ||
    mode === "all" ||
    invalidYears ||
    unavailableFilter
      ? null
      : timesUrl("my_times", {
          athleteId: athlete.id,
          course,
          rankPeriod: "all",
          ...(mode === "age" ? { ageGroup: age } : { startYear, endYear }),
        });
  const debouncedUrl = useDebouncedSearch(filteredUrl ?? "");
  const filtered = useTimes(
    filteredUrl && debouncedUrl === filteredUrl ? filteredUrl : null,
  );
  const failedQuery = overview.error ? overview : filtered;
  const loading =
    overview.loading ||
    (Boolean(filteredUrl) &&
      (debouncedUrl !== filteredUrl || filtered.loading));
  const filteredDetails = filtered.data?.myTimes;
  const selectedEvents =
    mode === "all"
      ? details?.events
      : filteredDetails?.period === "all"
        ? filteredDetails.events
        : undefined;
  const events = selectedEvents?.filter(
    (event) => show25s || !event.event.startsWith("25_"),
  );
  const bestCount = events?.filter((event) => event.race !== null).length ?? 0;
  const eventRanks = new Map(
    events?.map((event) => [
      event.event,
      event.race ? motivationalRankForRace(event.race, standards.sets) : null,
    ]),
  );
  function openRankings(event: MyTimesEvent) {
    if (!details) return;
    const race = event.race;
    const fallbackAge = race?.ageAtSwim;
    onRankings({
      event: event.event,
      course,
      gender: event.rankGender || race?.gender || "",
      ageGroup:
        event.rankAgeGroup ||
        ageGroups.find(
          ([, , min, max]) =>
            fallbackAge != null && fallbackAge >= min && fallbackAge <= max,
        )?.[0] ||
        "",
    });
  }

  if (needsLookup && !resolved) return <MyTimesLoading />;
  if (needsLookup && !athlete)
    return (
      <p className={s.notice} role={resolved?.failed ? "alert" : "status"}>
        {resolved?.failed
          ? "This swimmer’s profile couldn’t be loaded."
          : "This swimmer’s profile is unavailable."}{" "}
        {resolved?.failed && (
          <button
            type="button"
            className={times.link}
            onClick={() => {
              setSharedAthlete(null);
              setLookupAttempt((value) => value + 1);
            }}
          >
            Try again
          </button>
        )}
      </p>
    );

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
    <section
      className={s.results}
      aria-label="Athlete times"
      aria-busy={loading}
    >
      <section
        className={`${selectionStyles.filterPanel} ${s.filters}`}
        aria-label="Times filters"
      >
        <SelectionDropdown label="Athlete" selection={athlete.name}>
          {(close) => (
            <>
              {athletes.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={athlete.id === item.id}
                  onClick={() => {
                    setAthleteId(item.id);
                    setFilters({ ...defaultFilters, course });
                    close();
                  }}
                >
                  {item.name}
                </button>
              ))}
              <Link href="/tools" className={s.manage}>
                Manage athletes <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            </>
          )}
        </SelectionDropdown>
        <SelectionDropdown
          label="Course"
          selection={
            {
              SCY: "Short Course Yards",
              LCM: "Long Course Meters",
              SCM: "Short Course Meters",
            }[course]!
          }
        >
          {(close) =>
            [
              ["SCY", "Short Course Yards"],
              ["LCM", "Long Course Meters"],
              ["SCM", "Short Course Meters"],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={course === key}
                onClick={() => {
                  setFilters((current) => ({ ...current, course: key }));
                  close();
                }}
              >
                {label}
              </button>
            ))
          }
        </SelectionDropdown>
        <SelectionDropdown
          label="Best times from"
          selection={
            { all: "All-Time", age: "Age Range", years: "Year Range" }[mode]!
          }
        >
          {(close) =>
            [
              ["all", "All-Time"],
              ["age", "Age Range"],
              ["years", "Year Range"],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={mode === key}
                onClick={() => {
                  setFilters({
                    ...filters,
                    mode: key,
                    age,
                    startYear,
                    endYear,
                  });
                  close();
                }}
              >
                {label}
              </button>
            ))
          }
        </SelectionDropdown>
        {mode === "age" && (
          <SelectionDropdown
            label="Age Range"
            selection={ageGroups.find(([key]) => key === age)?.[1] ?? age}
          >
            {(close) =>
              ageGroups.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={age === key}
                  onClick={() => {
                    setFilters((current) => ({ ...current, age: key }));
                    close();
                  }}
                >
                  {label}
                </button>
              ))
            }
          </SelectionDropdown>
        )}
        {mode === "years" && (
          <SelectionDropdown
            label="Year Range"
            selection={
              startYear === endYear
                ? startYear || "No recorded years"
                : `${startYear}–${endYear}`
            }
          >
            {() => (
              <div className={s.yearRange}>
                {[
                  ["startYear", "Start year", startYear],
                  ["endYear", "End year", endYear],
                ].map(([key, label, value]) => (
                  <div key={key} className={times.field}>
                    <label htmlFor={`${cardId}-${key}`}>{label}</label>
                    <select
                      id={`${cardId}-${key}`}
                      value={value}
                      disabled={!years.length}
                      onChange={(event) => {
                        const value = event.target.value;
                        setFilters((current) => ({ ...current, [key]: value }));
                      }}
                    >
                      {!years.length && (
                        <option value="">No recorded years</option>
                      )}
                      {years.map((year) => (
                        <option key={year}>{year}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </SelectionDropdown>
        )}
        {invalidYears && (
          <p className={s.filterNotice} role="alert">
            Start year must be earlier than or equal to end year.
          </p>
        )}
      </section>
      <div
        className={s.displayOptions}
        role="group"
        aria-label="Times display options"
      >
        <DisplayToggle
          label="Show 25s"
          checked={show25s}
          onChange={(checked) => change("show25s", checked)}
          disabled={!ready}
        />
        <DisplayToggle
          label="Show time stats"
          checked={showTimeStats}
          onChange={(checked) => change("showTimeStats", checked)}
          disabled={!ready}
        />
        <DisplayToggle
          label="Show date & age"
          checked={showDateAge}
          onChange={(checked) => change("showDateAge", checked)}
          disabled={!ready}
        />
      </div>
      {status && (
        <p className={s.preferenceStatus} role="status">
          {status}
        </p>
      )}
      {failedQuery.error && (
        <p role="alert" className={s.notice}>
          {failedQuery.error}{" "}
          <button
            type="button"
            className={times.link}
            onClick={failedQuery.retry}
          >
            Try again
          </button>
        </p>
      )}
      {loading && (
        <MyTimesSkeleton
          course={course}
          events={
            details?.events ??
            (overview.placeholderData?.myTimes?.period === "all" &&
            overview.placeholderData.myTimes.athleteId === athlete.id
              ? overview.placeholderData.myTimes.events
              : undefined)
          }
          full={false}
          hide25s={!show25s}
          showTimeStats={showTimeStats}
          showDateAge={showDateAge}
        />
      )}
      {!loading &&
        !failedQuery.error &&
        !invalidYears &&
        (unavailableFilter ? (
          <p role="status" className={s.notice}>
            No recorded years are available for this athlete and course.
          </p>
        ) : events?.length === 0 ? (
          <p role="status" className={s.notice}>
            No eligible individual times are available for {athlete.name} in{" "}
            {course} yet.
          </p>
        ) : (
          events && (
            <>
              {bestCount === 0 && (
                <p role="status" className={s.notice}>
                  No times match these filters.
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
                            aria-label={`View ${eventLabel(event.event)} rankings`}
                            aria-describedby={[
                              `${cardId}-${event.event}-time`,
                              ...(showDateAge
                                ? [`${cardId}-${event.event}-date`]
                                : []),
                              ...(showTimeStats
                                ? [`${cardId}-${event.event}-rank`]
                                : []),
                              ...(showTimeStats && rank
                                ? [`${cardId}-${event.event}-motivational`]
                                : []),
                            ].join(" ")}
                            onClick={() => openRankings(event)}
                          >
                            <span className={s.cardHeader}>
                              <span className={s.cardHeading}>
                                <span className={grid.distance}>
                                  {event.event.split("_")[0]}{" "}
                                  {stroke === "DST" ? "Free" : heading}
                                </span>
                              </span>
                              {showTimeStats &&
                                (rank ||
                                  (standards.loading &&
                                    !standards.sets.length)) && (
                                  <span className={s.rankIcon}>
                                    {standards.loading &&
                                    !standards.sets.length ? (
                                      <SkeletonText
                                        width="100%"
                                        height="100%"
                                      />
                                    ) : (
                                      rank && (
                                        <>
                                          <MotivationalRankIcon
                                            tier={rank.rank.tier}
                                            size={28}
                                          />
                                          <span
                                            className="sr-only"
                                            id={`${cardId}-${event.event}-motivational`}
                                          >
                                            {rank.rank.name} rank:{" "}
                                            {rank.rank.tier} motivational
                                            standard
                                          </span>
                                        </>
                                      )
                                    )}
                                  </span>
                                )}
                            </span>
                            <strong id={`${cardId}-${event.event}-time`}>
                              <span className="sr-only">
                                {event.race
                                  ? "Best time: "
                                  : "No time in this selection: "}
                              </span>
                              {event.race
                                ? formatSwimTime(event.race.time)
                                : "—"}
                            </strong>
                            {showDateAge && (
                              <span
                                className={s.raceDate}
                                id={`${cardId}-${event.event}-date`}
                              >
                                {event.race ? (
                                  <>
                                    <time
                                      dateTime={event.race.date.slice(0, 10)}
                                    >
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
                            )}
                            {showTimeStats && (
                              <span
                                className={s.teamRank}
                                id={`${cardId}-${event.event}-rank`}
                              >
                                {event.allTimeRank !== null ? (
                                  <>Rank #{event.allTimeRank}</>
                                ) : (
                                  <>
                                    {event.race?.ageAtSwim != null
                                      ? "No all-time rank"
                                      : "Age unavailable"}
                                  </>
                                )}
                              </span>
                            )}
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
      {standards.error && showTimeStats && (
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
      {showTimeStats && (
        <p className={s.explainer}>
          Team ranks compare the displayed time with each swimmer’s all-time
          best in that swim’s age group. Select a card for all-time rankings of
          swimmers in the same age group, gender, event, and course. Icons use
          the USA Swimming standard in effect on the displayed swim’s date.
        </p>
      )}
    </section>
  );
}

function MyTimesLoading() {
  return <MyTimesSkeleton />;
}

function FollowedAthletes({
  userId,
  ...props
}: { userId: string } & Omit<
  Parameters<typeof MyTimesResults>[0],
  "preferences"
>) {
  const [preferences, setPreferences] = useState<
    AccountAthletePreferences | undefined
  >(() => cachedAccountAthletes(userId));
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
    window.addEventListener(accountAthletesChangedEvent, refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener(accountAthletesChangedEvent, refresh);
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
      <div aria-busy="true">
        <MyTimesLoading />
      </div>
    );
  return <MyTimesResults preferences={preferences} {...props} />;
}

export default function MyTimes(
  props: Omit<Parameters<typeof MyTimesResults>[0], "preferences">,
) {
  const { user, loading } = useAuth();
  return (
    <section
      className={`${grid.page} ${s.page}`}
      aria-label="Times"
      aria-busy={loading || undefined}
    >
      {loading ? (
        <MyTimesLoading />
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
