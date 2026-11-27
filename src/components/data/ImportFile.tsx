"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ImportOutcome, ParsedFile } from "@/lib/results/types";
import { holdUpdates } from "@/lib/update-safety";
import { clearTimesCache } from "@/components/collection/times-cache";
import RecordPicker from "./RecordPicker";
import { requestData } from "./data-api";
import {
  useDataNavigation,
  type DataNavigationState,
} from "./use-data-navigation";
import s from "./DataManager.module.css";
export default function ImportFile({
  onNavigationChange,
}: {
  onNavigationChange?: (state: DataNavigationState) => void;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [outcomes, setOutcomes] = useState<ImportOutcome[]>([]),
    [meet, setMeet] = useState({ id: "", name: "" }),
    [includeHistoricalCuda, setIncludeHistoricalCuda] = useState(false);
  const worker = useRef<Worker | null>(null),
    fileInput = useRef<HTMLInputElement>(null),
    [page, setPage] = useState(0),
    [showAll, setShowAll] = useState(false);
  const router = useRouter();
  const controller = useRef<AbortController | null>(null),
    rejectReader = useRef<((error: Error) => void) | null>(null);
  useDataNavigation({ dirty: false, busy }, onNavigationChange);
  useEffect(
    () => () => {
      worker.current?.terminate();
      rejectReader.current?.(new Error("Import interrupted."));
      controller.current?.abort();
    },
    [],
  );
  async function upload() {
    const files = Array.from(fileInput.current?.files ?? []);
    if (!files.length) return;
    setBusy(true);
    setError("");
    setOutcomes([]);
    setPage(0);
    setMessage("Reading result files…");
    const release = holdUpdates();
    controller.current = new AbortController();
    try {
      if (
        files.length > 20 ||
        files.reduce((n, f) => n + f.size, 0) > 20 * 1024 * 1024
      )
        throw new Error("Choose up to 20 files totaling no more than 20 MB.");
      const loaded = await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          bytes: new Uint8Array(await f.arrayBuffer()),
        })),
      );
      const parsed = await new Promise<ParsedFile>((resolve, reject) => {
        rejectReader.current = reject;
        const w = new Worker(
          new URL("../../lib/results/import.worker.ts", import.meta.url),
        );
        worker.current = w;
        w.onmessage = (event) => {
          w.terminate();
          worker.current = null;
          rejectReader.current = null;
          if (event.data.error) reject(new Error(event.data.error));
          else resolve(event.data.result);
        };
        w.onerror = () => {
          w.terminate();
          worker.current = null;
          rejectReader.current = null;
          reject(
            new Error(
              "The file reader stopped. Re-select your files and retry.",
            ),
          );
        };
        w.postMessage(
          loaded,
          loaded.map((f) => f.bytes.buffer),
        );
      });
      const all = [...parsed.issues];
      setOutcomes(all);
      // Keep each transaction within one event's ranking cohort. Source line
      // numbers remain unchanged, and stable sorting retains occurrence order.
      const eventKey = (r: ParsedFile["rows"][number]) =>
        `${r.kind}|${r.course}|${r.distance}|${r.stroke}`;
      parsed.rows.sort((a, b) => eventKey(a).localeCompare(eventKey(b)));
      for (let offset = 0; offset < parsed.rows.length;) {
        let end = offset + 1;
        while (
          end < parsed.rows.length &&
          end - offset < 50 &&
          eventKey(parsed.rows[end]) === eventKey(parsed.rows[offset])
        )
          end++;
        setMessage(
          `Saving results ${offset + 1}–${end} of ${parsed.rows.length.toLocaleString()}…`,
        );
        const result = await requestData(
          "/api/times/import",
          {
            rows: parsed.rows.slice(offset, end),
            meetId: meet.id || undefined,
            includeHistoricalCuda,
          },
          controller.current.signal,
        );
        all.push(...result.outcomes);
        setOutcomes([...all]);
        offset = end;
      }
      setMessage(
        parsed.rows.length
          ? "Import complete. Correct any reported issues and re-upload; recorded results will be skipped."
          : "No result rows found. Check that these are result exports, not entries.",
      );
      clearTimesCache();
      router.refresh();
    } catch (e) {
      setError(
        `${(e as Error).message} Any completed batches remain saved. Re-uploading safely checks for duplicates.`,
      );
      setMessage("Import stopped.");
    } finally {
      release();
      setBusy(false);
    }
  }
  const failures = showAll
    ? outcomes
    : outcomes.filter((r) => r.status !== "saved" && r.status !== "duplicate");
  return (
    <section className={s.editor}>
      <h2>Import meet results</h2>
      <p>
        Choose HY3, CL2, SD3, or ZIP files. Valid Velocity results are saved
        immediately. Supply paired HY3 and CL2 files together to cross-check
        their details.
      </p>
      <fieldset disabled={busy}>
        <legend>Meet files</legend>
        <label>
          Result files
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".hy3,.cl2,.sd3,.zip"
          />
        </label>
        <p className={s.muted}>
          Up to 20 files, 20 MB total. New swimmers need a stable source ID and
          complete identity details.
        </p>
        <details>
          <summary>Use an existing meet</summary>
          <RecordPicker
            kind="meet"
            title="Meet"
            value={meet.id}
            display={meet.name}
            onSelect={(r) => setMeet({ id: r.id, name: String(r.data.name) })}
          />
          {meet.id && (
            <button type="button" onClick={() => setMeet({ id: "", name: "" })}>
              Use file meet headers
            </button>
          )}
        </details>
        <label className={s.check}>
          <input
            type="checkbox"
            checked={includeHistoricalCuda}
            onChange={(e) => setIncludeHistoricalCuda(e.target.checked)}
          />
          Include IE-CUDA results verified as Velocity’s historical program
        </label>
        <button className={s.primary} type="button" onClick={upload}>
          {busy ? "Importing…" : "Import files"}
        </button>
      </fieldset>
      <p role="status">{message}</p>
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {outcomes.length > 0 && (
        <>
          <div className={s.stats}>
            {["saved", "duplicate", "skipped", "error"].map((status) => (
              <div key={status}>
                <strong>
                  {outcomes
                    .filter((o) => o.status === status)
                    .length.toLocaleString()}
                </strong>
                <span>
                  {status === "error"
                    ? "Needs correction"
                    : status === "duplicate"
                      ? "Already recorded"
                      : status}
                </span>
              </div>
            ))}
          </div>
          <label>
            Show rows
            <select
              aria-label="Show rows"
              value={showAll ? "all" : "issues"}
              onChange={(e) => {
                setShowAll(e.target.value === "all");
                setPage(0);
              }}
            >
              <option value="issues">Needs attention</option>
              <option value="all">All rows, including duplicates</option>
            </select>
          </label>
          {failures.length > 0 && (
            <div className={s.scroll}>
              <table>
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Line</th>
                    <th>Result</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {failures.slice(page * 50, page * 50 + 50).map((r, i) => (
                    <tr key={i}>
                      <td>{r.filename}</td>
                      <td>{r.line}</td>
                      <td>{r.status}</td>
                      <td>{r.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {failures.length > 50 && (
            <div className={s.actions}>
              <button disabled={!page} onClick={() => setPage(page - 1)}>
                Previous issues
              </button>
              <button
                disabled={(page + 1) * 50 >= failures.length}
                onClick={() => setPage(page + 1)}
              >
                Next issues
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
