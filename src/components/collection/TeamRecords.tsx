"use client";

import { useId, useMemo } from "react";
import { VELOCITY_TEAM } from "@/features/swim-resources/lib/domain/entities";
import { formatSwimTime } from "@/features/swim-resources/lib/domain/swim-time";
import {
  ageGroups,
  eventLabel,
  resultName,
  recordCourses,
  recordEvents,
  recordKey,
  relayMemberName,
  type Race,
} from "./times-data";
import s from "./TeamRecords.module.css";
import loadingStyles from "./TimesLoading.module.css";
import { SkeletonText, SkeletonStatus } from "./LoadingSkeleton";
import RelayLineup from "./RelayLineup";
import { useRecordsSelection } from "./use-records-selection";

const visibleCourses = recordCourses.filter(
  (entry): entry is (typeof recordCourses)[0] | (typeof recordCourses)[1] =>
    entry[0] !== "SCM",
);
const recordGenders = [
  ["F", "Girls"],
  ["M", "Boys"],
] as const;
const emptyRecordBoard: Record<string, string[]> = {};

function shortEventLabel(event: string) {
  return eventLabel(event)
    .replace("Freestyle", "Free")
    .replace("Backstroke", "Back")
    .replace("Breaststroke", "Breast")
    .replace("Butterfly", "Fly")
    .replace(/Individual medley/i, "IM");
}

export interface RecordSelection {
  course: string;
  ageGroup: string;
  event: string;
  gender: string;
  relay?: boolean;
}
function RecordCell({
  holders,
  names,
  selection,
  ageLabel,
  onRecord,
  loading = false,
}: {
  loading?: boolean;
  holders: Race[];
  names: Map<string, string>;
  selection: RecordSelection;
  ageLabel: string;
  onRecord: (selection: RecordSelection) => void;
}) {
  const gender = selection.gender === "F" ? "girls" : "boys";
  const label = `View ${gender} ${ageLabel} ${selection.course} ${selection.event.replace("_", " ")} rankings`;
  const column = selection.gender === "F" ? s.girlsColumn : s.boysColumn;
  return (
    <td
      className={`${s.recordCell} ${column}`}
      data-relay={selection.relay || undefined}
    >
      <div>
        {loading ? (
          Array.from({ length: Math.max(holders.length, 1) }, (_, index) => (
            <div
              key={index}
              className={`${s.recordBoard} ${s.loadingBoard} ${loadingStyles.pulse}`}
              aria-hidden="true"
            >
              <div className={s.recordName}>
                {selection.relay ? (
                  <div className={s.relayNameSkeleton}>
                    {Array.from({ length: 4 }, (_, leg) => (
                      <span key={leg}>
                        <SkeletonText width="85%" height={13} />
                      </span>
                    ))}
                  </div>
                ) : (
                  <SkeletonText width="85%" height={13} />
                )}
              </div>
              <span className={s.time}>
                <SkeletonText width={64} height={15} />
              </span>
              <span className={s.recordYear}>
                <SkeletonText width={28} height={11} />
              </span>
            </div>
          ))
        ) : holders.length ? (
          holders.map((race) => {
            const year = race.date.slice(0, 4) || "—";
            const name = resultName(race, names);
            const time = formatSwimTime(race.time);
            const contents = (
              <>
                <span className={s.recordName}>
                  <span className={s.fullName}>{name}</span>
                  <span className={s.mobileName}>{relayMemberName(name)}</span>
                </span>
                <span className={s.time}>{time}</span>
                <span className={s.recordYear}>{year}</span>
              </>
            );
            return race.relay ? (
              <div key={race.id} className={s.recordBoard}>
                <div className={s.recordName}>
                  <RelayLineup race={race} />
                </div>
                <button
                  className={s.time}
                  onClick={() => onRecord(selection)}
                  aria-label={label}
                >
                  {time}
                </button>
                <span className={s.recordYear}>{year}</span>
              </div>
            ) : (
              <button
                key={race.id}
                className={s.recordBoard}
                onClick={() => onRecord(selection)}
                aria-label={label}
                title={`${name} · ${time} · ${year}`}
              >
                {contents}
              </button>
            );
          })
        ) : selection.relay ? (
          <button
            className={`${s.recordBoard} ${s.missing}`}
            onClick={() => onRecord(selection)}
            aria-label={label}
          />
        ) : (
          <div
            className={`${s.recordBoard} ${s.missing}`}
            aria-label="No available record"
          />
        )}
      </div>
    </td>
  );
}

