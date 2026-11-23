"use client";

import { useId, useState, type CSSProperties } from "react";
import { GemFamilyChart } from "./GemFamilyChart";
import { motivationalRanks } from "./motivational-ranks";
import type { TeamMapGemHistoryPoint, TeamMapSnapshot } from "./team-map-data";
import s from "./TeamMapGems.module.css";

const number = (value: number) => value.toLocaleString("en-US");
const dateLabel = (value: string) =>
  new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
const colorStyle = (color: string) =>
  ({ "--gem-color": color }) as CSSProperties;

function GemLegend({ counts }: { counts?: Record<string, number> }) {
  return (
    <ul className={s.legend} aria-label="Gem colors, lowest to highest rank">
      {motivationalRanks.map((rank) => (
        <li key={rank.tier} style={colorStyle(rank.color)}>
          <span className={s.square} aria-hidden="true" />
          <span>{rank.name}</span>
          {counts && <strong>{number(counts[rank.tier] ?? 0)}</strong>}
        </li>
      ))}
    </ul>
  );
}

function GemHistory({ points }: { points: TeamMapGemHistoryPoint[] }) {
  const id = useId();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last || last.total === 0)
    return (
      <p className={s.empty}>
        No gems have been earned in this course selection yet.
      </p>
    );

  const index = Math.min(selectedIndex ?? points.length - 1, points.length - 1);
  const selected = points[index];
  const start = Date.parse(first.date);
  const duration = Math.max(86400000, Date.parse(last.date) - start);
  const ceiling = Math.max(4, Math.ceil(last.total / 4) * 4);
  const x = (point: TeamMapGemHistoryPoint) =>
    48 + ((Date.parse(point.date) - start) / duration) * 636;
  const y = (value: number) => 228 - (value / ceiling) * 200;
  const rounded = (value: number) => Number(value.toFixed(2));
  const stepPath = (values: number[]) =>
    points
      .map((point, i) =>
        i === 0
          ? `M${rounded(x(point))},${rounded(y(values[i]))}`
          : `H${rounded(x(point))}V${rounded(y(values[i]))}`,
      )
      .join(" ");
  const areas = motivationalRanks.map((rank, rankIndex) => {
    const lower = points.map((point) =>
      motivationalRanks
        .slice(0, rankIndex)
        .reduce(
          (total, lowerRank) => total + (point.counts[lowerRank.tier] ?? 0),
          0,
        ),
    );
    const upper = lower.map(
      (value, i) => value + (points[i].counts[rank.tier] ?? 0),
    );
    const backwards = points
      .toReversed()
      .map((point, i) => {
        const original = points.length - 1 - i;
        return i === 0
          ? `L${rounded(x(point))},${rounded(y(lower[original]))}`
          : `V${rounded(y(lower[original]))}H${rounded(x(point))}`;
      })
      .join(" ");
    const area = { rank, path: `${stepPath(upper)} ${backwards} Z` };
    return area;
  });

  return (
    <div className={s.history}>
      <div className={s.historySummary} aria-live="polite">
        <span>
          <strong>{number(selected.total)}</strong> gems
        </span>
        <time dateTime={selected.date}>{dateLabel(selected.date)}</time>
      </div>
      <svg
        className={s.historySvg}
        viewBox="0 0 708 248"
        role="img"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
      >
        <title id={`${id}-title`}>Current roster gem totals over time</title>
        <desc id={`${id}-description`}>
          Cumulative gems from {dateLabel(first.date)} to {dateLabel(last.date)}
          , ending at {last.total}. Colored bands show each rank. Use the date
          slider below to read exact totals.
        </desc>
        {[0, 1, 2, 3, 4].map((tick) => {
          const value = (ceiling * tick) / 4;
          return (
            <g key={tick} className={s.gridLine}>
              <line x1="48" x2="684" y1={y(value)} y2={y(value)} />
              <text x="37" y={y(value) + 4} textAnchor="end">
                {number(value)}
              </text>
            </g>
          );
        })}
        {areas.map(({ rank, path }) => (
          <path key={rank.tier} d={path} fill={rank.color} fillOpacity="0.72" />
        ))}
        <path
          d={stepPath(points.map((point) => point.total))}
          className={s.totalLine}
        />
        <line
          className={s.selectedLine}
          x1={x(selected)}
          x2={x(selected)}
          y1="28"
          y2="228"
        />
        <circle
          className={s.selectedDot}
          cx={x(selected)}
          cy={y(selected.total)}
          r="4"
        />
      </svg>
      <div className={s.dateExtent} aria-hidden="true">
        <span>{dateLabel(first.date)}</span>
        <span>{dateLabel(last.date)}</span>
      </div>
      <label className={s.sliderLabel} htmlFor={`${id}-date`}>
        Explore the collection over time
      </label>
      <input
        id={`${id}-date`}
        className={s.dateSlider}
        type="range"
        min="0"
        max={points.length - 1}
        value={index}
        aria-label="Gem history date"
        aria-valuetext={`${dateLabel(selected.date)}: ${number(selected.total)} gems`}
        onChange={(event) => setSelectedIndex(Number(event.target.value))}
      />
      <GemLegend counts={selected.counts} />
    </div>
  );
}

