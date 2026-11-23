"use client";

import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Link2,
  RefreshCw,
  Sparkles,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useAuth } from "@/features/workshare/contexts/auth";
import { hasBackendConfiguration } from "@/lib/supabase/client";
import {
  motivationalRanks,
  motivationalRankForTier,
} from "./motivational-ranks";
import { MotivationalRankIcon } from "./MotivationalRankIcon";
import { TeamMapGemSections } from "./TeamMapGems";
import { eventLabel } from "./times-data";
import { useTimesSelection } from "./use-times-selection";
import type { TeamMapSnapshot, TeamMapContributor } from "./team-map-data";
import s from "./TeamMap.module.css";

const emptyGroups = ["10&U", "11-12", "13-14", "15-16", "17-18"];
const number = (value: number) => value.toLocaleString("en-US");
const ageLabel = (value: string) =>
  value === "10&U" ? "10 & under" : value.replaceAll("-", "–");
const currentYear = () =>
  Number(
    new Date()
      .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
      .slice(0, 4),
  );
function dateLabel(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className={s.page} aria-labelledby="team-map-heading">
      <header className={s.header}>
        <div className={s.eyebrow}>
          <span>Concept</span> Many swimmers. One team.
        </div>
        <h1 id="team-map-heading">
          Team Map<span>.</span>
        </h1>
        <p>See what this roster has built, and where it’s going next.</p>
      </header>
      {children}
    </main>
  );
}

export function TeamMapLoading() {
  return (
    <Frame>
      <div className={s.loading} role="status">
        <UsersRound size={24} aria-hidden="true" /> Mapping the team’s
        achievements…
      </div>
    </Frame>
  );
}

class TeamMapLoadError extends Error {}
const loadError = "Team Map couldn’t be loaded. Please try again.";

function useTeamMap(url: string | null) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    key: string;
    data: TeamMapSnapshot | null;
    error: string;
  }>({ key: "", data: null, error: "" });
  const key = `${url}|${revision}`;
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(url!, {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(90000),
          ]),
        });
        const body = await response.json();
        if (!response.ok)
          throw new TeamMapLoadError(
            typeof body.error === "string" ? body.error : loadError,
          );
        if (!body.data) throw new TeamMapLoadError(loadError);
        if (!controller.signal.aborted)
          setState({ key, data: body.data, error: "" });
      } catch (error) {
        if (!controller.signal.aborted)
          setState({
            key,
            data: null,
            error:
              error instanceof TeamMapLoadError
                ? error.message
                : error instanceof Error && error.name === "TimeoutError"
                  ? "Team Map took too long to load. Please try again."
                  : loadError,
          });
      }
    }
    void load();
    const changed = () => setRevision((value) => value + 1);
    window.addEventListener("ies-times-changed", changed);
    return () => {
      controller.abort();
      window.removeEventListener("ies-times-changed", changed);
    };
  }, [url, key]);
  return {
    data: state.key === key ? state.data : null,
    error: state.key === key ? state.error : "",
    loading: Boolean(
      url && (state.key !== key || (!state.data && !state.error)),
    ),
    refresh: () => setRevision((value) => value + 1),
  };
}

