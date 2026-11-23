import { useId } from "react";
import s from "./GemFamilyChart.module.css";

const families = [
  ["IM", "IM"],
  ["FL", "Fly"],
  ["BK", "Back"],
  ["BR", "Breast"],
  ["FR", "Free"],
  ["DST", "Distance"],
] as const;

const number = (value: number) => value.toLocaleString("en-US");

function point(index: number, radius: number) {
  const angle = (index * Math.PI) / 3 - Math.PI / 2;
  return {
    x: 200 + Math.cos(angle) * radius,
    y: 165 + Math.sin(angle) * radius,
  };
}

function polygon(radii: number[]) {
  return radii
    .map((radius, index) => {
      const { x, y } = point(index, radius);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

/** A shared count scale keeps the six event families directly comparable. */
export function GemFamilyChart({
  counts,
  label = "Gems by event family",
}: {
  counts: Record<string, number>;
  label?: string;
}) {
  const id = useId();
  const values = families.map(([key]) => {
    const count = counts[key] ?? 0;
    return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  });
  const total = values.reduce((sum, value) => sum + value, 0);
  const highest = Math.max(1, ...values);
  const ringCount = Math.min(4, highest);
  const step = Math.ceil(highest / ringCount);
  const maximum = step * ringCount;
  const description = families
    .map(
      ([, name], index) =>
        `${name}: ${number(values[index])} ${values[index] === 1 ? "gem" : "gems"}`,
    )
    .join("; ");

  return (
    <div className={s.container}>
      <figure className={s.chart} data-gem-family-chart="">
        <svg
          className={s.hexagon}
          viewBox="0 0 400 330"
          role="img"
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-description`}
        >
          <title id={`${id}-title`}>{label}</title>
          <desc id={`${id}-description`}>
            {description}. Every axis uses the same scale, from zero at the
            center to {number(maximum)} {maximum === 1 ? "gem" : "gems"} at the
            outer ring.
          </desc>
          <g aria-hidden="true">
            {Array.from({ length: ringCount }, (_, index) => (
              <polygon
                key={index}
                className={s.ring}
                points={polygon(
                  families.map(() => (104 * (index + 1)) / ringCount),
                )}
              />
            ))}
            {families.map(([key], index) => {
              const end = point(index, 104);
              return (
                <line
                  key={key}
                  className={s.axis}
                  x1="200"
                  y1="165"
                  x2={end.x}
                  y2={end.y}
                />
              );
            })}
            <polygon
              className={s.area}
              points={polygon(values.map((value) => (104 * value) / maximum))}
            />
            {families.map(([key, name], index) => {
              const vertex = point(index, (104 * values[index]) / maximum);
              const text = point(index, 143);
              return (
                <g key={key}>
                  <circle
                    className={s.vertex}
                    cx={vertex.x}
                    cy={vertex.y}
                    r="3.5"
                  />
                  <text
                    className={s.label}
                    x={text.x}
                    y={text.y - 5}
                    textAnchor="middle"
                    data-gem-family={key}
                  >
                    <tspan x={text.x}>{name}</tspan>
                    <tspan className={s.count} x={text.x} dy="19">
                      {number(values[index])}
                    </tspan>
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
        <figcaption className={s.summary}>
          <span className={s.total}>
            <strong>{number(total)}</strong>
            <span>{total === 1 ? "gem" : "gems"}</span>
          </span>
          <p>
            {total
              ? "Each point shows the gems earned in that event family."
              : "No gems in this selection yet."}
          </p>
          <span className={s.scale}>
            {number(maximum)} {maximum === 1 ? "gem" : "gems"} at the outer ring
            <br />
            {number(step)} {step === 1 ? "gem" : "gems"} per ring
          </span>
          <p className={s.note}>Distance includes freestyle events over 200.</p>
        </figcaption>
      </figure>
    </div>
  );
}
