"use client";

import Link from "next/link";
import { ArrowUpRight, Star, UserRound } from "lucide-react";
import { useEffect, useId, useState } from "react";
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
import { FilterChips, PopupPicker } from "./TimesFilters";
import DiscreteSlider from "./DiscreteSlider";
import { MotivationalRankIcon, RankLegend } from "./MotivationalRankIcon";
import { motivationalRankForRace } from "./motivational-ranks";
import grid from "./TimeStandards.module.css";
import times from "./TimesDatabase.module.css";
import s from "./MyTimes.module.css";

export type MyTimesRankingSelection = {
  event: string;
  course: string;
  gender: string;
  ageGroup: string;
  startDate: string;
  endDate: string;
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
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    },
  );
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
    ? timesUrl("my_times", { athleteId: athlete.id, course })
    : null;
  const overview = useTimes(baseUrl);
  const details = overview.data?.myTimes;
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
          ...(mode === "age"
            ? { ageAtSwim: Number(age) }
            : { startYear, endYear }),
        });
  const debouncedUrl = useDebouncedSearch(filteredUrl ?? "");
  const filtered = useTimes(
    filteredUrl && debouncedUrl === filteredUrl ? filteredUrl : null,
  );
  const result = mode === "all" ? overview : filtered;
  const data = result.data?.myTimes;
  const loading =
    overview.loading ||
    (Boolean(filteredUrl) &&
      (debouncedUrl !== filteredUrl || filtered.loading));
  const events = data?.events ?? [];
  const bestCount = events.filter((event) => event.race !== null).length;
  const primary = athlete?.id === preferences.primaryAthlete?.id;
  const bestDescription =
    mode === "age"
      ? `Best at age ${age}`
      : mode === "years"
        ? `Best in ${startYear === endYear ? startYear : `${startYear}–${endYear}`}`
        : "All-time best";

  function openRankings(event: MyTimesEvent) {
    if (!details) return;
    const race = event.seasonRace ?? event.race;
    const fallbackAge = race?.ageAtSwim;
    onRankings({
      event: event.event,
      course,
      gender: event.rankGender || race?.gender || "",
      ageGroup:
        event.rankAgeGroup ||
        details.seasonAgeGroup ||
        ageGroups.find(
          ([, , min, max]) =>
            fallbackAge != null && fallbackAge >= min && fallbackAge <= max,
        )?.[0] ||
        "",
      startDate: details.seasonStart,
      endDate: details.seasonEnd,
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
      <div className={s.athleteHeader}>
        <div>
          <p className={s.athleteRole}>
            {primary ? (
              <UserRound size={14} aria-hidden="true" />
            ) : (
              <Star size={14} aria-hidden="true" />
            )}
            {primary ? "Primary Athlete" : "Favorite Athlete"}
          </p>
          <h2>{athlete.name}</h2>
          {athlete.teamName && <p className={s.muted}>{athlete.teamName}</p>}
        </div>
        <Link href="/tools" className={s.manage}>
          Manage athletes <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      </div>
      <section
        className={`${times.filters} ${s.filters}`}
        aria-label="My Times filters"
      >
        <PopupPicker
          label="Athlete"
          value={athlete.id}
          options={athletes.map((item) => [
            item.id,
            `${item.name} · ${item.id === preferences.primaryAthlete?.id ? "Primary" : "Favorite"}`,
          ])}
          searchPlaceholder="Find a followed athlete"
          onChange={(id) => {
            setAthleteId(id);
            setFilters({ ...defaultFilters, course });
          }}
        />
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
        <div className={s.periodFilter}>
          <FilterChips
            label="Best times from"
            value={mode}
            options={[
              ["all", "All time"],
              ["age", "Age"],
              ["years", "Year range"],
            ]}
            onChange={(value) =>
              setFilters({ ...filters, mode: value, age, startYear, endYear })
            }
          />
        </div>
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
                {!years.length && <option value="">No recorded years</option>}
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
                {!years.length && <option value="">No recorded years</option>}
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
      </section>
      {details && (
        <div className={s.summary}>
          <span>
            {bestDescription} · {course}
          </span>
          <span>
            Team ranks: {details.seasonLabel} season
            {details.seasonAgeGroup
              ? ` · ${cohortLabel(details.seasonAgeGroup)}`
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
                  No times match these filters. Current-season team ranks are
                  still shown where available.
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
                        const rank = event.race
                          ? motivationalRankForRace(event.race, standards.sets)
                          : null;
                        return (
                          <button
                            type="button"
                            key={event.event}
                            className={`${grid.chip} ${s.card}`}
                            aria-label={`View ${eventLabel(event.event)} season rankings`}
                            aria-describedby={`${cardId}-${event.event}-time ${cardId}-${event.event}-rank${rank ? ` ${cardId}-${event.event}-motivational` : ""}`}
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
                            <span className={s.raceDate}>
                              {event.race
                                ? swimDate(event.race.date)
                                : "No time in this selection"}
                            </span>
                            <span
                              className={s.seasonRank}
                              id={`${cardId}-${event.event}-rank`}
                            >
                              {event.seasonRank !== null ? (
                                <>
                                  Team #{event.seasonRank}
                                  <span>
                                    of {event.seasonCount} ·{" "}
                                    {cohortLabel(
                                      event.rankAgeGroup,
                                      event.rankGender,
                                    )}
                                  </span>
                                </>
                              ) : (
                                <>
                                  {data.seasonAgeGroup
                                    ? "No season rank"
                                    : "Age unavailable"}
                                  <span>{data.seasonLabel}</span>
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
        Team ranks use the current September–August season and the selected
        athlete’s latest recorded age group. Select a card to compare swimmers
        of the same gender, event, and course. Icons use the USA Swimming
        standard in effect on the displayed swim’s date.
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
    <section className={`${grid.page} ${s.page}`} aria-label="My Times">
      <RankLegend />
      <h1 className="text-2xl font-bold">My Times</h1>
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
