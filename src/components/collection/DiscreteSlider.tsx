"use client";

import { useId, type CSSProperties, type ReactNode } from "react";
import s from "./DiscreteSlider.module.css";

export default function DiscreteSlider({
  label,
  value,
  options,
  onChange,
  valueAdornment,
  showStops = false,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
  valueAdornment?: ReactNode;
  showStops?: boolean;
}) {
  const id = useId();
  const index = Math.max(
    0,
    options.findIndex(([key]) => key === value),
  );
  const selected = options[index];
  const fixed = options.length < 2;
  const hasStops = showStops && !fixed;
  return (
    <div className={s.field}>
      <div className={s.heading}>
        <label htmlFor={id}>{label}</label>
        <span className={s.value}>
          {valueAdornment}
          <output htmlFor={id}>{selected?.[1] ?? "Unavailable"}</output>
        </span>
      </div>
      <div
        className={hasStops ? s.markedRange : undefined}
        style={
          hasStops
            ? ({ "--stop-intervals": options.length - 1 } as CSSProperties)
            : undefined
        }
      >
        {hasStops && (
          <div className={s.track} aria-hidden="true">
            {options.map(([key, text], i) => (
              <span
                className={s.stop}
                key={key}
                style={{ "--stop-index": i } as CSSProperties}
              >
                <span className={s.stopLabel}>{text}</span>
              </span>
            ))}
          </div>
        )}
        <input
          id={id}
          type="range"
          min={0}
          max={Math.max(0, options.length - 1)}
          step={1}
          value={index}
          aria-valuetext={selected?.[1] ?? "Unavailable"}
          disabled={fixed}
          onChange={(event) => {
            const next = options[Number(event.target.value)];
            if (next) onChange(next[0]);
          }}
        />
      </div>
      {!showStops && !fixed && (
        <div className={s.scale} aria-hidden="true">
          <span>{options[0][1]}</span>
          <span>{options[options.length - 1][1]}</span>
        </div>
      )}
    </div>
  );
}
