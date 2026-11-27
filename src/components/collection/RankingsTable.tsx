import { Fragment } from "react";
import Link from "next/link";
import { formatSwimTime } from "@/features/swim-resources/lib/domain/swim-time";
import type { StandardSet } from "@/features/swim-resources/types/schema";
import type { Filters } from "@/features/swimming/domain/times";
import type { TimesResponse } from "@/features/swimming/domain/times-query";
import { SkeletonText } from "./LoadingSkeleton";
import { ModerationNotice } from "./ResultModeration";
import RelayLineup from "./RelayLineup";
import CutChips from "./CutChips";
import { crossedRankingCutoffs, type RankingCutoff } from "./ranking-cutoffs";
import { athleteTimesHref } from "./times-url-state";
import s from "./TimesDatabase.module.css";
import loadingStyles from "./TimesLoading.module.css";

function CutoffDivider({
  cutoff,
  columns,
  loading = false,
}: {
  cutoff: RankingCutoff;
  columns: number;
  loading?: boolean;
}) {
  const label = `${formatSwimTime(cutoff.time)} ${cutoff.rank.name.toUpperCase()} CUTOFF · ${cutoff.seasonYears}`;
  return (
    <tr className={s.cutoffRow} aria-hidden={loading || undefined}>
      {[false, true].map((wide) => (
        <td
          key={String(wide)}
          colSpan={wide ? columns : columns - 1}
          className={wide ? s.cutoffWide : s.cutoffCompact}
        >
          {!loading && <span className="sr-only">{label}</span>}
          <div
            className={`${s.cutoffLine} ${loading ? s.cutoffLoading : ""}`}
            style={loading ? undefined : { backgroundColor: cutoff.rank.color }}
            aria-hidden="true"
          >
            {Array.from({ length: 8 }, (_, index) => (
              <span key={index}>
                {loading ? <SkeletonText width={200} height={9} /> : label}
              </span>
            ))}
          </div>
        </td>
      ))}
    </tr>
  );
}

function RankingTableHead({
  showRank,
  relay,
}: {
  showRank: boolean;
  relay: boolean;
}) {
  return (
    <thead>
      <tr>
        {showRank && (
          <th scope="col" className={s.rank}>
            <span className="sr-only">Rank</span>
          </th>
        )}
        <th scope="col" className={s.rankingAthlete}>
          {relay ? "Relay team" : "Athlete"}
        </th>
        <th scope="col">Time</th>
        <th scope="col" className={s.rankingDate}>
          Date
        </th>
        <th scope="col" className={s.rankingMeet}>
          Meet
        </th>
      </tr>
    </thead>
  );
}

function RankingsLoadingRows({
  pageSize,
  rows = [],
  previousTime,
  cutoffs = [],
  showRank = true,
  relay = false,
}: {
  pageSize: number;
  rows?: NonNullable<TimesResponse["rows"]>;
  previousTime?: number;
  cutoffs?: RankingCutoff[];
  showRank?: boolean;
  relay?: boolean;
}) {
  return (
    <tbody
      className={loadingStyles.pulse}
      data-loading-skeleton="rankings"
      aria-hidden="true"
    >
      {Array.from({ length: rows.length || pageSize }, (_, index) => (
        <Fragment key={index}>
          {rows[index] &&
            crossedRankingCutoffs(
              cutoffs,
              index > 0 ? rows[index - 1].race.time : previousTime,
              rows[index].race.time,
            ).map((cutoff) => (
              <CutoffDivider
                key={cutoff.rank.tier}
                cutoff={cutoff}
                columns={showRank ? 5 : 4}
                loading
              />
            ))}
          <tr className={s.rankingLoadingRow}>
            {showRank && (
              <td className={s.rank}>
                <SkeletonText width={16} height={13} />
              </td>
            )}
            <td className={s.rankingAthlete}>
              <div className={s.rankingAthleteContent}>
                {relay ? (
                  <div className={s.rankingRelaySkeleton}>
                    {Array.from({ length: 4 }, (_, leg) => (
                      <SkeletonText key={leg} width={72} height={13} />
                    ))}
                  </div>
                ) : (
                  <SkeletonText width={150} height={13} />
                )}
              </div>
            </td>
            <td>
              <div className={s.rankingTimeContent}>
                <span className={s.rankingTimeValue}>
                  <SkeletonText width={62} height={18} />
                </span>
                <span className={s.rankingCutSlot}>
                  <SkeletonText width={24} height={24} />
                </span>
              </div>
            </td>
            <td className={s.rankingDate}>
              <SkeletonText width={85} height={13} />
            </td>
            <td className={s.rankingMeet}>
              <SkeletonText width="70%" height={13} />
            </td>
          </tr>
        </Fragment>
      ))}
    </tbody>
  );
}

