"use client";

import { ArrowUpRight, ChevronDown, X } from "lucide-react";
import { useId, useRef } from "react";
import { hasBackendConfiguration } from "@/lib/supabase/client";
import type { StandardSet } from "@/features/swim-resources/types/schema";
import { useTimesSelection } from "./use-times-selection";
import type { useStandards } from "./use-standards";
import { formatSwimTime } from "@/features/swim-resources/lib/domain/swim-time";
import { strokeColumns, eventColumn } from "./event-layout";
import {
  defaultStandard,
  orderedStandards,
  standardFilters,
  standardStatus,
  standardEventKeys,
  type StandardSelection,
} from "./standards-data";
import { eventLabel } from "./times-data";
import { FilterChips, FilterSummary } from "./TimesFilters";
import DiscreteSlider from "./DiscreteSlider";
import { MotivationalRankIcon } from "./MotivationalRankIcon";
import { motivationalRankForTier } from "./motivational-ranks";
import { SkeletonStatus, SkeletonText } from "./LoadingSkeleton";
import loadingStyles from "./TimesLoading.module.css";
import s from "./TimeStandards.module.css";
import timesStyles from "./TimesDatabase.module.css";
import SelectionDropdown from "./TimesSelectionDropdown";
import selectionStyles from "./TimesSelectionDropdown.module.css";

const genderLabels: Record<string, string> = {
  F: "Female",
  M: "Male",
  Mixed: "Mixed",
};
const skeletonChoices = [
  ["Course", 3],
  ["Gender", 2],
] as const;

export function useTimeStandardsSelection(sets: StandardSet[]) {
  const [selected, setSelected] = useTimesSelection("standard", "");
  const [selection, setSelection] = useTimesSelection<StandardSelection>(
    "standardFilters",
    { course: "", gender: "", age: "", tier: "" },
  );
  const day = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
  const set =
    sets.find((set) => set.id === selected) ?? defaultStandard(sets, day);
  const filters = set ? standardFilters(set, selection) : null;
  return { day, set, filters, setSelected, setSelection };
}

type TimeStandardsSelection = ReturnType<typeof useTimeStandardsSelection>;

export function TimeStandardsSummarySkeleton() {
  return (
    <div
      className={`${timesStyles.filterSummary} ${s.summarySkeleton}`}
      aria-hidden="true"
    >
      <div className={s.summarySkeletonTitle}>
        <SkeletonText width="100%" />
      </div>
      {["2rem", "2.5rem", "3rem", "1.5rem"].map((width, index) => (
        <div key={index}>
          <SkeletonText width={width} />
        </div>
      ))}
    </div>
  );
}