export function TeamRecordsSkeleton() {
  return (
    <TeamRecords
      races={[]}
      names={new Map()}
      onRecord={() => {}}
      loading
      ready={false}
    />
  );
}
export default function TeamRecords({
  races,
  recordBoard = emptyRecordBoard,
  updatedAt,
  names,
  onRecord,
  ready = true,
  loading = false,
}: {
  races: Race[];
  recordBoard?: Record<string, string[]>;
  updatedAt?: string | null;
  names: Map<string, string>;
  onRecord: (selection: RecordSelection) => void;
  ready?: boolean;
  loading?: boolean;
}) {
  const prefix = useId().replaceAll(":", "");
  const [selection, updateSelection] = useRecordsSelection();
  const {
    course: selectedCourse,
    ageGroup: selectedGroup,
    mobileGender,
    showAll,
  } = selection;
  const refreshed = updatedAt ? new Date(updatedAt) : null;
  const currentDate = refreshed?.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  });
  const dateValue = refreshed?.toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
  const visibleRaces = useMemo(
    () =>
      races.filter(
        (race) => race.course !== "SCM" && (!race.relay || race.gender !== "X"),
      ),
    [races],
  );
  const records = useMemo(() => {
    const byId = new Map(visibleRaces.map((race) => [race.id, race]));
    return new Map(
      Object.entries(recordBoard)
        .filter(([key]) => !key.startsWith("SCM:") && !key.endsWith(":X"))
        .map(([key, ids]) => [key, ids.flatMap((id) => byId.get(id) ?? [])]),
    );
  }, [recordBoard, visibleRaces]);
  const groups = ageGroups.map(
    ([key, label, minAge]) => [key, label, minAge] as const,
  );
  const events = useMemo(
    () =>
      new Map(
        visibleCourses.map(([course]) => [
          course,
          recordEvents(course, visibleRaces).filter(
            (event) => !(event.startsWith("100_") && event.endsWith("-R")),
          ),
        ]),
      ),
    [visibleRaces],
  );
  const anchor = (course: string, group?: string) =>
    `${prefix}-${course}${group ? `-${group.replace(/[^a-z0-9]/gi, "")}` : ""}`;
  return (
    <section
      className={s.records}
      aria-label="Records"
      aria-busy={loading}
      data-mobile-gender={mobileGender}
    >
      {loading && <SkeletonStatus>Loading team records…</SkeletonStatus>}
      <div id={`${prefix}-top`} className={s.controls}>
        <nav className={s.jumpLinks} aria-label="Record sections">
          {visibleCourses.map(([course, label]) => (
            <div
              className={s.jumpRow}
              key={course}
              role="group"
              aria-label={`${label} navigation`}
            >
              <button
                type="button"
                className={s.courseLink}
                title={label}
                aria-label={`${label} records`}
                aria-pressed={!showAll && selectedCourse === course}
                onClick={() => updateSelection({ course, showAll: false })}
              >
                {course}
              </button>
              {groups.map(([key, text]) => (
                <button
                  key={key}
                  type="button"
                  aria-label={`${course} ${text} records`}
                  aria-pressed={
                    !showAll &&
                    selectedCourse === course &&
                    selectedGroup === key
                  }
                  onClick={() =>
                    updateSelection({ course, ageGroup: key, showAll: false })
                  }
                >
                  {text}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <button
          type="button"
          className={s.renderAll}
          aria-pressed={showAll}
          onClick={() => updateSelection({ showAll: true })}
        >
          Render all records
        </button>
      </div>
      {(ready || loading) && (
        <>
          <div
            className={s.genderToggle}
            role="group"
            aria-label="Record gender"
          >
            {recordGenders.map(([gender, label]) => (
              <button
                key={gender}
                type="button"
                aria-pressed={mobileGender === gender}
                onClick={() => updateSelection({ mobileGender: gender })}
              >
                {label}
              </button>
            ))}
          </div>
          {!loading && ready && !records.size && (
            <p className={s.empty}>
              No eligible Velocity Swimming records in the available results.
            </p>
          )}
          {visibleCourses
            .filter(([course]) => showAll || course === selectedCourse)
            .map(([course]) => (
              <section
                key={course}
                id={anchor(course)}
                className={s.course}
                aria-label={`${course} records`}
              >
                {groups
                  .filter(([group]) => showAll || group === selectedGroup)
                  .map(([group, ageLabel, minAge]) => (
                    <section
                      key={group}
                      id={anchor(course, group)}
                      className={s.ageSection}
                      aria-label={`${course} ${ageLabel} records`}
                    >
                      <div
                        className={s.tableWrap}
                        role="region"
                        aria-label={`${course} ${ageLabel} record table`}
                      >
                        <table className={s.table}>
                          <caption>
                            <div className={s.tableHeading}>
                              <span
                                className={s.genderLabel}
                                aria-hidden="true"
                              >
                                Girls
                              </span>
                              <div className={s.tableTitle}>
                                {loading ? (
                                  <span
                                    className={`${s.updatedLine} ${loadingStyles.pulse}`}
                                    aria-hidden="true"
                                  >
                                    <SkeletonText width={132} height={12} />
                                  </span>
                                ) : currentDate ? (
                                  <time dateTime={dateValue}>
                                    Updated {currentDate}
                                  </time>
                                ) : (
                                  <span>Updating records</span>
                                )}
                                <h3>
                                  {VELOCITY_TEAM.name} · {ageLabel} · {course}
                                </h3>
                              </div>
                              <span
                                className={s.genderLabel}
                                aria-hidden="true"
                              >
                                Boys
                              </span>
                            </div>
                          </caption>
                          <colgroup>
                            <col className={s.mobileEvent} />
                            <col className={s.girlsColumn} />
                            <col className={s.desktopEvent} />
                            <col className={s.boysColumn} />
                          </colgroup>
                          <thead className="sr-only">
                            <tr>
                              <th scope="col" className={s.mobileEvent}>
                                Event
                              </th>
                              <th scope="col" className={s.girlsColumn}>
                                Girls
                              </th>
                              <th scope="col" className={s.desktopEvent}>
                                Event
                              </th>
                              <th scope="col" className={s.boysColumn}>
                                Boys
                              </th>
                            </tr>
                          </thead>
                          <tbody
                            data-loading-skeleton={
                              loading ? "records" : undefined
                            }
                          >
                            {(events.get(course) ?? [])
                              .filter(
                                (event) =>
                                  !(
                                    course === "SCY" &&
                                    minAge >= 11 &&
                                    event.startsWith("25_")
                                  ),
                              )
                              .map((event) => {
                                const label = eventLabel(event);
                                const relay = event.endsWith("-R");
                                const eventClass = `${s.event} ${relay ? s.relayEvent : ""}`;
                                return (
                                  <tr key={event}>
                                    <th
                                      scope="row"
                                      className={`${eventClass} ${s.mobileEvent}`}
                                    >
                                      <span>{shortEventLabel(event)}</span>
                                    </th>
                                    <RecordCell
                                      loading={loading}
                                      holders={
                                        records.get(
                                          recordKey(course, group, event, "F"),
                                        ) ?? []
                                      }
                                      names={names}
                                      selection={{
                                        course,
                                        ageGroup: group,
                                        event,
                                        gender: "F",
                                        relay,
                                      }}
                                      ageLabel={ageLabel}
                                      onRecord={onRecord}
                                    />
                                    <th
                                      scope="row"
                                      className={`${eventClass} ${s.desktopEvent}`}
                                    >
                                      <span>{label}</span>
                                    </th>
                                    <RecordCell
                                      loading={loading}
                                      holders={
                                        records.get(
                                          recordKey(course, group, event, "M"),
                                        ) ?? []
                                      }
                                      names={names}
                                      selection={{
                                        course,
                                        ageGroup: group,
                                        event,
                                        gender: "M",
                                        relay,
                                      }}
                                      ageLabel={ageLabel}
                                      onRecord={onRecord}
                                    />
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  ))}
              </section>
            ))}
        </>
      )}
    </section>
  );
}
