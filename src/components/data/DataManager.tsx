"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { ManagedRecord, RecordKind } from "@/lib/results/types";
import { formatSwimTime } from "@/features/swim-resources/lib/domain/swim-time";
import { blankRecord, label, requestData } from "./data-api";
import RecordEditor from "./RecordEditor";
import ImportFile from "./ImportFile";
import FlaggedResults from "@/components/collection/FlaggedResults";
import s from "./DataManager.module.css";
const sections = [
  ["results", "Results"],
  ["athletes", "Swimmers"],
  ["meets", "Meets"],
  ["standards", "Standards"],
  ["import", "Import File"],
] as const;
export default function DataManager() {
  const params = useSearchParams(),
    router = useRouter();
  const section = sections.some(([id]) => id === params.get("view"))
    ? params.get("view")!
    : "results";
  const [resultKind, setResultKind] = useState<RecordKind>("swim");
  const [navigation, setNavigation] = useState(0);
  const kind: RecordKind =
    section === "athletes"
      ? "athlete"
      : section === "meets"
        ? "meet"
        : section === "standards"
          ? "standard"
          : resultKind;
  return (
    <main className={s.page}>
      <header className={s.header}>
        <div>
          <p className={s.eyebrow}>Velocity Swimming</p>
          <h1>Data</h1>
          <p>Manage results, swimmers, meets, and time standards.</p>
        </div>
      </header>
      <nav aria-label="Data sections" className={s.tabs}>
        {sections.map(([id, title]) => (
          <button
            key={id}
            type="button"
            aria-current={section === id ? "page" : undefined}
            onClick={() => {
              setNavigation((value) => value + 1);
              router.replace(`/tools/data?view=${id}`);
            }}
          >
            {title}
          </button>
        ))}
      </nav>
      {section === "import" ? (
        <ImportFile />
      ) : (
        <RecordBrowser
          key={`${section}:${kind}:${navigation}`}
          kind={kind}
          section={section}
          onKindChange={setResultKind}
        />
      )}
    </main>
  );
}

// A record kind owns its rows, draft, and pending requests. Changing sections
// remounts this browser, so an old response cannot become a different record form.
function RecordBrowser({
  kind,
  section,
  onKindChange,
}: {
  kind: RecordKind;
  section: string;
  onKindChange: (kind: RecordKind) => void;
}) {
  const [rows, setRows] = useState<ManagedRecord[]>([]),
    [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<ManagedRecord | null>(null),
    [revision, setRevision] = useState(0),
    [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      requestData(
        `/api/times/manage?kind=${kind}&search=${encodeURIComponent(query)}&offset=${offset}`,
        undefined,
        controller.signal,
      )
        .then((r) => {
          if (controller.signal.aborted) return;
          setRows(r.rows);
          setMore(r.hasMore);
          setError("");
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [kind, query, offset, revision]);
  const selectionRequest = useRef<AbortController | null>(null);
  useEffect(() => () => selectionRequest.current?.abort(), []);
  function cancelSelection() {
    selectionRequest.current?.abort();
    selectionRequest.current = null;
  }
  async function edit(id: string) {
    cancelSelection();
    const controller = new AbortController();
    selectionRequest.current = controller;
    setError("");
    try {
      const record: ManagedRecord = await requestData(
        `/api/times/manage?kind=${kind}&id=${encodeURIComponent(id)}`,
        undefined,
        controller.signal,
      );
      if (!controller.signal.aborted) setSelected(record);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof Error ? error.message : "Unable to load record.",
        );
    } finally {
      if (selectionRequest.current === controller)
        selectionRequest.current = null;
    }
  }
  return (
    <>
      {selected ? (
        <RecordEditor
          key={`${kind}:${selected.id}:${selected.version}`}
          kind={kind}
          record={selected}
          onCancel={() => {
            setSelected(null);
            setRevision((r) => r + 1);
          }}
          onSaved={() => {
            setSelected(null);
            setRevision((r) => r + 1);
            setMessage("Changes saved.");
          }}
        />
      ) : (
        <>
          {section === "results" && (
            <details>
              <summary>Flagged and restored results</summary>
              <FlaggedResults />
            </details>
          )}
          <div className={s.toolbar}>
            {section === "results" && (
              <label>
                Result type
                <select
                  value={kind}
                  onChange={(e) => {
                    cancelSelection();
                    onKindChange(e.target.value as RecordKind);
                  }}
                >
                  <option value="swim">Individual results</option>
                  <option value="relay">Relays</option>
                </select>
              </label>
            )}
            <label className={s.search}>
              Search
              <input
                type="search"
                placeholder={
                  section === "results" ? "Swimmer or meet name" : "Name"
                }
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setOffset(0);
                }}
              />
            </label>
            <button
              className={s.primary}
              onClick={() => {
                cancelSelection();
                setSelected(blankRecord(kind));
              }}
            >
              Add{" "}
              {kind === "athlete"
                ? "swimmer"
                : kind === "swim"
                  ? "result"
                  : kind}
            </button>
          </div>
          {message && <p role="status">{message}</p>}
          {error && (
            <p role="alert" className={s.error}>
              {error}
            </p>
          )}
          <div className={s.scroll} aria-busy={busy}>
            <table>
              <thead>
                <tr>
                  <th>
                    {kind === "swim" || kind === "relay" ? "Result" : "Name"}
                  </th>
                  <th>Details</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {!rows.length && (
                  <tr>
                    <td colSpan={3}>
                      {busy ? "Loading…" : "No records found."}
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{label(kind, r.data)}</strong>
                    </td>
                    <td>
                      {kind === "swim" || kind === "relay" ? (
                        <>
                          {r.data.status === "OK"
                            ? formatSwimTime(Number(r.data.timeMs))
                            : String(r.data.status)}{" "}
                          ·{" "}
                          {String(
                            (r.data.meet as { date?: string })?.date ?? "",
                          )}
                          <br />
                          <span className={s.muted}>
                            {String(
                              (r.data.meet as { name?: string })?.name ?? "",
                            )}
                          </span>
                        </>
                      ) : kind === "athlete" ? (
                        String(r.data.status ?? "")
                      ) : kind === "standard" ? (
                        String(r.data.seasonYears ?? "")
                      ) : (
                        String(
                          r.data.startsOn ??
                            (r.data.dates as { startDate?: string })
                              ?.startDate ??
                            "",
                        )
                      )}
                    </td>
                    <td>
                      <button onClick={() => void edit(r.id)}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={s.actions}>
            <button
              disabled={!offset || busy}
              onClick={() => setOffset(offset - 50)}
            >
              Previous
            </button>
            <span>
              {rows.length ? `${offset + 1}–${offset + rows.length}` : "0"}{" "}
              records
            </span>
            <button
              disabled={!more || busy}
              onClick={() => setOffset(offset + 50)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </>
  );
}
