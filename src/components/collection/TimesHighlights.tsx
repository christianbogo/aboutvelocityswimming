import { useId, type CSSProperties } from "react";
import { ChevronRight, Layers3, Medal, Waves } from "lucide-react";
import type { StandardSet } from "@/features/swim-resources/types/schema";
import { formatSwimTime } from "@/features/swim-resources/lib/domain/swim-time";
import type { MyTimesEvent } from "./times-api";
import { eventLabel } from "./times-data";
import { motivationalRanks } from "./motivational-ranks";
import { MotivationalRankIcon } from "./MotivationalRankIcon";
import { rankHighlights, type TimesHighlight } from "./times-highlights";
import { SkeletonText } from "./LoadingSkeleton";
import s from "./TimesHighlights.module.css";

const strokes = [
  ["FR", "Freestyle"],
  ["BK", "Backstroke"],
  ["BR", "Breaststroke"],
  ["FL", "Butterfly"],
  ["IM", "Medley"],
] as const;

function raceDate(date: string) {
  return new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString(
    "en-US",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    },
  );
}

function HighlightCard({
  highlight: { event, rank, margin },
  position,
  onRankings,
}: {
  highlight: TimesHighlight;
  position: number;
  onRankings: (event: MyTimesEvent) => void;
}) {
  const { race } = event;
  const descriptionId = useId();
  const featured = position <= 3;
  const hasTeamRank = event.allTimeRank != null && event.allTimeRank > 0;
  return (
    <li className={s.item}>
      <button
        type="button"
        className={`${s.card} ${featured ? s.featured : s.compact}`}
        data-highlight-size={featured ? "featured" : "compact"}
        data-rank={rank?.rank.tier}
        style={
          {
            "--rank-color": rank?.rank.color ?? "var(--accent)",
          } as CSSProperties
        }
        aria-label={`View ${eventLabel(event.event)} rankings`}
        aria-describedby={descriptionId}
        onClick={() => onRankings(event)}
      >
        <span id={descriptionId} className="sr-only">
          Best time {formatSwimTime(race.time)} in {race.course}.
          {rank
            ? ` ${rank.rank.name}, ${rank.rank.tier} standard.`
            : " No matched standard."}
          {hasTeamRank
            ? ` All-time team rank ${event.allTimeRank}${event.allTimeCount > 0 ? ` of ${event.allTimeCount} swimmers` : ""}.`
            : " Team rank unavailable."}
          {featured &&
            ` ${race.meet || "Meet unavailable"}, ${raceDate(race.date)}${race.ageAtSwim != null ? `, age ${race.ageAtSwim}` : ""}.`}
        </span>
        <span className={s.cardTop}>
          <span className={s.position} aria-label={`Highlight ${position}`}>
            {String(position).padStart(2, "0")}
          </span>
          <span className={s.event}>
            <span className={s.eyebrow}>{race.course} · Best time</span>
            <strong>{eventLabel(event.event)}</strong>
          </span>
          {featured && (
            <ChevronRight size={18} className={s.chevron} aria-hidden="true" />
          )}
        </span>
        <span className={s.performance}>
          <strong className={s.time}>{formatSwimTime(race.time)}</strong>
          <span className={s.standard}>
            {rank ? (
              <>
                <MotivationalRankIcon
                  tier={rank.rank.tier}
                  size={featured ? 56 : 32}
                  decorative
                />
                <span>
                  <strong>{rank.rank.name}</strong>
                  <span>{rank.rank.tier} standard</span>
                </span>
              </>
            ) : (
              <span className={s.noStandard}>No matched standard</span>
            )}
          </span>
        </span>
        {featured && (
          <span className={s.benchmark}>
            <span className={s.tierTrack} aria-hidden="true">
              {motivationalRanks.map((tier, index) => (
                <span
                  key={tier.tier}
                  data-achieved={
                    rank
                      ? index <=
                        motivationalRanks.findIndex(
                          (item) => item.tier === rank.rank.tier,
                        )
                      : false
                  }
                />
              ))}
            </span>
            <span>
              {rank && margin !== null
                ? `${(margin * 100).toFixed(1)}% faster than ${rank.rank.tier} · ${formatSwimTime(rank.cut.time)} cut`
                : "Standards use age at swim and swim date"}
            </span>
          </span>
        )}
        <span className={s.ranking}>
          <Medal size={featured ? 22 : 17} aria-hidden="true" />
          <span>
            <strong>
              {hasTeamRank ? `#${event.allTimeRank}` : "Unranked"}
            </strong>
            <span>{featured ? "All-time team rank" : "Team rank"}</span>
          </span>
          {featured && (
            <span className={s.rankContext}>
              {event.rankAgeGroup
                ? `${event.rankAgeGroup.replace("-", "–")} ${event.rankGender === "F" ? "girls" : event.rankGender === "M" ? "boys" : ""}`
                : "Age group unavailable"}
              {hasTeamRank && event.allTimeCount > 0 && (
                <span>of {event.allTimeCount} swimmers</span>
              )}
            </span>
          )}
        </span>
        {featured && (
          <span className={s.raceDetails}>
            <strong>{race.meet || "Meet unavailable"}</strong>
            <span>
              <time dateTime={race.date.slice(0, 10)}>
                {raceDate(race.date)}
              </time>
              {race.ageAtSwim != null && <> · Age {race.ageAtSwim}</>}
              {race.round && (
                <>
                  {" "}
                  ·{" "}
                  {(
                    {
                      F: "Final",
                      P: "Prelim",
                      S: "Semifinal",
                      T: "Time trial",
                    } as Record<string, string>
                  )[race.round] ?? race.round}
                </>
              )}
            </span>
          </span>
        )}
      </button>
    </li>
  );
}