export function TimeStandardsSkeleton() {
  return (
    <section className={s.page} aria-label="Standards" aria-busy="true">
      <SkeletonStatus>Loading approved standards…</SkeletonStatus>
      <div
        className={`${s.skeletonContent} ${loadingStyles.pulse}`}
        data-loading-skeleton="standards"
        aria-hidden="true"
      >
        <div className={s.filterPanel}>
          <div
            className={`${s.mobileFilterSkeleton} ${selectionStyles.filterPanel}`}
          >
            {["Standard", "Course", "Gender", "Age group", "Tier"].map(
              (label) => (
                <div
                  key={label}
                  className={`${selectionStyles.dropdown} ${selectionStyles.skeletonFilter}`}
                >
                  <span className={selectionStyles.selectionLabel}>
                    {label}
                  </span>
                  <SkeletonText width="70%" height={13} />
                </div>
              ),
            )}
          </div>
          <div
            className={`${timesStyles.filters} ${s.filters} ${s.desktopFilterSkeleton}`}
          >
            <div className={s.topFilters}>
              <div className={timesStyles.field}>
                <span>Standard</span>
                <div className={s.skeletonInput}>
                  <SkeletonText width="82%" />
                </div>
              </div>
              {skeletonChoices.map(([label, count]) => (
                <div key={label} className={s.skeletonChoices}>
                  <span>{label}</span>
                  <div className={s.skeletonPills}>
                    {Array.from({ length: count }, (_, index) => (
                      <div key={index}>
                        <SkeletonText
                          width={label === "Course" ? "1.5rem" : "2rem"}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {["Age group", "Tier"].map((label) => (
              <div key={label} className={s.skeletonSlider}>
                <div>
                  <span>{label}</span>
                  <SkeletonText width="2.5rem" />
                </div>
                <div className={s.skeletonTrack}>
                  <SkeletonText width="100%" height="2px" />
                  <span />
                </div>
                <div className={s.skeletonStops}>
                  {Array.from({ length: 6 }, (_, index) => (
                    <SkeletonText key={index} width="1rem" height="0.65em" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className={s.grid}>
          {strokeColumns.map(([stroke, heading]) => (
            <div key={stroke} className={s.column}>
              <h2>{heading}</h2>
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className={`${s.chip} ${s.skeletonCard}`}>
                  <span className={s.distance}>
                    <SkeletonText width="3rem" />
                  </span>
                  <strong>
                    <SkeletonText width="3.5rem" />
                  </strong>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className={`${s.sourceButton} ${s.skeletonSource}`}>
          <SkeletonText width="7rem" />
        </div>
      </div>
    </section>
  );
}

function StandardPicker({
  sets,
  day,
  selected,
  onChange,
}: {
  sets: StandardSet[];
  day: string;
  selected: StandardSet;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const ordered = orderedStandards(sets, day);
  const active = ordered.filter(
    (set) => standardStatus(set, day) !== "Expired",
  );
  const expired = ordered.filter(
    (set) => standardStatus(set, day) === "Expired",
  );

  function options(items: StandardSet[]) {
    return items.map((set) => {
      const status = standardStatus(set, day);
      const recommended =
        status === "Current" &&
        set.governingBody === "USA_Swimming" &&
        set.category === "motivational" &&
        (!set.standardType || set.standardType === "age-group");
      return (
        <button
          key={set.id}
          type="button"
          className={recommended ? s.recommendedStandard : undefined}
          aria-label={set.name}
          aria-pressed={selected.id === set.id}
          onClick={() => {
            onChange(set.id);
            dialog.current?.close();
          }}
        >
          <strong>{set.name}</strong>
          {recommended && (
            <span className={s.standardStatus}>
              USA Swimming age group motivational
            </span>
          )}
        </button>
      );
    });
  }

  return (
    <div className={`${timesStyles.field} ${s.standardField}`}>
      <label htmlFor={id} className={s.standardLabel}>
        Standard
      </label>
      <button
        id={id}
        type="button"
        className={`${timesStyles.eventTrigger} ${s.standardTrigger}`}
        aria-haspopup="dialog"
        onClick={() => {
          dialog.current?.showModal();
          dialog.current
            ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
            ?.focus();
        }}
      >
        <span
          className={`${selectionStyles.selectionLabel} ${s.mobileStandardLabel}`}
          aria-hidden="true"
        >
          Standard
        </span>
        <span className={s.standardName}>
          {selected.name}
          <ChevronDown size={16} aria-hidden="true" />
        </span>
      </button>
      <dialog
        ref={dialog}
        className={s.standardDialog}
        aria-labelledby={`${id}-title`}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            dialog.current?.close();
        }}
      >
        <div className={s.standardDialogHeader}>
          <h2 id={`${id}-title`}>Standard</h2>
          <button
            type="button"
            className={timesStyles.button}
            aria-label="Close standard picker"
            onClick={() => dialog.current?.close()}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        {active.length > 0 && (
          <section
            className={s.standardSection}
            aria-label="Current and upcoming standards"
          >
            <h3>Current &amp; upcoming standards</h3>
            <div className={s.standardOptions}>{options(active)}</div>
          </section>
        )}
        {expired.length > 0 && (
          <section
            className={`${s.standardSection} ${s.expiredStandards}`}
            aria-label="Expired standards"
          >
            <h3>Expired standards</h3>
            <div className={s.standardOptions}>{options(expired)}</div>
          </section>
        )}
      </dialog>
    </div>
  );
}

export function TimeStandardsSummary({
  state,
}: {
  state: TimeStandardsSelection;
}) {
  if (!state.set || !state.filters) return null;
  const { course, age, gender, tier } = state.filters.selection;
  return (
    <FilterSummary
      label="Selected time standards filters"
      compact
      items={[
        ["Standard", state.set.name],
        ["Course", course],
        ["Age group", age],
        ["Gender", genderLabels[gender] ?? gender],
        ["Tier", tier],
      ]}
    />
  );
}

export default function TimeStandards({
  query,
  state,
}: {
  query: ReturnType<typeof useStandards>;
  state: TimeStandardsSelection;
}) {
  const { sets, loading, error, retry } = query;
  const { day, set, filters, setSelected, setSelection } = state;
  const eventKeys =
    set && filters ? standardEventKeys(set, filters.selection.course) : [];
  const sourceUrl =
    set?.sourceUrl && /^https?:\/\//.test(set.sourceUrl) ? set.sourceUrl : null;
  const rank =
    filters &&
    set?.governingBody === "USA_Swimming" &&
    set.category === "motivational"
      ? motivationalRankForTier(filters.selection.tier)
      : undefined;
  function updateFilter(key: keyof StandardSelection, value: string) {
    if (filters) setSelection({ ...filters.selection, [key]: value });
  }
  if (loading && !error && (!set || !filters)) return <TimeStandardsSkeleton />;
  return (
    <section className={s.page} aria-label="Standards" aria-busy={loading}>
      {loading && <SkeletonStatus>Updating approved standards…</SkeletonStatus>}
      {error && (
        <p role="alert">
          {error} <button onClick={retry}>Try again</button>
        </p>
      )}
      {!hasBackendConfiguration && (
        <p>Standards are unavailable while the database is disconnected.</p>
      )}
      {!loading && !error && hasBackendConfiguration && !set && (
        <p>No approved time standards yet.</p>
      )}
      {set && filters && (
        <>
          <section
            className={s.filterPanel}
            aria-label="Time standards filters"
          >
            <div>
              <div className={`${timesStyles.filters} ${s.filters}`}>
                <div className={s.topFilters}>
                  <StandardPicker
                    sets={sets}
                    day={day}
                    selected={set}
                    onChange={(value) => {
                      setSelected(value);
                      setSelection(filters.selection);
                    }}
                  />
                  <div className={s.desktopControls}>
                    <FilterChips
                      label="Course"
                      value={filters.selection.course}
                      onChange={(value) => updateFilter("course", value)}
                      options={filters.courses.map((course) => [
                        course,
                        course,
                      ])}
                    />
                    <FilterChips
                      label="Gender"
                      value={filters.selection.gender}
                      onChange={(value) => updateFilter("gender", value)}
                      options={filters.genders.map((gender) => [
                        gender,
                        genderLabels[gender] ?? gender,
                      ])}
                    />
                  </div>
                </div>
                <div className={s.mobileControls}>
                  {(
                    [
                      ["course", "Course", filters.courses],
                      ["gender", "Gender", filters.genders],
                      ["age", "Age group", filters.ages],
                      ["tier", "Tier", filters.tiers],
                    ] as const
                  ).map(([key, label, values]) => (
                    <SelectionDropdown
                      key={key}
                      label={label}
                      selection={
                        key === "gender"
                          ? (genderLabels[filters.selection[key]] ??
                            filters.selection[key])
                          : filters.selection[key]
                      }
                    >
                      {(close) =>
                        values.map((value) => (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={filters.selection[key] === value}
                            onClick={() => {
                              updateFilter(key, value);
                              close();
                            }}
                          >
                            {key === "gender"
                              ? (genderLabels[value] ?? value)
                              : value}
                          </button>
                        ))
                      }
                    </SelectionDropdown>
                  ))}
                </div>
                <div className={s.desktopControls}>
                  <DiscreteSlider
                    showStops
                    label="Age group"
                    value={filters.selection.age}
                    onChange={(value) => updateFilter("age", value)}
                    options={filters.ages.map((age) => [age, age])}
                  />
                  <DiscreteSlider
                    showStops
                    label="Tier"
                    value={filters.selection.tier}
                    onChange={(value) => updateFilter("tier", value)}
                    options={filters.tiers.map((tier) => [tier, tier])}
                    valueAdornment={
                      rank ? (
                        <MotivationalRankIcon tier={rank.tier} size={24} />
                      ) : undefined
                    }
                  />
                </div>
              </div>
            </div>
          </section>
          <div className={s.grid}>
            {strokeColumns.map(([stroke, heading, title]) => (
              <section key={stroke} className={s.column} aria-label={title}>
                <h2 title={title}>{heading}</h2>
                {eventKeys
                  .filter((key) => eventColumn(key) === stroke)
                  .map((key) => {
                    const [distance, code] = key.split("_");
                    const cardStroke =
                      code === "MED-R"
                        ? "IM Relay"
                        : code === "FR-R"
                          ? "Free Relay"
                          : stroke === "DST"
                            ? "Free"
                            : heading;
                    const eventName = key.includes("-R")
                      ? eventLabel(key)
                      : `${distance} ${title}`;
                    const cut = filters.events[key]?.cutsByTier.find(
                      (cut) => cut.tierName === filters.selection.tier,
                    );
                    const time = cut ? formatSwimTime(cut.timeMs) : null;
                    return (
                      <div
                        key={key}
                        className={s.chip}
                        aria-label={`${eventName}: ${time ?? "No published cut"}`}
                      >
                        <span className={s.distance}>
                          {distance} {cardStroke}
                        </span>
                        <strong>{time ?? "—"}</strong>
                      </div>
                    );
                  })}
              </section>
            ))}
          </div>
          {Object.keys(filters.events).length === 0 && (
            <p>No cuts are available for this selection.</p>
          )}
          {sourceUrl && (
            <a
              className={s.sourceButton}
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Official source
              <ArrowUpRight size={18} aria-hidden="true" />
            </a>
          )}
        </>
      )}
    </section>
  );
}
