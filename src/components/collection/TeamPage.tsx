"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { formatSwimTime } from "@/features/swim-resources/lib/domain/swim-time";
import { MotivationalRankIcon } from "./MotivationalRankIcon";
import {
  motivationalRankForRace,
  motivationalRanks,
} from "./motivational-ranks";
import { eventLabel, type Race } from "./times-data";
import { buildTeamOverview, type RankCounts, type TeamData } from "./team-data";
import { useStandards } from "./use-standards";
import type { StandardSet } from "@/features/swim-resources/types/schema";
import s from "./TeamPage.module.css";

function athleteHref(id: string) {
  return `/tools/my-times?${new URLSearchParams({ myAthlete: id })}`;
}
function Counts({
  counts,
  changes = false,
}: {
  counts: RankCounts;
  changes?: boolean;
}) {
  return (
    <span className={s.counts}>
      {motivationalRanks.map(({ tier, name }) => {
        const count = counts[tier] ?? 0;
        const value = changes && count > 0 ? `+${count}` : String(count);
        return (
          <span
            key={tier}
            className={s.count}
            title={`${name}: ${value}`}
            aria-label={`${name}: ${value}`}
          >
            <MotivationalRankIcon tier={tier} size={23} decorative />
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
  const standards = useStandards();
  const [meet, setMeet] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data?: TeamData;
    error?: string;
  } | null>(null);
  const key = `${meet}:${attempt}`;
  useEffect(() => {
    const controller = new AbortController();
    const query = meet ? `?${new URLSearchParams({ meet })}` : "";
    fetch(`/api/times/team${query}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Couldn’t load Team.");
        if (!controller.signal.aborted) setResult({ key, data: body });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({ key, error: error.message });
      });
    return () => controller.abort();
  }, [meet, key]);
  useEffect(() => {
    const refresh = () => setAttempt((value) => value + 1);
    window.addEventListener("ies-times-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("ies-times-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const current = result?.key === key ? result : null;
  const data = current?.data;
  const overview = useMemo(
    () => (data ? buildTeamOverview(data, standards.sets) : null),
    [data, standards.sets],
  );
  const loading = !current || standards.loading;
  const error = current?.error || standards.error;
  const retry = () => {
    setAttempt((value) => value + 1);
    standards.retry();
  };
  return (
    <main className={s.page} aria-label="Team" aria-busy={loading}>
      {error ? (
        <div className={s.notice} role="alert">
          {error} <button onClick={retry}>Retry</button>
        </div>
      ) : loading ? (
        <div className={s.loading} role="status">
          Loading Team…
        </div>
      ) : (
        overview &&
        data && (
          <>
            <section aria-labelledby="team-ranks">
              <h1 id="team-ranks">Rank Counts</h1>
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
                      <Counts counts={group.counts} />
                    </summary>
                    <div className={s.roster}>
                      {group.roster.length ? (
                        group.roster.map((member) => (
                          <div key={member.id} className={s.rosterRow}>
                            <span>
                              {member.athleteId ? (
                                <Link href={athleteHref(member.athleteId)}>
                                  {member.name}
                                </Link>
                              ) : (
                                <>
                                  {member.name}
                                  <small>Not linked to Times</small>
                                </>
                              )}
                            </span>
                            <Counts counts={member.counts} />
                          </div>
                        ))
                      ) : (
                        <p className={s.empty}>No athletes in this group.</p>
                      )}
                    </div>
                  </details>
                ))}
              </div>
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
            <section aria-labelledby="team-meet">
              <div className={s.sectionHeading}>
                <h2 id="team-meet">Meet Breakdown</h2>
                {!!data.meets.length && (
                  <select
                    aria-label="Meet"
                    value={data.meet?.id ?? ""}
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
              {data.meet ? (
                <div className={s.meet}>
                  <Counts counts={overview.changes} changes />
                  <SwimList
                    races={overview.meetHighlights.map(
                      (highlight) => highlight.event.race,
                    )}
                    sets={standards.sets}
                    names
                  />
                  <details className={s.expand} key={data.meet.id}>
                    <summary>
                      All athletes <span>{overview.athletes.length}</span>
                      <ChevronDown size={15} />
                    </summary>
                    {overview.athletes.map((athlete) => (
                      <details
                        key={athlete.athleteId}
                        className={s.meetAthlete}
                      >
                        <summary>
                          <span className={s.groupName}>
                            <ChevronDown size={15} />
                            <strong>{athlete.name}</strong>
                          </span>
                          <Counts counts={athlete.changes} changes />
                        </summary>
                        <div className={s.meetSwims}>
                          <Link href={athleteHref(athlete.athleteId)}>
                            View Times
                          </Link>
                          <SwimList
                            races={athlete.swims}
                            sets={standards.sets}
                          />
                        </div>
                      </details>
                    ))}
                  </details>
                </div>
              ) : (
                <p className={s.empty}>No meet results yet.</p>
              )}
            </section>
          </>
        )
      )}
    </main>
  );
}
