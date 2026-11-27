"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { formatSwimTime } from "@/features/swim-resources/lib/domain/swim-time";
import { MotivationalRankIcon } from "./MotivationalRankIcon";
import {
  motivationalRankForRace,
  motivationalRanks,
} from "./motivational-ranks";
import { eventLabel, type Race } from "./times-data";
import {
  buildTeamOverview,
  buildTeamMeet,
  profileAges,
  rankTeamRoster,
  type RankCounts,
  type TeamData,
} from "./team-data";
import { pointsForRank } from "./rank-points";
import { useTeamData, useTeamMeet } from "./use-team-data";
import { useStandards } from "./use-standards";
import type { StandardSet } from "@/features/swim-resources/types/schema";
import s from "./TeamPage.module.css";

function athleteHref(id: string) {
  return `/tools/my-times?${new URLSearchParams({ myAthlete: id })}`;
}
function Counts({
  counts,
  changes = false,
  showIcons = true,
}: {
  counts: RankCounts;
  changes?: boolean;
  showIcons?: boolean;
}) {
  return (
    <span className={changes ? s.additionCounts : s.counts}>
      {motivationalRanks.map(({ tier, name }) => {
        const count = counts[tier] ?? 0;
        const value = changes && count > 0 ? `+${count}` : String(count);
        if (changes && count <= 0) return null;
        return (
          <span
            key={tier}
            className={s.count}
            title={`${name}: ${value}`}
            aria-label={`${name}: ${value}`}
          >
            {showIcons && (
              <MotivationalRankIcon tier={tier} size={23} decorative />
            )}
            <span className={count > 0 && changes ? s.positive : undefined}>
              {value}
            </span>
          </span>
        );
      })}
    </span>
  );
}
function SwimList({
  races,
  sets,
  names = false,
}: {
  races: Race[];
  sets: StandardSet[];
  names?: boolean;
}) {
  return (
    <ul className={s.swims}>
      {races.map((race) => {
        const rank = motivationalRankForRace(race, sets);
        return (
          <li key={race.id}>
            <span className={s.swimName}>
              {names && (
                <Link href={athleteHref(race.athleteId)}>
                  {race.athleteName || "Athlete"}
                </Link>
              )}
              <span>
                {eventLabel(race.event)} <small>{race.course}</small>
              </span>
            </span>
            <strong>
              {race.status === "OK" ? formatSwimTime(race.time) : race.status}
            </strong>
            <span className={s.swimRank}>
              {rank ? (
                <MotivationalRankIcon tier={rank.rank.tier} size={24} />
              ) : (
                <span aria-label="Unranked">—</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function TeamPage() {
  const standards = useStandards(true, false);
  const team = useTeamData();
  const [view, setView] = useState("Season Progress");
  const data = team.data;
  const overview = useMemo(
    () => (data ? buildTeamOverview(data, standards.sets) : null),
    [data, standards.sets],
  );
  const loading =
    (!data && team.loading) || (!standards.sets.length && standards.loading);
  const error = team.error || standards.error;
  const retry = () => {
    team.retry();
    standards.retry();
  };
  return (
    <main className={s.page} aria-label="Team" aria-busy={loading}>
      {error && (
        <div className={s.notice} role="alert">
          {error} <button onClick={retry}>Retry</button>
        </div>
      )}
      {loading ? (
        <div className={s.loading} role="status">
          Loading Team…
        </div>
      ) : (
        overview &&
        data &&
        !(standards.error && !standards.sets.length) && (
          <>
            <section aria-labelledby="team-ranks">
              <div className={s.sectionHeading}>
                <h1 id="team-ranks">Rank Counts</h1>
                <div
                  className={s.viewSwitcher}
                  role="group"
                  aria-label="Rank Counts view"
                >
                  {[
                    "Season Progress",
                    "Competitive Profile",
                    "Career View",
                  ].map((name) => (
                    <button
                      key={name}
                      aria-pressed={view === name}
                      onClick={() => setView(name)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
              <p className={s.description}>
                {view === "Career View"
                  ? "Highest rank for each career-best event and course, scored at the swimmer’s age on the swim date."
                  : view === "Season Progress"
                    ? `Best rank earned per event and course since September 1, ${data.seasonStart.slice(0, 4)}. Ranks use age on the swim date.`
                    : "Career-best times scored against each training group’s age standard. Each event and course counts once, including unranked times."}
              </p>
              {view !== "Competitive Profile" && (
                <p className={s.scoringNote}>
                  Athletes ranked by points:{" "}
                  {motivationalRanks
                    .map((rank) => `${rank.name} ${pointsForRank(rank.tier)}`)
                    .join(" · ")}
                  .
                </p>
              )}
              {view === "Competitive Profile" ? (
                <>
                  <div className={s.profiles}>
                    {overview.groups.map((group) => (
                      <RankDistribution
                        key={group.name}
                        name={group.name}
                        {...group.profile}
                      />
                    ))}
                  </div>
                  <p className={s.profileNote}>
                    Seniors use 15&O standards where published; otherwise the
                    stricter 15–16 or 17–18 cut for each rank. All groups use
                    standards current on {data.asOf}.
                  </p>
                </>
              ) : (
                <>
                  <div className={s.rankLabels} aria-hidden="true">
                    <span />
                    {motivationalRanks.map((rank) => (
                      <span key={rank.tier}>{rank.name}</span>
                    ))}
                  </div>
                  <div className={s.groups}>
                    {overview.groups.map((group) => (
                      <details key={group.name} className={s.group}>
                        <summary>
                          <span className={s.groupName}>
                            <ChevronDown size={16} />
                            <strong>{group.name}</strong>
                            <small>{group.roster.length}</small>
                          </span>
                          <Counts
                            counts={
                              view === "Season Progress"
                                ? group.seasonCounts
                                : group.counts
                            }
                          />
                        </summary>
                        <div className={s.roster}>
                          {group.roster.length ? (
                            rankTeamRoster(
                              group.roster,
                              view === "Season Progress",
                            ).map((member) => (
                              <div key={member.id} className={s.rosterRow}>
                                <div className={s.memberInfo}>
                                  <span
                                    className={s.memberPlace}
                                    aria-label={`Place ${member.place}`}
                                  >
                                    #{member.place}
                                  </span>
                                  <span>
                                    {member.athleteId ? (
                                      <Link
                                        href={athleteHref(member.athleteId)}
                                      >
                                        {member.name}
                                      </Link>
                                    ) : (
                                      <>
                                        {member.name}
                                        <small>Not linked to Times</small>
                                      </>
                                    )}
                                  </span>
                                  <span className={s.memberPoints}>
                                    {member.points.toLocaleString("en-US")}{" "}
                                    <small>pts</small>
                                  </span>
                                </div>
                                <Counts
                                  showIcons={false}
                                  counts={
                                    view === "Season Progress"
                                      ? member.seasonCounts
                                      : member.counts
                                  }
                                />
                              </div>
                            ))
                          ) : (
                            <p className={s.empty}>
                              No athletes in this group.
                            </p>
                          )}
                        </div>
                      </details>
                    ))}
                  </div>
                </>
              )}
            </section>
            <section aria-labelledby="team-highlights">
              <h2 id="team-highlights">Athlete Highlights</h2>
              <div className={s.leaders}>
                {overview.leaders.map((athlete, index) => (
                  <article key={athlete.id} className={s.athlete}>
                    <div className={s.athleteHeading}>
                      <span className={s.place}>{index + 1}</span>
                      <div>
                        <Link href={athleteHref(athlete.athleteId!)}>
                          {athlete.name}
                        </Link>
                        <small>{athlete.group}</small>
                      </div>
                    </div>
                    <Counts counts={athlete.counts} />
                    <SwimList
                      races={athlete.highlights
                        .slice(0, 3)
                        .map((highlight) => highlight.event.race)}
                      sets={standards.sets}
                    />
                    <details className={s.expand}>
                      <summary>
                        All event bests <ChevronDown size={15} />
                      </summary>
                      <SwimList races={athlete.bests} sets={standards.sets} />
                    </details>
                  </article>
                ))}
              </div>
              {!overview.leaders.length && (
                <p className={s.empty}>
                  No swims for linked competitive athletes yet.
                </p>
              )}
            </section>
            <MeetBreakdown data={data} sets={standards.sets} />
          </>
        )
      )}
    </main>
  );
}

function MeetBreakdown({
  data,
  sets,
}: {
  data: TeamData;
  sets: StandardSet[];
}) {
  const [meet, setMeet] = useState("");
  const result = useTeamMeet(data, meet);
  const overview = useMemo(
    () => (result.data ? buildTeamMeet(result.data, data.roster, sets) : null),
    [result.data, data.roster, sets],
  );
  return (
    <section aria-labelledby="team-meet" aria-busy={result.loading}>
      <div className={s.sectionHeading}>
        <h2 id="team-meet">Meet Breakdown</h2>
        {!!data.meets.length && (
          <select
            aria-label="Meet"
            value={result.id}
            onChange={(event) => setMeet(event.target.value)}
          >
            {data.meets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name || "Unnamed meet"} · {item.date}
              </option>
            ))}
          </select>
        )}
      </div>
      {result.error && (
        <div className={s.notice} role="alert">
          {result.error} <button onClick={result.retry}>Retry meet</button>
        </div>
      )}
      {result.loading ? (
        <p className={s.loading} role="status">
          Loading meet breakdown…
        </p>
      ) : result.data?.meet && overview ? (
        <div className={s.meet}>
          <AdditionChart
            counts={overview.changes}
            athletes={
              overview.athletes.filter(
                (athlete) => athlete.additions.length > 0,
              ).length
            }
          />
          <SwimList
            races={overview.meetHighlights.map(
              (highlight) => highlight.event.race,
            )}
            sets={sets}
            names
          />
          <details className={s.expand} key={result.data?.meet.id}>
            <summary>
              All athletes <span>{overview.athletes.length}</span>
              <ChevronDown size={15} />
            </summary>
            {overview.athletes.map((athlete) => (
              <details key={athlete.athleteId} className={s.meetAthlete}>
                <summary>
                  <span className={s.groupName}>
                    <ChevronDown size={15} />
                    <strong>{athlete.name}</strong>
                  </span>
                  {athlete.additions.length ? (
                    <Counts counts={athlete.changes} changes />
                  ) : (
                    <small>No new ranks</small>
                  )}
                </summary>
                <div className={s.meetSwims}>
                  <Link href={athleteHref(athlete.athleteId)}>View Times</Link>
                  <SwimList races={athlete.swims} sets={sets} />
                </div>
              </details>
            ))}
          </details>
        </div>
      ) : !result.error ? (
        <p className={s.empty}>No meet results yet.</p>
      ) : null}
    </section>
  );
}

function RankDistribution({
  name,
  counts,
  total,
  unranked,
}: {
  name: string;
  counts: RankCounts;
  total: number;
  unranked: number;
}) {
  const segments = [
    { tier: "unranked", name: "Unranked", color: "#65717c", count: unranked },
    ...motivationalRanks.map((rank) => ({
      ...rank,
      count: counts[rank.tier] ?? 0,
    })),
  ];
  return (
    <article className={s.profile}>
      <div className={s.profileHeading}>
        <h3>
          {name} <small>{profileAges[name]}</small>
        </h3>
        <span>
          {total} event best{total === 1 ? "" : "s"}
        </span>
      </div>
      {total ? (
        <>
          <div
            className={s.distribution}
            role="img"
            aria-label={`${name} rank distribution: ${segments.map((rank) => `${rank.name} ${Math.round((rank.count / total) * 100)}% (${rank.count})`).join(", ")}`}
          >
            {segments
              .filter((rank) => rank.count > 0)
              .map((rank) => (
                <span
                  key={rank.tier}
                  style={{
                    width: `${(rank.count / total) * 100}%`,
                    background: rank.color,
                  }}
                  title={`${rank.name}: ${rank.count}`}
                >
                  {rank.count / total >= 0.08
                    ? `${Math.round((rank.count / total) * 100)}%`
                    : ""}
                </span>
              ))}
          </div>
          <div className={s.distributionLegend}>
            {segments.map((rank) => (
              <span key={rank.tier}>
                <i style={{ background: rank.color }} />
                <span>{rank.name}</span>
                <strong>{Math.round((rank.count / total) * 100)}%</strong>
                <small>({rank.count})</small>
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className={s.empty}>No event bests for linked athletes yet.</p>
      )}
    </article>
  );
}

function AdditionChart({
  counts,
  athletes,
}: {
  counts: RankCounts;
  athletes: number;
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...Object.values(counts));
  return (
    <div className={s.additions}>
      <div className={s.additionsHeading}>
        <strong>+{total}</strong>
        <div>
          <h3>Ranks added</h3>
          <p>
            {athletes} swimmer{athletes === 1 ? "" : "s"} earned a first rank or
            moved up in an event.
          </p>
        </div>
      </div>
      {total ? (
        <div className={s.additionBars}>
          {motivationalRanks
            .filter((rank) => counts[rank.tier] > 0)
            .map((rank) => (
              <div key={rank.tier} className={s.additionBar}>
                <span>
                  <MotivationalRankIcon tier={rank.tier} size={24} decorative />
                  {rank.name}
                </span>
                <div className={s.barTrack}>
                  <span
                    style={{
                      width: `${(counts[rank.tier] / max) * 100}%`,
                      background: rank.color,
                    }}
                  />
                </div>
                <strong>+{counts[rank.tier]}</strong>
              </div>
            ))}
        </div>
      ) : (
        <p className={s.empty}>No new ranks at this meet.</p>
      )}
    </div>
  );
}