export function RankingsTableSkeleton({ pageSize }: { pageSize: number }) {
  return (
    <div className={s.tableWrap}>
      <table className={`${s.table} ${s.rankingTable}`} aria-busy="true">
        <RankingTableHead showRank relay={false} />
        <RankingsLoadingRows pageSize={pageSize} />
      </table>
    </div>
  );
}

export default function RankingsTable({
  rows,
  previousTime,
  loading,
  pageSize,
  mode,
  relay,
  cutoffs,
  standards,
  formatDate,
  onNavigate,
}: {
  rows: NonNullable<TimesResponse["rows"]>;
  previousTime?: number;
  loading: boolean;
  pageSize: number;
  mode: Filters["mode"];
  relay: boolean;
  cutoffs: RankingCutoff[];
  standards: StandardSet[];
  formatDate: (value: string) => string;
  onNavigate: (href: string) => void;
}) {
  const showRank = mode !== "recent";
  const names = new Map(
    rows.map(({ race }) => [
      race.athleteId,
      race.athleteName || race.athleteId,
    ]),
  );
  return (
    <div className={s.tableWrap}>
      <table
        aria-busy={loading}
        className={`${s.table} ${s.rankingTable} ${relay ? s.relayRankings : ""}`}
      >
        <caption className="sr-only">
          {mode === "recent"
            ? "Recent event results, newest first"
            : mode === "bests" && !relay
              ? "Rankings, one best swim per athlete in the selected age groups"
              : "Rankings, every matching performance"}
        </caption>
        <RankingTableHead showRank={showRank} relay={relay} />
        {loading ? (
          <RankingsLoadingRows
            pageSize={pageSize}
            rows={rows}
            previousTime={previousTime}
            cutoffs={cutoffs}
            showRank={showRank}
            relay={relay}
          />
        ) : (
          <tbody>
            {rows.map(({ race, rank }, index) => (
              <Fragment key={race.id}>
                {crossedRankingCutoffs(
                  cutoffs,
                  index > 0 ? rows[index - 1].race.time : previousTime,
                  race.time,
                ).map((cutoff) => (
                  <CutoffDivider
                    key={cutoff.rank.tier}
                    cutoff={cutoff}
                    columns={showRank ? 5 : 4}
                  />
                ))}
                <tr
                  onClick={
                    race.relay
                      ? undefined
                      : (event) => {
                          if (
                            (event.target as HTMLElement).closest("a, button")
                          )
                            return;
                          onNavigate(
                            athleteTimesHref(race.athleteId, race.course),
                          );
                        }
                  }
                >
                  {showRank && <td className={s.rank}>{rank}</td>}
                  <td className={s.rankingAthlete}>
                    <div className={s.rankingAthleteContent}>
                      {race.relay ? (
                        <RelayLineup race={race} linkProfiles />
                      ) : (
                        (names.get(race.athleteId) ?? race.athleteId)
                      )}
                    </div>
                  </td>
                  <td>
                    <div className={s.rankingTimeContent}>
                      {race.relay ? (
                        <span className={`${s.time} ${s.rankingTimeValue}`}>
                          {race.status === "OK"
                            ? formatSwimTime(race.time)
                            : race.status || "—"}
                        </span>
                      ) : (
                        <Link
                          className={`${s.time} ${s.rankingTimeValue}`}
                          href={athleteTimesHref(race.athleteId, race.course)}
                          aria-label={`View Times profile for ${names.get(race.athleteId) ?? race.athleteId}`}
                        >
                          {race.status === "OK"
                            ? formatSwimTime(race.time)
                            : race.status || "—"}
                        </Link>
                      )}
                      <span className={s.rankingCutSlot}>
                        <CutChips
                          race={race}
                          sets={standards}
                          inline
                          motivationalIcons
                        />
                      </span>
                    </div>
                    <ModerationNotice race={race} />
                  </td>
                  <td className={s.rankingDate}>{formatDate(race.date)}</td>
                  <td className={s.rankingMeet}>
                    {race.meet || "Meet unavailable"}
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        )}
      </table>
    </div>
  );
}
