"use client";
import { useEffect, useState } from "react";
import type { ManagedRecord, RecordKind } from "@/lib/results/types";
import { label, requestData } from "./data-api";
import s from "./DataManager.module.css";
export default function RecordPicker({
  kind,
  title,
  value,
  display,
  onSelect,
}: {
  kind: RecordKind;
  title: string;
  value: string;
  display?: string;
  onSelect: (record: ManagedRecord) => void;
}) {
  const [query, setQuery] = useState(""),
    [options, setOptions] = useState<ManagedRecord[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      requestData(
        `/api/times/manage?kind=${kind}&search=${encodeURIComponent(query)}`,
        undefined,
        controller.signal,
      )
        .then((result) => {
          setOptions(result.rows);
          setError("");
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [kind, query]);
  const selected = options.find((r) => r.id === value);
  return (
    <fieldset className={s.picker}>
      <legend>{title}</legend>
      {value && (
        <p className={s.selected}>
          Selected: {display || (selected ? label(kind, selected.data) : value)}
        </p>
      )}
      <input
        aria-label={`Search ${title.toLowerCase()}`}
        placeholder={`Search ${title.toLowerCase()}`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <select
        aria-label={`Choose ${title.toLowerCase()}`}
        value={options.some((r) => r.id === value) ? value : ""}
        onChange={(e) => {
          const record = options.find((r) => r.id === e.target.value);
          if (record) onSelect(record);
        }}
      >
        <option value="">Choose {title.toLowerCase()}</option>
        {options.map((record) => (
          <option key={record.id} value={record.id}>
            {label(kind, record.data)}
          </option>
        ))}
      </select>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
