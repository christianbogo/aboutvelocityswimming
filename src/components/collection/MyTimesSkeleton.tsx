import { SkeletonStatus, SkeletonText } from "./LoadingSkeleton";
import { strokeColumns, compareEvents, eventColumn } from "./event-layout";
import { timesEvents } from "./times-data";
import type { MyTimesEvent } from "./times-api";
import { RankLegend } from "./MotivationalRankIcon";
import grid from "./TimeStandards.module.css";
import times from "./TimesDatabase.module.css";
import loading from "./TimesLoading.module.css";
import s from "./MyTimes.module.css";

export function MyTimesPageSkeleton() {
  return (
    <main className={times.page} aria-busy="true">
      <div className={times.content}>
        <section
          className={`${grid.page} ${s.page}`}
          aria-label="Times"
          aria-busy="true"
        >
          <MyTimesSkeleton />
        </section>
      </div>
    </main>
  );
}

export default function MyTimesSkeleton({
  course = "SCY",
  events,
  full = true,
  hide25s = true,
  showTeamRanks = false,
  showRankIcon = false,
}: {
  course?: string;
  events?: MyTimesEvent[];
  full?: boolean;
  hide25s?: boolean;
  showTeamRanks?: boolean;
  showRankIcon?: boolean;
}) {
  const eventKeys = (
    events?.map(({ event }) => event) ?? timesEvents(course)
  ).filter((event) => !hide25s || !event.startsWith("25_"));
  return (
    <>
      <SkeletonStatus>Loading athlete times…</SkeletonStatus>
      <div
        className={`${s.skeletonLayout} ${loading.pulse}`}
        data-loading-skeleton="my-times"
        aria-hidden="true"
      >
        {full && (
          <>
            <div className={s.filterPanel}>
              {["Athlete", "Course", "Best times from"].map((label) => (
                <div
                  className={`${s.dropdown} ${s.skeletonFilter}`}
                  key={label}
                >
                  <span className={s.selectionLabel}>{label}</span>
                  <SkeletonText width={label === "Athlete" ? "10ch" : "14ch"} />
                </div>
              ))}
            </div>
            {showRankIcon && <RankLegend loading />}
            <div className={s.summary}>
              <span>
                <SkeletonText width="20ch" />
              </span>
              {showTeamRanks && (
                <span>All-time team ranks · each swim’s age group</span>
              )}
            </div>
          </>
        )}
        <div className={grid.grid}>
          {strokeColumns.map(([stroke, heading, title]) => {
            const cards = eventKeys
              .filter((key) => eventColumn(key) === stroke)
              .sort(compareEvents);
            return (
              <section key={stroke} className={grid.column}>
                <h2 title={title}>{heading}</h2>
                {!cards.length && (
                  <p className={s.noEvents}>
                    <SkeletonText width="7ch" />
                  </p>
                )}
                {cards.map((event) => (
                  <div
                    key={event}
                    className={`${grid.chip} ${s.card} ${s.skeletonCard}`}
                    data-loading-card=""
                  >
                    <span className={s.cardHeading}>
                      <span className={grid.distance}>
                        {event.split("_")[0]}{" "}
                        {stroke === "DST" ? "Free" : heading}
                      </span>
                    </span>
                    <span className={s.raceDate}>
                      <SkeletonText width="8ch" />{" "}
                      <span className={s.swimAge}>
                        <SkeletonText width="6ch" />
                      </span>
                    </span>
                    {showRankIcon && (
                      <span className={s.rankIcon}>
                        <SkeletonText
                          width={22}
                          height={22}
                          style={{ borderRadius: 6 }}
                        />
                      </span>
                    )}
                    <strong>
                      <SkeletonText width="6ch" />
                    </strong>
                    {showTeamRanks && (
                      <span className={s.teamRank}>
                        <b>
                          <SkeletonText width="6ch" />
                        </b>
                        <span>
                          <SkeletonText
                            width="90%"
                            className={s.skeletonCohort}
                          />
                        </span>
                      </span>
                    )}
                  </div>
                ))}
              </section>
            );
          })}
        </div>
        {full && (
          <p className={s.explainer}>
            <SkeletonText width="98%" />
            <SkeletonText width="91%" />
            <SkeletonText width="68%" />
          </p>
        )}
      </div>
    </>
  );
}
