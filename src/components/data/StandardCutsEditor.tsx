"use client";
import { useState } from "react";
import type { DataRecord } from "@/lib/results/types";
import {
  formatSwimTime,
  parseSwimTime,
} from "@/features/swim-resources/lib/domain/swim-time";
import s from "./DataManager.module.css";
type Cut = {
  course: string;
  gender: string;
  age: string;
  event: string;
  tier: string;
  time: string;
};
function flatten(cuts: DataRecord): Cut[] {
  const rows: Cut[] = [];
  for (const [course, genders] of Object.entries(cuts))
    for (const [gender, ages] of Object.entries(genders as DataRecord))
      for (const [age, events] of Object.entries(ages as DataRecord))
        for (const [event, data] of Object.entries(events as DataRecord))
          for (const cut of (
            data as { cutsByTier: { tierName: string; timeMs: number }[] }
          ).cutsByTier)
            rows.push({
              course,
              gender,
              age,
              event,
              tier: cut.tierName,
              time: formatSwimTime(cut.timeMs),
            });
  return rows;
}
export function cutsFromRows(rows: Cut[]): DataRecord {
  const cuts: Record<
    string,
    Record<
      string,
      Record<
        string,
        Record<
          string,
          {
            cutsByTier: {
              tierName: string;
              timeMs: number;
              timeDisplay: string;
            }[];
          }
        >
      >
    >
  > = {};
  for (const row of rows) {
    const timeMs = parseSwimTime(row.time);
    if (!timeMs || !row.age.trim() || !row.tier.trim() || !row.event.trim())
      throw new Error("Complete every standard cut or remove its row.");
    (((cuts[row.course] ??= {})[row.gender] ??= {})[row.age] ??= {})[
      row.event
    ] ??= { cutsByTier: [] };
    cuts[row.course][row.gender][row.age][row.event].cutsByTier.push({
      tierName: row.tier,
      timeMs,
      timeDisplay: formatSwimTime(timeMs),
    });
  }
  return cuts;
}
export default function StandardCutsEditor({
  cuts,
  onChange,
  disabled,
}: {
  disabled?: boolean;
  cuts: DataRecord;
  onChange: (cuts: DataRecord | null, error?: string) => void;
}) {
  const [rows, setRows] = useState(() => flatten(cuts)),
    [page, setPage] = useState(0);
  function update(next: Cut[]) {
    setRows(next);
    try {
      onChange(cutsFromRows(next));
    } catch (e) {
      onChange(null, (e as Error).message);
    }
  }
  function field(i: number, key: keyof Cut, value: string) {
    update(
      rows.map((row, index) => (index === i ? { ...row, [key]: value } : row)),
    );
  }
  return (
    <fieldset disabled={disabled}>
      <legend>Time standard cuts</legend>
      <p>{rows.length.toLocaleString()} cuts</p>
      <div className={s.scroll}>
        <table>
          <thead>
            <tr>
              {[
                "Course",
                "Category",
                "Age group",
                "Event",
                "Tier",
                "Time",
                "",
              ].map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(page * 30, page * 30 + 30).map((row, n) => {
              const index = page * 30 + n;
              return (
                <tr key={index}>
                  <td>
                    <select
                      aria-label={`Cut ${index + 1} course`}
                      value={row.course}
                      onChange={(e) => field(index, "course", e.target.value)}
                    >
                      {["SCY", "SCM", "LCM"].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label={`Cut ${index + 1} category`}
                      value={row.gender}
                      onChange={(e) => field(index, "gender", e.target.value)}
                    >
                      {["F", "M", "Mixed"].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  {(["age", "event", "tier", "time"] as const).map((key) => (
                    <td key={key}>
                      <input
                        aria-label={`Cut ${index + 1} ${key}`}
                        value={row[key]}
                        placeholder={key === "event" ? "100_FR_SCY" : ""}
                        onChange={(e) => field(index, key, e.target.value)}
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      type="button"
                      onClick={() => {
                        update(rows.filter((_, i) => i !== index));
                        setPage((p) =>
                          Math.min(
                            p,
                            Math.max(0, Math.ceil((rows.length - 1) / 30) - 1),
                          ),
                        );
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={s.actions}>
        <button
          type="button"
          disabled={!page}
          onClick={() => setPage(page - 1)}
        >
          Previous cuts
        </button>
        <button
          type="button"
          disabled={(page + 1) * 30 >= rows.length}
          onClick={() => setPage(page + 1)}
        >
          Next cuts
        </button>
        <button
          type="button"
          onClick={() => {
            update([
              ...rows,
              {
                course: "SCY",
                gender: "F",
                age: "Open",
                event: "",
                tier: "",
                time: "",
              },
            ]);
            setPage(Math.floor(rows.length / 30));
          }}
        >
          Add cut
        </button>
      </div>
    </fieldset>
  );
}
