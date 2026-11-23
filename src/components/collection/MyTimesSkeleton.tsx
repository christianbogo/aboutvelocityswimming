import { SkeletonStatus, SkeletonText } from "./LoadingSkeleton";
import { strokeColumns, compareEvents, eventColumn } from "./event-layout";
import { timesEvents } from "./times-data";
import type { MyTimesEvent } from "./times-api";
import grid from "./TimeStandards.module.css";
import times from "./TimesDatabase.module.css";
import loading from "./TimesLoading.module.css";
import s from "./MyTimes.module.css";
import selection from "./TimesSelectionDropdown.module.css";

export function MyTimesPageSkeleton() {
  return (
    <main className={times.page} aria-busy="true">
      <div className={`${times.content} ${times.myTimesContent}`}>
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
  showTimeStats = false,
  showDateAge = false,
}: {
  course?: string;
  events?: MyTimesEvent[];
  full?: boolean;
  hide25s?: boolean;
  showTimeStats?: boolean;
  showDateAge?: boolean;
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
            <div className={`${selection.filterPanel} ${s.filters}`}>
              {["Athlete", "Course", "Best times from"].map((label) => (
                <div
                  className={`${selection.dropdown} ${selection.skeletonFilter}`}
                  key={label}
                >
                  <span className={selection.selectionLabel}>{label}</span>
                  <SkeletonText width={label === "Athlete" ? "10ch" : "14ch"} />
                </div>
              ))}
            </div>
            <div className={s.displayOptions}>
              {["Show 25s", "Show time stats", "Show date & age"].map(
                (label) => (
                  <span className={s.displayToggle} key={label}>
                    <SkeletonText
                      width="2.25rem"
                      height="1.25rem"
                      style={{ borderRadius: "999px", flexShrink: 0 }}
                    />
                    {label}
                  </span>
                ),
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
                    <span className={s.cardHeader}>
                      <span className={s.cardHeading}>
                        <span className={grid.distance}>
                          {event.split("_")[0]}{" "}
                          {stroke === "DST" ? "Free" : heading}
                        </span>
                      </span>
                      {showTimeStats && (
                        <span className={s.rankIcon}>
                          <SkeletonText
                            width="100%"
                            height="100%"
                            style={{ borderRadius: 6 }}
                          />
                        </span>
                      )}
                    </span>
                    <strong>
                      <SkeletonText width="6ch" />
                    </strong>
                    {showDateAge && (
                      <span className={s.raceDate}>
                        <SkeletonText width="8ch" />{" "}
                        <span className={s.swimAge}>
                          <SkeletonText width="6ch" />
                        </span>
                      </span>
                    )}
                    {showTimeStats && (
                      <span className={s.teamRank}>
                        <SkeletonText width="7ch" />
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
