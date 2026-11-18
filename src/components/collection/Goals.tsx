"use client";

import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Compass,
  Flag,
  Star,
  Target,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/features/workshare/contexts/auth";
import { formatSwimTime } from "@/features/swim-resources/lib/domain/swim-time";
import {
  accountAthletesChangedEvent,
  cachedAccountAthletes,
  loadAccountAthletes,
  type AccountAthletePreferences,
} from "@/lib/account-athletes";
import { hasBackendConfiguration } from "@/lib/supabase/client";
import {
  boardGoals,
  closestMove,
  goalAgeGroup,
  standardGoals,
  strongEvents,
  untriedEvents,
  type GoalTarget,
} from "./goals-data";
import { eventLabel, initialFilters } from "./times-data";
import { timesUrl, type MyTimesEvent } from "./times-api";
import { useTimes } from "./use-times";
import { useTimesSelection } from "./use-times-selection";
import { useStandards } from "./use-standards";
import { useGoalBoards } from "./use-goal-boards";
import s from "./Goals.module.css";

const courses = {
  SCY: "Short course yards",
  LCM: "Long course meters",
  SCM: "Short course meters",
};
const targetKinds = [
  ["all", "All goals"],
  ["motivational", "USA standards"],
  ["championship", "Championships"],
  ["board", "Record board"],
] as const;
type TargetKind = (typeof targetKinds)[number][0];
const emptyEvents: MyTimesEvent[] = [];

function today() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
}

function rankingHref(event: MyTimesEvent) {
  return `/tools/rankings?${new URLSearchParams({
    filters: JSON.stringify({
      ...initialFilters,
      event: event.event,
      course: event.race?.course ?? "SCY",
      genders: event.rankGender ? [event.rankGender] : [],
      ageGroups: event.rankAgeGroup ? [event.rankAgeGroup] : [],
    }),
  })}`;
}

function PageFrame({ children }: { children: ReactNode }) {
  return (
    <main className={s.page} aria-labelledby="goals-heading">
      <header className={s.header}>
        <div className={s.eyebrow}>
          <span className={s.badge}>Concept</span> A little direction for the
          next great swim
        </div>
        <h1 id="goals-heading">
          Goals<span className={s.headingDot}>.</span>
        </h1>
        <p>Find the next milestone. Make a move. Try something new.</p>
      </header>
      {children}
    </main>
  );
}

export function GoalsLoading() {
  return (
    <PageFrame>
      <div className={s.loading} role="status">
        <Target size={24} aria-hidden="true" /> Finding the next possibilities…
      </div>
    </PageFrame>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className={s.notice} role="status">
      {children}
    </p>
  );
}

function GoalLine({ target }: { target: GoalTarget }) {
  const kind =
    target.kind === "motivational"
      ? "USA standard"
      : target.kind === "championship"
        ? "Championship"
        : "All-time team board";
  return (
    <li className={s.goalLine}>
      <div>
        <span className={s.smallLabel}>{kind}</span>
        <strong>{target.label}</strong>
        {target.season && <span className={s.season}>{target.season}</span>}
      </div>
      <div className={s.targetTime}>
        <strong>{formatSwimTime(target.time)}</strong>
        <span>
          <ArrowDownRight size={13} aria-hidden="true" />
          {formatSwimTime(target.drop)}{" "}
          <span className={s.dropLabel}>to drop</span>
        </span>
      </div>
      <div className={s.goalFoot}>
        <span>{target.percent.toFixed(2)}% improvement</span>
        {target.sourceUrl && (
          <a href={target.sourceUrl} target="_blank" rel="noreferrer">
            Official standard <ArrowUpRight size={12} aria-hidden="true" />
          </a>
        )}
      </div>
    </li>
  );
}