export function TeamMapGemSections({ data }: { data: TeamMapSnapshot }) {
  return (
    <>
      <div className={s.charts}>
        <section
          className={s.panel}
          aria-labelledby="team-gem-families-heading"
        >
          <header className={s.heading}>
            <span>Six ways to contribute</span>
            <h2 id="team-gem-families-heading">Gems by event family</h2>
            <p>
              Career gems from the current roster, in{" "}
              {data.course || "all courses"}.
            </p>
          </header>
          <GemFamilyChart counts={data.familyCounts} label="Team gem profile" />
        </section>
        <section className={s.panel} aria-labelledby="team-gem-history-heading">
          <header className={s.heading}>
            <span>The collection grows</span>
            <h2 id="team-gem-history-heading">Gems over time</h2>
            <p>
              The recorded history of today’s roster, through{" "}
              {dateLabel(data.asOf)}.
            </p>
          </header>
          <GemHistory
            key={`${data.course}|${data.asOf}`}
            points={data.gemHistory}
          />
          <p className={s.note}>
            A new event or age band adds a gem. An upgrade changes its color and
            keeps the total. This uses today’s roster throughout, regardless of
            the activity year.
          </p>
        </section>
      </div>
      <section
        className={s.rosterSection}
        aria-labelledby="team-roster-heading"
      >
        <header className={s.rosterHeading}>
          <div className={s.heading}>
            <span>Every swimmer, every gem</span>
            <h2 id="team-roster-heading">Active roster</h2>
            <p>One square per earned gem, sorted from Bronze to Elite.</p>
          </div>
          <span className={s.rosterCount}>
            {number(data.roster.length)} swimmers
          </span>
        </header>
        <GemLegend />
        {data.roster.length === 0 ? (
          <p className={s.empty}>No active roster members yet.</p>
        ) : (
          <ul className={s.roster} aria-label="Active roster gems">
            {data.roster.map((person) => (
              <li key={person.id} className={s.rosterRow}>
                <div className={s.person}>
                  <strong>{person.name}</strong>
                  {person.trainingGroups.length > 0 && (
                    <small>{person.trainingGroups.join(" · ")}</small>
                  )}
                </div>
                {person.total > 0 ? (
                  <div
                    className={s.gems}
                    role="img"
                    aria-label={motivationalRanks
                      .filter((rank) => person.counts[rank.tier] > 0)
                      .map(
                        (rank) =>
                          `${number(person.counts[rank.tier])} ${rank.name}`,
                      )
                      .join(", ")}
                  >
                    {motivationalRanks.map(
                      (rank) =>
                        person.counts[rank.tier] > 0 && (
                          <span
                            key={rank.tier}
                            className={s.gemGroup}
                            style={colorStyle(rank.color)}
                            title={`${number(person.counts[rank.tier])} ${rank.name} (${rank.tier})`}
                            aria-hidden="true"
                          >
                            {Array.from(
                              { length: person.counts[rank.tier] },
                              (_, i) => (
                                <span
                                  className={s.square}
                                  data-gem-tier={rank.tier}
                                  key={i}
                                />
                              ),
                            )}
                          </span>
                        ),
                    )}
                  </div>
                ) : (
                  <span className={s.noGems}>
                    {person.athleteId
                      ? "No gems yet"
                      : "Times profile not linked"}
                  </span>
                )}
                <span
                  className={s.gemTotal}
                  aria-label={`${number(person.total)} gems`}
                >
                  {number(person.total)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