export default function TimesHighlights({
  events,
  sets,
  onRankings,
  onBestsGrid,
}: {
  events: MyTimesEvent[];
  sets: StandardSet[];
  onRankings: (event: MyTimesEvent) => void;
  onBestsGrid: () => void;
}) {
  const highlights = rankHighlights(events, sets);
  const achieved = highlights.filter((item) => item.rank);
  const strokeCounts = strokes.map(([key, label]) => ({
    key,
    label,
    count: highlights.filter((item) => item.event.event.split("_")[1] === key)
      .length,
  }));
  if (!highlights.length) return null;
  return (
    <section className={s.highlights} aria-label="Highlights">
      <header className={s.header}>
        <div>
          <span className={s.eyebrow}>The best of your bests</span>
          <h2>Highlights</h2>
        </div>
        <p>
          {Math.min(highlights.length, 8)} standout{" "}
          {highlights.length === 1 ? "swim" : "swims"} · strongest first
        </p>
      </header>
      <ol className={s.featuredList} role="list" aria-label="Top highlights">
        {highlights.slice(0, 3).map((highlight, index) => (
          <HighlightCard
            key={highlight.event.event}
            highlight={highlight}
            position={index + 1}
            onRankings={onRankings}
          />
        ))}
      </ol>
      {highlights.length > 3 && (
        <ol
          className={s.compactList}
          start={4}
          role="list"
          aria-label="More highlights"
        >
          {highlights.slice(3, 8).map((highlight, index) => (
            <HighlightCard
              key={highlight.event.event}
              highlight={highlight}
              position={index + 4}
              onRankings={onRankings}
            />
          ))}
        </ol>
      )}
      <div className={s.profileHeading}>
        <div>
          <h3>Beyond the bests</h3>
          <p>Across all {highlights.length} bests in this selection</p>
        </div>
        <button type="button" onClick={onBestsGrid}>
          View Bests Grid <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
      <div className={s.aggregates}>
        <section className={s.aggregate} aria-label="Standards achieved">
          <div className={s.aggregateTitle}>
            <Medal size={20} aria-hidden="true" />
            <h3>Standards achieved</h3>
          </div>
          <p className={s.aggregateValue}>
            <strong>{achieved.length}</strong>
            <span>of {highlights.length} events with a matched standard</span>
          </p>
          <div className={s.standardCounts}>
            {motivationalRanks.map((rank) => {
              const count = achieved.filter(
                (item) => item.rank?.rank.tier === rank.tier,
              ).length;
              return (
                <div
                  key={rank.tier}
                  className={s.standardCount}
                  data-empty={!count}
                  aria-label={`${rank.name}, ${rank.tier}: ${count} events`}
                >
                  <MotivationalRankIcon tier={rank.tier} size={30} decorative />
                  <strong>{count}</strong>
                  <span>{rank.tier}</span>
                </div>
              );
            })}
          </div>
          <p className={s.aggregateNote}>
            Each event counts once at its highest matched standard. Unmatched
            events are not counted.
          </p>
        </section>
        <section className={s.aggregate} aria-label="Stroke coverage">
          <div className={s.aggregateTitle}>
            <Waves size={20} aria-hidden="true" />
            <h3>Stroke coverage</h3>
          </div>
          <p className={s.aggregateValue}>
            <strong>
              {strokeCounts.filter((stroke) => stroke.count > 0).length}
              <small>/5</small>
            </strong>
            <span>stroke groups with a best time</span>
          </p>
          <div className={s.strokeCounts}>
            {strokeCounts.map(({ key, label, count }) => (
              <div key={key} className={s.strokeRow}>
                <span>{label}</span>
                <span className={s.strokeBar} aria-hidden="true">
                  <span
                    style={{ width: `${(count / highlights.length) * 100}%` }}
                  />
                </span>
                <strong aria-label={`${count} events`}>{count}</strong>
              </div>
            ))}
          </div>
          <p className={s.aggregateNote}>
            Number of events with a best in each stroke group.
          </p>
        </section>
      </div>
      <p className={s.explainer}>
        Ordered by USA Swimming motivational standard, then percentage faster
        than that cut. Team rank breaks ties and orders swims without a
        standard. Standards reflect age and date at the swim.
      </p>
    </section>
  );
}

export function TimesHighlightsSkeleton() {
  return (
    <div className={s.highlights}>
      <div className={s.header}>
        <SkeletonText width="12ch" height="2rem" />
        <Layers3 size={24} />
      </div>
      <div className={s.featuredList}>
        {[0, 1, 2].map((index) => (
          <div
            className={`${s.card} ${s.featured}`}
            key={index}
            data-loading-card=""
          >
            <SkeletonText width="60%" />
            <SkeletonText width="75%" height="3rem" />
            <SkeletonText width="100%" />
            <SkeletonText width="65%" />
            <SkeletonText width="90%" />
          </div>
        ))}
      </div>
      <div className={s.compactList}>
        {[0, 1, 2, 3, 4].map((index) => (
          <div
            className={`${s.card} ${s.compact}`}
            key={index}
            data-loading-card=""
          >
            <SkeletonText width="85%" height="2rem" />
          </div>
        ))}
      </div>
    </div>
  );
}