function AthleteGoals({
  preferences,
}: {
  preferences: AccountAthletePreferences;
}) {
  const [selectedAthlete, setAthlete] = useTimesSelection("goalAthlete", "");
  const [selectedCourse, setCourse] = useTimesSelection("goalCourse", "SCY");
  const [selectedAge, setAge] = useTimesSelection("goalAge", "");
  const [kindValue, setKind] = useTimesSelection("goalKind", "all");
  const [moveSort, setMoveSort] = useState("percent");
  const [showAllMoves, setShowAllMoves] = useState(false);
  const [showAllNew, setShowAllNew] = useState(false);
  const athletes = [
    ...(preferences.primaryAthlete ? [preferences.primaryAthlete] : []),
    ...preferences.favoriteAthletes.filter(
      (athlete) => athlete.id !== preferences.primaryAthlete?.id,
    ),
  ];
  const athlete =
    athletes.find((athlete) => athlete.id === selectedAthlete) ?? athletes[0];
  const course = Object.hasOwn(courses, selectedCourse)
    ? (selectedCourse as keyof typeof courses)
    : "SCY";
  const kind: TargetKind =
    targetKinds.find(([value]) => value === kindValue)?.[0] ?? "all";
  const overview = useTimes(
    athlete
      ? timesUrl("my_times", {
          athleteId: athlete.id,
          course,
          rankPeriod: "all",
        })
      : null,
  );
  const history =
    overview.data?.myTimes?.period === "all" &&
    overview.data.myTimes.athleteId === athlete?.id
      ? overview.data.myTimes
      : undefined;
  const enteredAge =
    /^\d{1,3}$/.test(selectedAge) && Number(selectedAge) <= 120
      ? Number(selectedAge)
      : null;
  const invalidAge = selectedAge !== "" && enteredAge == null;
  const age = selectedAge !== "" ? enteredAge : (history?.latestAge ?? null);
  const group = goalAgeGroup(age);
  const cohort = useTimes(
    athlete && group && history
      ? timesUrl("my_times", {
          athleteId: athlete.id,
          course,
          rankPeriod: "all",
          ageGroup: group,
        })
      : null,
  );
  const cohortDetails =
    cohort.data?.myTimes?.period === "all" ? cohort.data.myTimes : undefined;
  const events = cohortDetails?.events ?? emptyEvents;
  const standards = useStandards(Boolean(athlete));
  const boards = useGoalBoards(events, Boolean(cohortDetails));
  const day = today();
  const cohortByEvent = new Map(events.map((event) => [event.event, event]));
  const referenceEvents = new Set<string>();
  const goalEvents = (history?.events ?? []).map((event) => {
    const current = cohortByEvent.get(event.event);
    if (current?.race) return current;
    referenceEvents.add(event.event);
    // An older PB can guide a new age-group goal, but cannot claim a rank there.
    return {
      ...event,
      rankRace: null,
      allTimeRank: null,
      allTimeCount: 0,
      rankAgeGroup: group,
      rankGender: event.race?.gender ?? null,
    };
  });
  const strong = strongEvents(
    invalidAge ? emptyEvents : goalEvents,
    standards.sets,
    age,
    day,
  )
    .filter(
      (event) => age == null || age <= 10 || !event.event.startsWith("25_"),
    )
    .slice(0, 3);
  const suggestions = history
    ? untriedEvents(history.events, course, age, strong)
    : [];
  const moves = events
    .flatMap((event) => {
      const move = closestMove(event, boards.boards[event.event]?.rows ?? []);
      return move ? [{ ...move, entry: event }] : [];
    })
    .sort(
      (a, b) =>
        (moveSort === "seconds" ? a.drop - b.drop : a.percent - b.percent) ||
        a.event.localeCompare(b.event),
    );
  const boardFailures = Object.values(boards.boards).filter(
    (board) => board.error,
  ).length;
  const knownEvents = history?.events.filter((event) => event.race).length ?? 0;
  const loading = overview.loading || cohort.loading;
  const queryError = overview.error ? overview : cohort.error ? cohort : null;

  if (!athlete)
    return (
      <section className={s.empty}>
        <UserRound size={32} aria-hidden="true" />
        <h2>Whose next chapter?</h2>
        <p>
          Choose a primary athlete or add favorites to start exploring their
          goals.
        </p>
        <Link className={s.button} href="/tools">
          Choose your athletes <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </section>
    );

  return (
    <>
      <section className={s.selection} aria-label="Goals filters">
        <label className={s.athleteField}>
          <span>Athlete</span>
          <select
            aria-label="Athlete"
            value={athlete.id}
            onChange={(event) => {
              setAthlete(event.target.value);
              setAge("");
            }}
          >
            {athletes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.id === preferences.primaryAthlete?.id
                  ? " · Primary"
                  : " · Favorite"}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Course</span>
          <select
            aria-label="Course"
            value={course}
            onChange={(event) => setCourse(event.target.value)}
          >
            {Object.entries(courses).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={s.ageField}>
          <span>Age for goals</span>
          <input
            type="number"
            aria-label="Age for goals"
            min="0"
            max="120"
            step="1"
            value={selectedAge}
            placeholder={String(history?.latestAge ?? "Age")}
            aria-invalid={invalidAge || undefined}
            aria-describedby={
              invalidAge ? "goal-age-error" : "goal-age-context"
            }
            onChange={(event) => setAge(event.target.value)}
          />
        </label>
        <Link className={s.manage} href="/tools">
          Manage athletes <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </section>
      <p id="goal-age-context" className={s.context}>
        {selectedAge === "" && history?.latestAge != null
          ? `Using age ${history.latestAge}, the last recorded age, not a verified current age. `
          : ""}
        Set the age at the next meet. Goals use{" "}
        {group
          ? `${group.replaceAll("-", "–")} ${course} bests`
          : "an age group once you choose an age"}
        .
      </p>
      {invalidAge && (
        <p id="goal-age-error" className={s.notice} role="alert">
          Enter a whole-number age from 0 to 120.
        </p>
      )}

      <nav className={s.overview} aria-label="Explore goals">
        <a href="#next-goals">
          <Target size={21} aria-hidden="true" />
          <span>
            <strong>Build on strengths</strong>
            <small>Your next standards & milestones</small>
          </span>
          <ArrowRight size={16} aria-hidden="true" />
        </a>
        <a href="#rank-moves">
          <TrendingUp size={21} aria-hidden="true" />
          <span>
            <strong>Move up the board</strong>
            <small>Small drops. New positions.</small>
          </span>
          <ArrowRight size={16} aria-hidden="true" />
        </a>
        <a href="#new-events">
          <Compass size={21} aria-hidden="true" />
          <span>
            <strong>Find a new event</strong>
            <small>A fresh place to start</small>
          </span>
          <ArrowRight size={16} aria-hidden="true" />
        </a>
      </nav>

      {loading ? (
        <div className={s.loading} role="status">
          Loading {athlete.name}’s best times…
        </div>
      ) : queryError ? (
        <Notice>
          {queryError.error}{" "}
          <button type="button" onClick={queryError.retry}>
            Try again
          </button>
        </Notice>
      ) : (
        <>
          <section
            id="next-goals"
            className={s.section}
            aria-labelledby="next-goals-heading"
          >
            <div className={s.sectionHeading}>
              <span className={s.sectionNumber}>01</span>
              <div>
                <h2 id="next-goals-heading">
                  What’s next in their strongest events?
                </h2>
                <p>Three events to build on, with the next time to chase.</p>
              </div>
            </div>
            <div
              className={s.targetFilters}
              role="group"
              aria-label="Goal type"
            >
              {targetKinds.map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={kind === value}
                  onClick={() => setKind(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {standards.error && (
              <Notice>
                Standards couldn’t be refreshed.{" "}
                <button type="button" onClick={standards.retry}>
                  Retry standards
                </button>
              </Notice>
            )}
            {standards.loading && !standards.sets.length && (
              <Notice>Loading published standards…</Notice>
            )}
            {strong.length ? (
              <div className={s.strengthGrid}>
                {strong.map((event, index) => {
                  const all = [
                    ...standardGoals(event.race!, standards.sets, age, day),
                    ...boardGoals(
                      event,
                      boards.boards[event.event]?.rows ?? [],
                    ),
                  ].sort((a, b) => a.percent - b.percent);
                  const filtered =
                    kind === "all"
                      ? ["motivational", "championship", "board"].flatMap(
                          (category) =>
                            all.find((goal) => goal.kind === category) ?? [],
                        )
                      : all.filter((target) => target.kind === kind);
                  return (
                    <article className={s.strengthCard} key={event.event}>
                      <div className={s.cardEyebrow}>
                        <span>
                          <Star size={13} aria-hidden="true" /> Strength{" "}
                          {index + 1}
                        </span>
                        {event.allTimeRank != null && (
                          <span>Team #{event.allTimeRank}</span>
                        )}
                      </div>
                      <h3>{eventLabel(event.event)}</h3>
                      <div className={s.personalBest}>
                        <strong>{formatSwimTime(event.race!.time)}</strong>
                        <span>
                          {referenceEvents.has(event.event)
                            ? `All-time reference${event.race!.ageAtSwim != null ? ` · swum at age ${event.race!.ageAtSwim}` : " · age unknown"}`
                            : `Best in ${group?.replaceAll("-", "–")} · ${course}`}
                        </span>
                      </div>
                      <ul className={s.goalList}>
                        {filtered.map((target) => (
                          <GoalLine key={target.id} target={target} />
                        ))}
                      </ul>
                      {!filtered.length && (
                        <p className={s.cardEmpty}>
                          {kind === "board" && boards.loading
                            ? "Finding board cutoffs…"
                            : kind === "board" &&
                                referenceEvents.has(event.event)
                              ? "A recorded time in this age group is needed for a board goal."
                              : kind === "board" && event.allTimeRank === 1
                                ? "Already at the top of this team board."
                                : "No further published target available for these filters."}
                        </p>
                      )}
                      <Link className={s.cardLink} href={rankingHref(event)}>
                        Explore event rankings{" "}
                        <ArrowUpRight size={14} aria-hidden="true" />
                      </Link>
                    </article>
                  );
                })}
              </div>
            ) : (
              <Notice>
                {!group
                  ? "Choose an age to find age-appropriate goals."
                  : knownEvents
                    ? `No published bests at ages ${group.replaceAll("-", "–")} in ${course} yet. Try a recorded age or explore a new event below.`
                    : `No published ${course} times yet. Try another course or start with a new event below.`}
              </Notice>
            )}
            <p className={s.method}>
              Strengths compare bests with current USA motivational benchmarks;
              team standing provides a fallback. If an age group has no time, a
              labeled all-time reference helps set standards goals. Targets use
              current published standards and exact-course times. Championship
              times are benchmarks; meet dates, age rules, qualifying windows,
              and entry requirements still apply.
            </p>
          </section>

          <section
            id="rank-moves"
            className={s.section}
            aria-labelledby="rank-moves-heading"
          >
            <div className={s.sectionTop}>
              <div className={s.sectionHeading}>
                <span className={s.sectionNumber}>02</span>
                <div>
                  <h2 id="rank-moves-heading">
                    Where are the closest move-ups?
                  </h2>
                  <p>
                    Every recorded event in this age group, ordered by the next
                    reachable rank.
                  </p>
                </div>
              </div>
              <label className={s.sort}>
                <span>Sort by</span>
                <select
                  value={moveSort}
                  onChange={(event) => setMoveSort(event.target.value)}
                >
                  <option value="percent">Smallest % drop</option>
                  <option value="seconds">Smallest time drop</option>
                </select>
              </label>
            </div>
            {boardFailures > 0 && (
              <Notice>
                {boardFailures} event{" "}
                {boardFailures === 1 ? "board is" : "boards are"} unavailable;
                this list is incomplete.{" "}
                <button type="button" onClick={boards.retry}>
                  Retry rankings
                </button>
              </Notice>
            )}
            {boards.loading && <Notice>Comparing all event boards…</Notice>}
            {moves.length ? (
              <div
                className={s.tableWrap}
                tabIndex={0}
                role="region"
                aria-label="Rank move-ups; scroll across for target times and drops"
              >
                <table className={s.moves}>
                  <caption className="sr-only">
                    Closest all-time Velocity rank improvements for{" "}
                    {athlete.name}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Event</th>
                      <th scope="col">Team rank</th>
                      <th scope="col">Best</th>
                      <th scope="col">Target</th>
                      <th scope="col">Drop needed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(showAllMoves ? moves : moves.slice(0, 6)).map((move) => (
                      <tr key={move.event}>
                        <th scope="row">
                          <Link href={rankingHref(move.entry)}>
                            {eventLabel(move.event)}{" "}
                            <ArrowUpRight size={13} aria-hidden="true" />
                          </Link>
                        </th>
                        <td>
                          <span className={s.rankChange}>
                            #{move.currentRank}{" "}
                            <ArrowRight size={13} aria-hidden="true" />{" "}
                            <strong>tie #{move.targetRank}</strong>
                          </span>
                        </td>
                        <td>{formatSwimTime(move.race.time)}</td>
                        <td>
                          <strong>{formatSwimTime(move.time)}</strong>
                        </td>
                        <td className={s.dropCell}>
                          {formatSwimTime(move.drop)}{" "}
                          <small>{move.percent.toFixed(2)}%</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              !boards.loading && (
                <Notice>
                  {events.some((event) => event.allTimeRank === 1)
                    ? "Already #1 in the available event boards. Keep setting the pace."
                    : "No rank move-ups available in the published data for this age and course."}
                </Notice>
              )
            )}
            {moves.length > 0 && (
              <p className={s.tableHint}>
                Scroll across for target times and drops.
              </p>
            )}
            {moves.length > 6 && (
              <button
                className={s.showMore}
                type="button"
                onClick={() => setShowAllMoves((value) => !value)}
              >
                {showAllMoves
                  ? "Show closest six"
                  : `Show all ${moves.length} move-ups`}{" "}
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            )}
            <p className={s.method}>
              All-time Velocity rankings compare one best per athlete in the
              same age group, gender, event, and course. Match a target time to
              share its rank. Board goals use the top 25, 10, 5, and 1 cutoffs;
              ties count.
            </p>
          </section>

          <section
            id="new-events"
            className={s.section}
            aria-labelledby="new-events-heading"
          >
            <div className={s.sectionHeading}>
              <span className={s.sectionNumber}>03</span>
              <div>
                <h2 id="new-events-heading">What should they try next?</h2>
                <p>
                  A new distance, a familiar stroke, or a chance to put it all
                  together.
                </p>
              </div>
            </div>
            {suggestions.length ? (
              <ol className={s.newGrid}>
                {(showAllNew ? suggestions : suggestions.slice(0, 6)).map(
                  (suggestion, index) => (
                    <li className={s.newCard} key={suggestion.event}>
                      <span className={s.newNumber}>
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <span className={s.smallLabel}>
                          No recorded {course} time
                        </span>
                        <h3>{eventLabel(suggestion.event)}</h3>
                        <p>{suggestion.reason}</p>
                      </div>
                      <Flag size={19} aria-hidden="true" />
                    </li>
                  ),
                )}
              </ol>
            ) : (
              <Notice>
                Every suggested event has a published time in this course.
                Explore another course for a fresh challenge.
              </Notice>
            )}
            {suggestions.length > 6 && (
              <button
                className={s.showMore}
                type="button"
                onClick={() => setShowAllNew((value) => !value)}
              >
                {showAllNew
                  ? "Show first six"
                  : `Explore all ${suggestions.length} new events`}{" "}
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            )}
            <p className={s.method}>
              Suggestions favor related events from the athlete’s strengths. “No
              recorded time” refers to published Velocity history in {course},
              across all recorded ages; other teams, courses, missing results,
              and attempts without a valid time may not be represented. Discuss
              event choices with their coach.
            </p>
          </section>
        </>
      )}
      <footer className={s.footer}>
        <Target size={16} aria-hidden="true" />
        <span>
          A starting point for a conversation with your swimmer and coach.
        </span>
        <Link href="/tools/my-times">
          View times <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </footer>
    </>
  );
}

function FollowedAthleteGoals({ userId }: { userId: string }) {
  const [preferences, setPreferences] = useState(() =>
    cachedAccountAthletes(userId),
  );
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
      <Notice>
        Your athletes couldn’t be loaded.{" "}
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Try again
        </button>
      </Notice>
    );
  if (!preferences)
    return (
      <div className={s.loading} role="status">
        Loading your athletes…
      </div>
    );
  return <AthleteGoals preferences={preferences} />;
}

export default function Goals() {
  const { user, loading } = useAuth();
  return (
    <PageFrame>
      {loading ? (
        <div className={s.loading} role="status">
          Loading your account…
        </div>
      ) : !user ? (
        <Notice>
          <Link href="/login">Sign in</Link> to explore goals for the athletes
          you follow.
        </Notice>
      ) : !hasBackendConfiguration ? (
        <Notice>
          Goals are unavailable while the database is disconnected.
        </Notice>
      ) : (
        <FollowedAthleteGoals key={user.uid} userId={user.uid} />
      )}
    </PageFrame>
  );
}