function ContributorTable({
  leaders,
  tier,
}: {
  leaders: TeamMapContributor[];
  tier: string;
}) {
  const [all, setAll] = useState(false);
  const score = (leader: TeamMapContributor) =>
    tier === "all" ? leader.total : (leader.counts[tier] ?? 0);
  const sorted = leaders
    .filter((leader) => score(leader) > 0)
    .toSorted(
      (a, b) =>
        score(b) - score(a) ||
        b.total - a.total ||
        a.name.localeCompare(b.name) ||
        a.athleteId.localeCompare(b.athleteId),
    );
  const positions = new Map<number, number>();
  for (const [index, leader] of sorted.entries()) {
    if (!positions.has(score(leader))) positions.set(score(leader), index + 1);
  }
  const ranked = sorted.map((leader) => ({
    leader,
    position: positions.get(score(leader))!,
  }));
  if (!ranked.length)
    return (
      <div className={s.emptyPanel}>
        No contributions match this age group and rank yet.
      </div>
    );
  return (
    <>
      <div
        className={s.tableScroll}
        role="region"
        aria-label="Contributors; scroll across for all ranks"
        tabIndex={0}
      >
        <table className={s.leaders}>
          <caption className="sr-only">
            Current roster rank contributions, highest total first; ties share a
            position
          </caption>
          <thead>
            <tr>
              <th scope="col">Athlete</th>
              {motivationalRanks.map((rank) => (
                <th
                  key={rank.tier}
                  scope="col"
                  data-selected={tier === rank.tier}
                >
                  <MotivationalRankIcon tier={rank.tier} size={18} decorative />
                  <span>{rank.name}</span>
                </th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {(all ? ranked : ranked.slice(0, 10)).map(
              ({ leader, position }) => (
                <tr key={leader.athleteId}>
                  <th scope="row">
                    <span className={s.position}>{position}</span>
                    <span>
                      <strong>{leader.name}</strong>
                      {leader.trainingGroups.length > 0 && (
                        <small>{leader.trainingGroups.join(" · ")}</small>
                      )}
                    </span>
                  </th>
                  {motivationalRanks.map((rank) => (
                    <td key={rank.tier} data-selected={tier === rank.tier}>
                      {leader.counts[rank.tier] || (
                        <span className={s.zero}>—</span>
                      )}
                    </td>
                  ))}
                  <td className={s.total}>{number(leader.total)}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      <p className={s.scrollHint}>Scroll across to compare all six ranks.</p>
      {ranked.length > 10 && (
        <button
          className={s.textButton}
          type="button"
          onClick={() => setAll((value) => !value)}
        >
          {all
            ? "Show top ten"
            : `Show all ${number(ranked.length)} contributors`}{" "}
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      )}
    </>
  );
}

function TeamMapResults() {
  const yearNow = currentYear();
  const [courseValue, setCourse] = useTimesSelection("mapCourse", "");
  const [yearValue, setYear] = useTimesSelection("mapYear", String(yearNow));
  const [selectedAge, setAge] = useTimesSelection("mapAge", "all");
  const [tierValue, setTier] = useTimesSelection("mapRank", "all");
  const course = ["", "SCY", "LCM", "SCM"].includes(courseValue)
    ? courseValue
    : "";
  const validYear =
    /^\d{4}$/.test(yearValue) &&
    Number(yearValue) >= 1900 &&
    Number(yearValue) <= yearNow;
  const year = Number(yearValue);
  const tier = motivationalRanks.some((rank) => rank.tier === tierValue)
    ? tierValue
    : "all";
  const query = useTeamMap(
    validYear
      ? `/api/times/team-map?${new URLSearchParams({ year: yearValue, course })}`
      : null,
  );
  const data = query.data;
  const byAge = new Map(
    data?.ageGroups.map((group) => [group.ageGroup, group]),
  );
  const groups = [...new Set([...emptyGroups, ...byAge.keys()])]
    .sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b))
    .map(
      (ageGroup) =>
        byAge.get(ageGroup) ?? {
          ageGroup,
          total: 0,
          athletes: 0,
          counts: {} as Record<string, number>,
          leaders: [],
        },
    );
  const selectedGroup = groups.find((group) => group.ageGroup === selectedAge);
  const age = selectedGroup ? selectedAge : "all";
  const allLeaders = selectedGroup?.leaders ?? data?.leaders ?? [];
  const maxCell = Math.max(
    1,
    ...groups.flatMap((group) => Object.values(group.counts)),
  );
  const maxMonth = Math.max(
    1,
    ...(data?.activity.months.map((month) => month.swims) ?? []),
  );
  const groupName = age === "all" ? "all age groups" : `ages ${ageLabel(age)}`;
  const rankName =
    tier === "all"
      ? "all ranks"
      : `${motivationalRankForTier(tier)?.name} ranks`;
  function selectCell(ageGroup: string, rank = "all") {
    setAge(ageGroup);
    setTier(rank);
    document
      .getElementById("team-contributors")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <section className={s.filters} aria-label="Team Map filters">
        <div className={s.rosterScope}>
          <UsersRound size={20} aria-hidden="true" />
          <span>
            <strong>Current linked roster</strong>
            <small>Published Velocity swim history</small>
          </span>
        </div>
        <label>
          <span>Course</span>
          <select
            aria-label="Course"
            value={course}
            onChange={(event) => setCourse(event.target.value)}
          >
            <option value="">All courses</option>
            <option value="SCY">Short course yards</option>
            <option value="LCM">Long course meters</option>
            <option value="SCM">Short course meters</option>
          </select>
        </label>
        <label>
          <span>Activity year</span>
          <div className={s.yearControl}>
            <button
              type="button"
              aria-label="Previous activity year"
              disabled={!validYear || year <= 1900}
              onClick={() => setYear(String(year - 1))}
            >
              <ChevronLeft size={15} aria-hidden="true" />
            </button>
            <input
              aria-label="Activity year"
              type="number"
              min="1900"
              max={yearNow}
              value={yearValue}
              aria-invalid={!validYear || undefined}
              onChange={(event) => setYear(event.target.value)}
            />
            <button
              type="button"
              aria-label="Next activity year"
              disabled={!validYear || year >= yearNow}
              onClick={() => setYear(String(year + 1))}
            >
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </div>
        </label>
        <button
          className={s.refresh}
          type="button"
          onClick={query.refresh}
          disabled={query.loading || !validYear}
        >
          <RefreshCw size={15} aria-hidden="true" /> Refresh
        </button>
      </section>
      {!validYear ? (
        <p className={s.notice} role="alert">
          Choose a whole-number year from 1900 to {yearNow}.
        </p>
      ) : query.loading ? (
        <div className={s.loading} role="status">
          <UsersRound size={24} aria-hidden="true" /> Reading linked roster
          history…
        </div>
      ) : query.error ? (
        <p className={s.notice} role="alert">
          {query.error}{" "}
          <button type="button" onClick={query.refresh}>
            Try again
          </button>
        </p>
      ) : (
        data && (
          <>
            <div className={s.coverage}>
              <span>
                <Check size={13} aria-hidden="true" /> As of{" "}
                {dateLabel(data.asOf)}
              </span>
              <span>
                {number(data.coverage.rosterEntries)} active roster entries
              </span>
              <span>
                {number(data.coverage.linkedAthletes)} unique Times links
              </span>
              <span>
                {number(data.coverage.athletesWithSwims)} with published{" "}
                {course || "individual"} times
              </span>
            </div>
            {(data.coverage.unlinkedEntries > 0 ||
              data.coverage.duplicateLinks > 0) && (
              <aside className={s.linkNotice}>
                <Link2 size={19} aria-hidden="true" />
                <div>
                  <strong>
                    {data.coverage.unlinkedEntries > 0
                      ? `${number(data.coverage.unlinkedEntries)} roster ${data.coverage.unlinkedEntries === 1 ? "entry still needs" : "entries still need"} a Times link`
                      : "Shared athlete links are counted once"}
                  </strong>
                  <p>
                    {data.coverage.unlinkedEntries > 0
                      ? "Their achievements aren’t included yet. Linking more athletes will fill in the map."
                      : "Each linked Times athlete contributes once, even when listed more than once in the roster."}
                    {data.coverage.duplicateLinks > 0 &&
                      ` ${number(data.coverage.duplicateLinks)} repeated ${data.coverage.duplicateLinks === 1 ? "link is" : "links are"} deduplicated.`}
                  </p>
                </div>
                <Link href="/tools/admin">
                  Manage roster <ArrowUpRight size={14} aria-hidden="true" />
                </Link>
              </aside>
            )}

            <section className={s.section} aria-labelledby="team-ranks-heading">
              <div className={s.sectionHeading}>
                <div>
                  <span className={s.eyebrowText}>The team collection</span>
                  <h2 id="team-ranks-heading">
                    Every age group adds to the story.
                  </h2>
                  <p>
                    Career achievements of today’s roster, across every recorded
                    age group.
                  </p>
                </div>
                <div className={s.collectionTotal}>
                  <strong>{number(data.totalContributions)}</strong>
                  <span>
                    ranked event achievements
                    <br />
                    from {number(data.contributorCount)} swimmers
                  </span>
                </div>
              </div>
              <div className={s.rankGrid}>
                {motivationalRanks.map((rank) => (
                  <button
                    type="button"
                    className={s.rankCard}
                    key={rank.tier}
                    aria-pressed={tier === rank.tier}
                    aria-label={`${number(data.rankCounts[rank.tier] ?? 0)} ${rank.name} contributions; show contributors`}
                    onClick={() =>
                      selectCell("all", tier === rank.tier ? "all" : rank.tier)
                    }
                    style={{ "--rank-color": rank.color } as CSSProperties}
                  >
                    <div>
                      <MotivationalRankIcon
                        tier={rank.tier}
                        size={36}
                        decorative
                      />
                      <span>{rank.tier}</span>
                    </div>
                    <strong>{number(data.rankCounts[rank.tier] ?? 0)}</strong>
                    <span>{rank.name}</span>
                  </button>
                ))}
              </div>
              <p className={s.method}>
                One highest rank per athlete, event, course, gender, and USA age
                band. Four Gold events at 11–12 plus three at 13–14 contribute
                seven Golds. Repeated swims count once; an upgrade moves that
                event into its higher rank.
              </p>
            </section>

            <TeamMapGemSections data={data} />

            <section className={s.section} aria-labelledby="age-map-heading">
              <div className={s.sectionHeading}>
                <div>
                  <span className={s.eyebrowText}>A map of our strengths</span>
                  <h2 id="age-map-heading">Where the ranks were earned</h2>
                  <p>
                    Select an age band or rank cell to meet its contributors.
                  </p>
                </div>
                <span className={s.quietTag}>Age at achievement</span>
              </div>
              <div
                className={s.tableScroll}
                role="region"
                aria-label="Age-group rank map; scroll across for all ranks"
                tabIndex={0}
              >
                <table className={s.map}>
                  <caption className="sr-only">
                    Highest achieved ranks by USA motivational age band
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Age band</th>
                      {motivationalRanks.map((rank) => (
                        <th scope="col" key={rank.tier}>
                          <MotivationalRankIcon
                            tier={rank.tier}
                            size={22}
                            decorative
                          />
                          <span>{rank.name}</span>
                        </th>
                      ))}
                      <th scope="col">Total</th>
                      <th scope="col">Leading contributor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((group) => (
                      <tr key={group.ageGroup}>
                        <th scope="row">
                          <button
                            type="button"
                            onClick={() => selectCell(group.ageGroup)}
                          >
                            {ageLabel(group.ageGroup)}
                          </button>
                          <small>
                            {number(group.athletes)}{" "}
                            {group.athletes === 1
                              ? "contributor"
                              : "contributors"}
                          </small>
                        </th>
                        {motivationalRanks.map((rank) => {
                          const count = group.counts[rank.tier] ?? 0;
                          return (
                            <td key={rank.tier}>
                              <button
                                type="button"
                                aria-label={`${ageLabel(group.ageGroup)}: ${number(count)} ${rank.name}; show contributors`}
                                aria-pressed={
                                  age === group.ageGroup && tier === rank.tier
                                }
                                onClick={() =>
                                  selectCell(group.ageGroup, rank.tier)
                                }
                                style={
                                  {
                                    "--cell-color": rank.color,
                                    "--cell-strength": count
                                      ? String(7 + (count / maxCell) * 22) + "%"
                                      : "0%",
                                  } as CSSProperties
                                }
                              >
                                {count || <span className={s.zero}>—</span>}
                              </button>
                            </td>
                          );
                        })}
                        <td className={s.total}>{number(group.total)}</td>
                        <td className={s.groupLeader}>
                          {group.leaders[0] ? (
                            <>
                              <strong>{group.leaders[0].name}</strong>
                              <small>
                                {number(group.leaders[0].total)} achievements
                                {group.leaders[1]?.total ===
                                group.leaders[0].total
                                  ? " · tied lead"
                                  : ""}
                              </small>
                            </>
                          ) : (
                            <span className={s.zero}>No ranked events yet</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={s.scrollHint}>
                Scroll across for all ranks and age-group leaders.
              </p>
              <p className={s.method}>
                Athletes can contribute in several age bands. The 10 & under
                band combines ages 8 & under and 9–10, following USA Swimming
                motivational standards.
              </p>
            </section>

            <section
              id="team-contributors"
              className={s.section}
              aria-labelledby="contributors-heading"
            >
              <div className={s.sectionHeading}>
                <div>
                  <span className={s.eyebrowText}>
                    The people behind the map
                  </span>
                  <h2 id="contributors-heading">Leading contributors</h2>
                  <p>
                    {tier === "all" ? "Rank contributions" : `Most ${rankName}`}{" "}
                    in {groupName}. Equal counts share a position.
                  </p>
                </div>
                <div className={s.leaderFilters}>
                  <label>
                    <span>Age at achievement</span>
                    <select
                      aria-label="Contributor age group"
                      value={age}
                      onChange={(event) => setAge(event.target.value)}
                    >
                      <option value="all">All age groups</option>
                      {groups.map((group) => (
                        <option key={group.ageGroup} value={group.ageGroup}>
                          {ageLabel(group.ageGroup)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Rank</span>
                    <select
                      aria-label="Contributor rank"
                      value={tier}
                      onChange={(event) => setTier(event.target.value)}
                    >
                      <option value="all">All ranks</option>
                      {motivationalRanks.map((rank) => (
                        <option key={rank.tier} value={rank.tier}>
                          {rank.name} · {rank.tier}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <ContributorTable
                key={`${age}|${tier}`}
                leaders={allLeaders}
                tier={tier}
              />
            </section>

            <section className={s.section} aria-labelledby="year-heading">
              <div className={s.sectionHeading}>
                <div>
                  <span className={s.eyebrowText}>This roster, in motion</span>
                  <h2 id="year-heading">{year} at a glance</h2>
                  <p>
                    {year === yearNow
                      ? `January 1 through ${dateLabel(data.asOf)}.`
                      : "A full calendar year."}{" "}
                    Lifetime rank totals above stay in view.
                  </p>
                </div>
                <CalendarDays
                  size={24}
                  aria-hidden="true"
                  className={s.sectionIcon}
                />
              </div>
              <div className={s.statsGrid}>
                {[
                  [
                    data.activity.swimmers,
                    "Swimmers racing",
                    "Current roster athletes with a valid published swim in the selected year.",
                  ],
                  [
                    data.activity.swims,
                    "Individual swims",
                    "Valid published individual performances, including eligible relay lead-offs.",
                  ],
                  [
                    data.activity.meets,
                    "Meets represented",
                    "Distinct meets in this roster’s published results for the year.",
                  ],
                  [
                    data.activity.improvedEvents,
                    "Events with new bests",
                    "Athlete/event/course combinations improved during the year; first recorded swims are excluded.",
                  ],
                  [
                    data.activity.newRankedEvents,
                    "First ranked events",
                    "Event/course/age-band combinations reaching a motivational rank for the first time in recorded history.",
                  ],
                  [
                    data.activity.rankUpgrades,
                    "Rank breakthroughs",
                    "Ranked event/course/age-band combinations that rose above their highest rank before January 1.",
                  ],
                ].map(([value, label, explanation]) => (
                  <article className={s.stat} key={String(label)}>
                    <strong>{number(Number(value))}</strong>
                    <h3>{label}</h3>
                    <p>{explanation}</p>
                  </article>
                ))}
              </div>
              <figure className={s.activity}>
                <figcaption>
                  <span>
                    <TrendingUp size={17} aria-hidden="true" /> Monthly swim
                    activity
                  </span>
                  <small>
                    {number(data.activity.swims)} published individual swims
                  </small>
                </figcaption>
                <ol className={s.months}>
                  {data.activity.months.map((month, index) => {
                    const monthLabel = new Date(
                      Date.UTC(year, index, 1),
                    ).toLocaleDateString("en-US", {
                      month: "short",
                      timeZone: "UTC",
                    });
                    return (
                      <li
                        key={month.month}
                        aria-label={`${monthLabel} ${year}: ${number(month.swims)} swims from ${number(month.swimmers)} swimmers`}
                        title={`${monthLabel}: ${number(month.swims)} swims · ${number(month.swimmers)} swimmers`}
                      >
                        <div className={s.barTrack}>
                          <span
                            className={s.bar}
                            style={{
                              height: `${month.swims ? Math.max(3, (month.swims / maxMonth) * 100) : 0}%`,
                            }}
                          />
                          <strong>
                            {month.swims ? number(month.swims) : ""}
                          </strong>
                        </div>
                        <span>{monthLabel}</span>
                      </li>
                    );
                  })}
                </ol>
              </figure>
            </section>

            <section
              className={s.section}
              aria-labelledby="breakthroughs-heading"
            >
              <div className={s.sectionHeading}>
                <div>
                  <span className={s.eyebrowText}>Reasons to celebrate</span>
                  <h2 id="breakthroughs-heading">
                    Recent breakthroughs in {year}
                  </h2>
                  <p>
                    First ranked events and improvements beyond the previous
                    year’s best ranks.
                  </p>
                </div>
                <Sparkles
                  size={24}
                  aria-hidden="true"
                  className={s.sectionIcon}
                />
              </div>
              {data.activity.recent.length ? (
                <ol className={s.recent}>
                  {data.activity.recent.slice(0, 8).map((item) => (
                    <li
                      key={`${item.athleteId}|${item.event}|${item.course}|${item.ageGroup}|${item.date}|${item.tier}`}
                    >
                      <MotivationalRankIcon
                        tier={item.tier}
                        size={32}
                        decorative
                      />
                      <div>
                        <strong>{item.name}</strong>
                        <p>
                          {eventLabel(item.event)} · {item.course} ·{" "}
                          {ageLabel(item.ageGroup)}
                        </p>
                      </div>
                      <span className={s.breakthrough}>
                        <strong>
                          {motivationalRankForTier(item.tier)?.name}
                        </strong>
                        <small>
                          {item.kind === "first"
                            ? "First ranked event"
                            : "Rank upgrade"}
                        </small>
                      </span>
                      <time dateTime={item.date}>{dateLabel(item.date)}</time>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className={s.emptyPanel}>
                  No first ranked events or rank upgrades recorded for this
                  roster in {year} yet.
                </div>
              )}
            </section>

            <footer className={s.footer}>
              <UsersRound size={18} aria-hidden="true" />
              <div>
                <strong>
                  Built from the roster, grounded in recorded swims.
                </strong>
                <p>
                  The roster lists non-archived athletes in non-archived
                  accounts. Gem totals use their linked Times profiles. Ranks
                  use the approved USA age-group edition in effect on each swim
                  date. Missing historical standards or ages can leave
                  achievements unassigned.
                </p>
                <p>
                  {number(data.coverage.validSwims)} valid swims reviewed ·{" "}
                  {number(data.coverage.ungradedSwims)} without an assigned rank
                  (including swims below Bronze) ·{" "}
                  {number(data.coverage.missingAgeSwims)} missing race-day age.
                  Coverage reflects published data and may be incomplete.
                </p>
              </div>
            </footer>
          </>
        )
      )}
    </>
  );
}

export default function TeamMap() {
  const { user, isAdmin, loading } = useAuth();
  return (
    <Frame>
      {loading ? (
        <div className={s.loading} role="status">
          Loading your account…
        </div>
      ) : !user ? (
        <p className={s.notice}>
          <Link href="/login">Sign in</Link> to view Team Map.
        </p>
      ) : !isAdmin ? (
        <p className={s.notice}>
          Team Map uses the linked roster and is available to staff.
        </p>
      ) : !hasBackendConfiguration ? (
        <p className={s.notice}>
          Team Map is unavailable while the database is disconnected.
        </p>
      ) : (
        <TeamMapResults key={user.uid} />
      )}
    </Frame>
  );
}
