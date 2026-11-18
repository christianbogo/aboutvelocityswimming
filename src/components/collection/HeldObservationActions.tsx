"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { InventoryField, InventoryTable } from "./ImportsInventory";
import table from "./ImportsInventory.module.css";
import styles from "./HeldObservations.module.css";
import { eventLabel, rounds } from "./times-data";
import { formatSwimTime, parseSwimTime } from "@/features/swim-resources/lib/domain/swim-time";
import {
  heldFacts, heldObservationLabel, heldObservationStatuses, heldText,
  type HeldAthlete, type HeldChecked, type HeldDecision, type HeldDetail, type HeldFacts,
  type HeldObservation, type HeldReceipt, type HeldSwimmerApproval,
} from "@/lib/collection/held-observations";
import type { Json } from "@/lib/supabase/database.types";

const endpoint = "/api/collection/held-observations";
const clubLabels: Record<string, string> = { CUDA: "Barracuda", VS: "Velocity" };
const statusKeys = ["ready", "published", "pending", "held", "outcome"] as const;

function message(error: unknown) {
  return error instanceof Error ? error.message : "The review could not be confirmed. Try again.";
}

class HeldRequestError extends Error {
  constructor(message: string, readonly retrySmaller: boolean) {
    super(message);
  }
}

async function request<T>(input: Json) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new HeldRequestError(data.error ?? "The review could not be confirmed. Try again.", data.retrySmaller === true);
  }
  return data as T;
}

function value(data: FormData, field: string) {
  return String(data.get(field) ?? "").trim();
}

function time(value: Json | undefined) {
  return typeof value === "number" && value > 0 ? formatSwimTime(value) : "";
}

function numberValue(value: Json | undefined) {
  return typeof value === "number" ? String(value) : "";
}

export function HeldClub({ code }: { code: string }) {
  const club = clubLabels[code.replace(/^IE-/, "")];
  return club ? <span title={code}>{club}</span> : code;
}

function Receipt({ receipt }: { receipt: HeldReceipt }) {
  return (
    <div className={styles.receipt}>
      <p role="status">
        {receipt.staged.toLocaleString()} sent for review · {receipt.duplicates.toLocaleString()} already recorded · {receipt.blocked.toLocaleString()} still held
      </p>
      <div className={styles.toolbar}>
        {receipt.batchIds.map((id, index) =>
          <Link key={id} href={`/tools/review?batchId=${encodeURIComponent(id)}`}>Review staged results{receipt.batchIds.length > 1 ? ` ${index + 1}` : ""}</Link>)}
        {receipt.correctionBatchIds.map((id, index) =>
          <Link key={id} href={`/tools/review/batches?batchId=${encodeURIComponent(id)}`}>Review corrections{receipt.correctionBatchIds.length > 1 ? ` ${index + 1}` : ""}</Link>)}
      </div>
    </div>
  );
}

function SubmitReady({ ids, onSubmitted, show }: { ids: string[]; onSubmitted?: () => void; show: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<HeldReceipt>();
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      setReceipt(await request<HeldReceipt>({ action: "submit", ids }));
      onSubmitted?.();
      router.refresh();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {show && <div className={styles.toolbar}>
        <button type="button" className={styles.primary} disabled={busy || !ids.length} onClick={() => void submit()}>
          {busy ? "Sending for review…" : "Send for review"}
        </button>
        <span>{ids.length.toLocaleString()} selected</span>
      </div>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {receipt && <Receipt receipt={receipt} />}
    </>
  );
}

export function HeldResults({ rows, details }: { rows: HeldObservation[]; details: Record<string, string> }) {
  const [selected, setSelected] = useState<string[]>([]);
  const ready = rows.filter(({ status }) => status === "ready").map(({ id }) => id);
  const ids = selected.filter((id) => ready.includes(id));
  const allSelected = ready.length > 0 && ids.length === ready.length;

  return (
    <div className={styles.actions}>
      <SubmitReady ids={ids} show={ready.length > 0} onSubmitted={() => setSelected([])} />
      <InventoryTable label="Held source observations" tableClassName={styles.list}
        columns={["Swimmer or relay", "Meet", "Race day", "Event", "Time", "Source club", "Review"]}
        empty={rows.length ? undefined : "No observations match these filters."}
        firstColumnControl={ready.length > 0 && <input className={styles.pageCheckbox} type="checkbox" aria-label="Select all ready observations on this page"
          checked={allSelected} onChange={(event) => setSelected(event.currentTarget.checked ? ready : [])} />}>
        {rows.map((row) => {
          const label = heldObservationLabel(row);
          const meet = heldText(row.observed.meetName) || row.sourceMeetId;
          const event = heldText(row.observed.eventCode);
          const round = rounds[row.round] ?? row.round;
          const sourceTime = time(row.observed.timeMs) || row.sourceStatus || "—";
          return (
            <tr key={row.id}>
              <th scope="row">
                <div className={styles.rowLabel}>
                  {row.status === "ready" && <input type="checkbox" aria-label={`Select ${label}, source row ${row.sourceRow}`}
                    checked={ids.includes(row.id)} onChange={(event) => setSelected(event.currentTarget.checked
                      ? [...ids, row.id] : ids.filter((id) => id !== row.id))} />}
                  <Link href={details[row.id]} className={table.cellText} title={label} aria-label={`Review ${label}`} prefetch={false}>{label}</Link>
                </div>
              </th>
              <td><span className={table.cellText} title={meet}>{meet}</span></td>
              <td>{heldText(row.observed.raceDate) || "—"}</td>
              <td>{event ? eventLabel(event) : "—"}{round && row.round !== "none" && <span className={styles.secondary}>{round}</span>}</td>
              <td className={table.numeric}>{sourceTime}</td>
              <td><HeldClub code={row.clubCode} /></td>
              <td className={styles.holdCell}>
                <strong>{heldObservationStatuses[row.status]}</strong>
                {row.status === "held" && <span className={styles.secondary}>{row.blocker ?? row.holdReason}</span>}
              </td>
            </tr>
          );
        })}
      </InventoryTable>
    </div>
  );
}

function RecordSearch({ kind, initialId }: { kind: "athletes" | "meets"; initialId?: string }) {
  const [recordId, setRecordId] = useState(initialId ?? "");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Array<Partial<HeldAthlete> & { id: string; label: string; startsOn?: string }>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const athlete = kind === "athletes";
  const label = athlete ? "swimmer profile" : "published meet";

  async function find() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${endpoint}?${new URLSearchParams({ [kind]: search.trim() })}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Search failed. Try again.");
      setResults(body.rows);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.athletes}>
      <div className={styles.toolbar}>
        <InventoryField label={`Find a ${label}`}>
          <input type="search" value={search} maxLength={150} onChange={(event) => setSearch(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (!busy && search.trim()) void find();
              }
            }} />
        </InventoryField>
        <button type="button" disabled={busy || !search.trim()} onClick={() => void find()}>{busy ? "Searching…" : athlete ? "Search swimmers" : "Search meets"}</button>
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {results && (results.length ? (
        <div className={styles.suggestions} role="group" aria-label={`Matching ${label}s`}>
          {results.map((candidate) =>
            <button key={candidate.id} type="button" aria-pressed={recordId === candidate.id}
              onClick={() => setRecordId(candidate.id)}>
              {[candidate.label, candidate.category ?? candidate.startsOn].filter(Boolean).join(" · ")}<code>{candidate.id}</code>
            </button>)}
        </div>
      ) : <p>No matching {label}s.</p>)}
      <InventoryField label={athlete ? "Selected swimmer ID" : "Selected meet ID"}>
        <input name={athlete ? "athleteId" : "meetId"} value={recordId} onChange={(event) => setRecordId(event.currentTarget.value)}
          pattern="[A-Za-z0-9_\-]{1,180}" maxLength={180} />
      </InventoryField>
    </div>
  );
}

type DecisionSpec = {
  fields: (fields: FormData) => HeldFacts;
  tools?: ReactNode;
};

type Run = {
  decisionId: string;
  affected: number;
  afterId: string | null;
  totals: Omit<HeldChecked, "hasNext" | "afterId">;
};

function savedRun(decisionId: string, affected: number): Run {
  return { decisionId, affected, afterId: null, totals: { checked: 0, ready: 0, published: 0, pending: 0, held: 0, outcome: 0 } };
}

async function validateRun(initial: Run, onProgress: (run: Run) => void) {
  let progress = initial;
  while (true) {
    const page = await request<HeldChecked>({
      action: "revalidate", decisionId: progress.decisionId, afterId: progress.afterId,
    });
    const totals = { ...progress.totals };
    totals.checked += page.checked;
    for (const status of statusKeys) totals[status] += page[status];
    if (page.hasNext && (!page.afterId || page.afterId === progress.afterId)) {
      throw new Error("Validation stopped before the end of this group. Resume to try again.");
    }
    progress = { ...progress, afterId: page.afterId, totals };
    onProgress(progress);
    if (!page.hasNext) return;
  }
}

function ValidationProgress({ run, complete }: { run: Run; complete: boolean }) {
  return <p role="status">
    {run.totals.checked.toLocaleString()}{run.affected > 0 ? ` of ${run.affected.toLocaleString()}` : ""} checked
    {complete && statusKeys.map((status) => ` · ${run.totals[status].toLocaleString()} ${heldObservationStatuses[status].toLowerCase()}`).join("")}
  </p>;
}

export function RecheckDecision({ decision }: { decision: HeldDecision }) {
  const router = useRouter();
  const [run, setRun] = useState<Run>();
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");
  async function recheck() {
    setBusy(true);
    setComplete(false);
    setError("");
    try {
      const checkpoint = run && !complete ? run : savedRun(decision.id, decision.affected ?? 0);
      setRun(checkpoint);
      await validateRun(checkpoint, setRun);
      setComplete(true);
      router.refresh();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }
  return <div className={styles.actions}>
    <div className={styles.toolbar}>
      <button type="button" disabled={busy} onClick={() => void recheck()}>{busy ? "Checking…" : error && run ? "Resume validation" : "Recheck observations"}</button>
    </div>
    {run && <ValidationProgress run={run} complete={complete} />}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </div>;
}

function DecisionForm({ id, scope, spec, button }: {
  id: string;
  scope: "row" | "source";
  spec: DecisionSpec;
  button: string;
}) {
  const router = useRouter();
  const pending = useRef<{ key: string; requestId: string } | null>(null);
  const [run, setRun] = useState<Run>();
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");

  async function validate(initial: Run) {
    setRun(initial);
    await validateRun(initial, setRun);
    setComplete(true);
    pending.current = null;
    router.refresh();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (run && !complete) {
        await validate(run);
        return;
      }
      const body = { action: "decision", id, scope, ...spec.fields(form) };
      const key = JSON.stringify(body);
      if (!pending.current || pending.current.key !== key) pending.current = { key, requestId: crypto.randomUUID() };
      const result = await request<{ decisionId: string; affected: number }>({ ...body, requestId: pending.current.requestId });
      setComplete(false);
      await validate(savedRun(result.decisionId, result.affected));
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  const resume = Boolean(run && !complete && !busy);
  return (
    <form onSubmit={(event) => void submit(event)} className={styles.form}>
      <fieldset className={styles.formFields} disabled={busy || resume}>
        {spec.tools}
      </fieldset>
      <div className={styles.toolbar}>
        <button type="submit" className={styles.primary} disabled={busy} formNoValidate={resume}>
          {busy ? "Checking affected observations…" : resume ? "Resume validation" : button}
        </button>
      </div>
      {run && <ValidationProgress run={run} complete={complete} />}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </form>
  );
}

function SourceScope({ detail, facts }: { detail: HeldDetail; facts: HeldFacts }) {
  const event = heldText(detail.observed.eventCode);
  const round = detail.round;
  const meet = heldFacts(facts.meet);
  return (
    <DecisionForm id={detail.id} scope="source" button="Save export review and validate" spec={{
      tools: <>
        <p>Confirm that this workbook reliably reports competitive results in the scope below.</p>
        {event && <label className={styles.check}><input type="checkbox" name="event" defaultChecked /> Only {eventLabel(event)}</label>}
        {rounds[round] && <label className={styles.check}><input type="checkbox" name="round" defaultChecked /> Only {rounds[round].toLowerCase()}</label>}
        <p className={styles.secondary}>Leave both filters clear to review the entire workbook.</p>
        <RecordSearch kind="meets" initialId={heldText(meet.id)} />
        <label className={styles.check}><input type="checkbox" name="reviewedAffiliation" /> Verify this club’s historical Velocity affiliation in this scope</label>
      </>,
      fields: (form) => ({
        ...(value(form, "event") && event ? { eventCode: event } : {}),
        ...(value(form, "round") && rounds[round] ? { round } : {}),
        ...(value(form, "meetId") ? { meetId: value(form, "meetId") } : {}),
        reviewedAffiliation: Boolean(value(form, "reviewedAffiliation")),
      }),
    }} />
  );
}

function IdentityScope({ detail, facts }: { detail: HeldDetail; facts: HeldFacts }) {
  const router = useRouter();
  const linked = detail.decisions.find(({ scope }) => scope === "identity")?.athleteId;
  const pending = useRef<{ athleteId: string; requestId: string; pageSize: number; checked: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<HeldSwimmerApproval>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const athleteId = value(new FormData(event.currentTarget), "athleteId");
    if (!athleteId) {
      setError("Select a swimmer profile.");
      return;
    }
    if (pending.current?.athleteId !== athleteId) {
      pending.current = { athleteId, requestId: crypto.randomUUID(), pageSize: 40, checked: -1 };
      setProgress(undefined);
    }
    const run = pending.current;
    setBusy(true);
    setError("");
    try {
      while (true) {
        let receipt: HeldSwimmerApproval;
        try {
          receipt = await request<HeldSwimmerApproval>({
            action: "linkAndApproveSwimmer", id: detail.id, athleteId, requestId: run.requestId, pageSize: run.pageSize,
          });
        } catch (failure) {
          if (!(failure instanceof HeldRequestError && failure.retrySmaller) || run.pageSize === 1) throw failure;
          run.pageSize = Math.floor(run.pageSize / 2);
          continue;
        }
        if (!receipt.done && receipt.checked <= run.checked) {
          throw new Error("Approval stopped before checking the entire group. Resume to continue.");
        }
        run.requestId = receipt.requestId;
        run.checked = receipt.checked;
        setProgress(receipt);
        if (receipt.done) break;
      }
      pending.current = null;
      router.refresh();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className={styles.form}>
      <fieldset className={styles.formFields} disabled={busy}>
        <p>This applies to the source swimmer ID across all meets. Swims that need further review stay in Held Observations.</p>
        <RecordSearch kind="athletes" initialId={linked ?? heldText(facts.athleteId)} />
      </fieldset>
      <div className={styles.toolbar}>
        <button type="submit" className={styles.primary} disabled={busy}>
          {busy ? "Approving eligible swims…" : error && progress ? "Resume approval" : "Link swimmer and approve eligible swims"}
        </button>
      </div>
      {progress && <p role="status">
        {progress.checked.toLocaleString()} of {progress.total.toLocaleString()} checked · {progress.approved.toLocaleString()} approved
        {progress.done && <> · {progress.alreadyRecorded.toLocaleString()} already recorded · {progress.stillHeld.toLocaleString()} need review · {progress.outcomes.toLocaleString()} source outcomes</>}
      </p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </form>
  );
}

function SplitFields({ splits, coverage }: { splits: HeldFacts[]; coverage: string }) {
  const [count, setCount] = useState(splits.length || 1);
  return (
    <details className={styles.extraFields}>
      <summary>Splits</summary>
      <InventoryField label="Split coverage">
        <select name="splitCoverage" defaultValue={coverage}>
          <option value="">Unspecified</option>
          <option value="unavailable">Unavailable</option>
          <option value="partial">Partial</option>
          <option value="complete">Complete</option>
        </select>
      </InventoryField>
      {Array.from({ length: count }, (_, index) =>
        <div className={styles.fieldGrid} key={index}>
          <InventoryField label={`Split ${index + 1} distance`}>
            <input name={`splitDistance${index}`} type="number" min="1" step="1" defaultValue={numberValue(splits[index]?.distance)} />
          </InventoryField>
          <InventoryField label={`Split ${index + 1} cumulative time`}>
            <input name={`splitTime${index}`} defaultValue={time(splits[index]?.cumulativeMs)} placeholder="0:27.48" />
          </InventoryField>
        </div>)}
      <div className={styles.toolbar}>
        <button type="button" disabled={count >= 1000} onClick={() => setCount(count + 1)}>Add split</button>
        <button type="button" disabled={!count} onClick={() => setCount(count - 1)}>Remove last split</button>
      </div>
    </details>
  );
}

function LineupFields({ members }: { members: HeldFacts[] }) {
  return (
    <details className={styles.extraFields}>
      <summary>Relay lineup</summary>
      {[1, 2, 3, 4].map((leg) => {
        const member = members.find((item) => item.leg === leg);
        return (
          <div className={styles.fieldGrid} key={leg}>
            <InventoryField label={`Leg ${leg} swimmer`}>
              <input name={`memberName${leg}`} defaultValue={heldText(member?.name)} maxLength={160} />
            </InventoryField>
            <InventoryField label={`Leg ${leg} swimmer ID, if known`}>
              <input name={`memberId${leg}`} defaultValue={heldText(member?.athleteId)} maxLength={180} pattern="[A-Za-z0-9_\-]{1,180}" />
            </InventoryField>
          </div>
        );
      })}
    </details>
  );
}

function listFacts(value: Json | undefined) {
  return Array.isArray(value) ? value.map(heldFacts) : [];
}

function positiveTime(value: string) {
  const ms = parseSwimTime(value);
  if (!ms || !Number.isSafeInteger(ms) || ms > 999999999) throw new Error("Enter a positive time, such as 1:02.34.");
  return ms;
}

function detailsPatch(form: FormData, facts: HeldFacts, relay: boolean): HeldFacts {
  const patch: HeldFacts = {};
  const splits = listFacts(facts.splits);
  const members = listFacts(facts.members);
  const submittedSplits: HeldFacts[] = [];
  const distanceFields = [...form.keys()].filter((key) => key.startsWith("splitDistance"));
  distanceFields.forEach((key, index) => {
    const distance = value(form, key);
    const elapsed = value(form, `splitTime${index}`);
    const original = splits[index];
    if (!distance && !elapsed) return;
    if (!distance || !elapsed) throw new Error("Each split needs a distance and a cumulative time.");
    if (distance === numberValue(original?.distance) && elapsed === time(original?.cumulativeMs)) submittedSplits.push(original);
    else submittedSplits.push({ distance: Number(distance), cumulativeMs: positiveTime(elapsed) });
  });
  if (JSON.stringify(submittedSplits) !== JSON.stringify(splits)) patch.splits = submittedSplits;
  if (relay) {
    const submittedMembers = [1, 2, 3, 4].flatMap((leg) => {
      const name = value(form, `memberName${leg}`);
      const athleteId = value(form, `memberId${leg}`);
      if (!name && !athleteId) return [];
      if (!name) throw new Error(`Enter a swimmer name for leg ${leg}.`);
      const previous = members.find((member) => member.leg === leg);
      if (previous && athleteId === heldText(previous.athleteId) && (name === previous.name || athleteId)) return [{ ...previous, name }];
      return [{ leg, name, ...(athleteId && { athleteId }) }];
    });
    if (JSON.stringify(submittedMembers) !== JSON.stringify(members)) patch.members = submittedMembers;
  }
  return patch;
}

function RowDecision({ detail, facts }: { detail: HeldDetail; facts: HeldFacts }) {
  const observed = detail.observed;
  const meet = heldFacts(facts.meet);
  const relay = detail.kind === "relay";
  const age = numberValue(facts.ageAtSwim ?? observed.age);
  const ageGroup = heldText(facts.ageGroup ?? observed.ageGroup);
  const splits = listFacts(facts.splits);
  const members = listFacts(facts.members);
  const defaults = {
    meetId: heldText(meet.id),
    athleteId: heldText(facts.athleteId),
    raceDate: heldText(meet.date ?? observed.raceDate),
    eventCode: heldText(facts.eventCode ?? observed.eventCode),
    category: heldText(facts.gender ?? observed.category),
    timeMs: time(facts.timeMs ?? observed.timeMs),
    age,
    ageGroup,
    relayName: heldText(facts.relayName ?? observed.relayName),
    splitCoverage: heldText(facts.splitCoverage),
    parentRelayResultId: heldText(facts.parentRelayResultId),
    occurrence: heldText(heldFacts(facts.raceIdentity).occurrence),
  };
  return (
    <DecisionForm id={detail.id} scope="row" button="Save observation review" spec={{
      tools: <>
        {relay ? <InventoryField label="Relay name"><input name="relayName" defaultValue={defaults.relayName} maxLength={160} /></InventoryField>
          : <RecordSearch kind="athletes" initialId={defaults.athleteId} />}
        <RecordSearch kind="meets" initialId={defaults.meetId} />
        <div className={styles.fieldGrid}>
          <InventoryField label="Race day"><input type="date" name="raceDate" defaultValue={defaults.raceDate} /></InventoryField>
          <InventoryField label="Event code"><input name="eventCode" defaultValue={defaults.eventCode} placeholder="100_FR_SCY" maxLength={25} /></InventoryField>
          <InventoryField label="Competitive category">
            <select name="category" defaultValue={defaults.category}>
              <option value="">Unknown</option>
              <option value="F">Female</option>
              <option value="M">Male</option>
              <option value="X">Mixed</option>
            </select>
          </InventoryField>
          <InventoryField label="Finish time"><input name="timeMs" defaultValue={defaults.timeMs} placeholder="1:02.34" /></InventoryField>
          {relay
            ? <InventoryField label="Relay age group"><input name="ageGroup" defaultValue={defaults.ageGroup} maxLength={28} /></InventoryField>
            : <InventoryField label="Age on race day"><input type="number" name="age" defaultValue={defaults.age} min="0" max="120" step="1" /></InventoryField>}
        </div>
        {(detail.round === "S" || detail.round === "TT" || /occurrence/i.test(detail.holdReason)) && (
          <InventoryField label="Source identifier for this start">
            <input name="occurrence" defaultValue={defaults.occurrence === "single" ? "" : defaults.occurrence} maxLength={128} placeholder="Session, heat, and lane or a result ID" />
          </InventoryField>
        )}
        {!relay && (observed.leadOff === true || defaults.parentRelayResultId) && (
          <fieldset className={styles.extraFields}>
            <legend>Verified relay lead-off</legend>
            <InventoryField label="Parent relay result ID"><input name="parentRelayResultId" defaultValue={defaults.parentRelayResultId} maxLength={180} /></InventoryField>
            <label className={styles.check}><input type="checkbox" name="leadOffVerified" /> Confirm the swimmer and flat start for the first leg</label>
          </fieldset>
        )}
        {relay && <LineupFields members={members} />}
        <SplitFields splits={splits} coverage={defaults.splitCoverage} />
        <label className={styles.check}><input type="checkbox" name="confirmFacts" /> Confirm these race details</label>
        <label className={styles.check}><input type="checkbox" name="officialVerified" /> Confirm this is an official competitive time</label>
        <label className={styles.check}><input type="checkbox" name="reviewedAffiliation" /> Verify historical Velocity affiliation for this result</label>
      </>,
      fields: (form) => {
        const patch = detailsPatch(form, facts, relay);
        for (const [key, previous] of Object.entries(defaults)) {
          const next = value(form, key);
          const confirm = Boolean(value(form, "confirmFacts")) && ["athleteId", "meetId", "raceDate", "eventCode", "category", "timeMs"].includes(key);
          if (!next && previous && (key === "age" || (key === "ageGroup" && relay))) {
            patch[key] = null;
            continue;
          }
          if (!next || (next === previous && !confirm)) continue;
          patch[key] = key === "timeMs" ? positiveTime(next) : key === "age" ? Number(next) : next;
        }
        if (value(form, "leadOffVerified")) {
          const parentId = value(form, "parentRelayResultId");
          if (!parentId) throw new Error("Enter the verified parent relay result ID.");
          Object.assign(patch, { leadOffVerified: true, parentRelayResultId: parentId });
        }
        if (value(form, "officialVerified")) patch.officialVerified = true;
        return { patch, expected: detail.current, reviewedAffiliation: Boolean(value(form, "reviewedAffiliation")) };
      },
    }} />
  );
}

export function HeldPublishedCorrection({ current, kind, recordId }: {
  current: HeldFacts;
  kind: "swim" | "relay";
  recordId: string;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [batchId, setBatchId] = useState("");
  const relay = kind === "relay";
  const coverage = heldText(current.splitCoverage);
  const age = numberValue(current.ageAtSwim);
  const ageGroup = heldText(current.ageGroup);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const patch = detailsPatch(form, current, relay);
      const updatedCoverage = value(form, "splitCoverage");
      if (updatedCoverage && updatedCoverage !== coverage) patch.splitCoverage = updatedCoverage;
      if (relay) {
        const updatedAgeGroup = value(form, "ageGroup");
        if (updatedAgeGroup !== ageGroup) patch.ageGroup = updatedAgeGroup || null;
      } else {
        const updatedAge = value(form, "age");
        if (updatedAge !== age) patch.age = updatedAge ? Number(updatedAge) : null;
      }
      if (!Object.keys(patch).length) throw new Error("Change a result detail before sending it for review.");
      const receipt = await request<{ correctionBatchId: string }>({
        action: "correction", kind, recordId, expected: current, patch,
      });
      setBatchId(receipt.correctionBatchId);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.actions}>
      <form className={styles.form} onSubmit={(event) => void submit(event)}>
        <fieldset className={styles.formFields} disabled={busy || Boolean(batchId)}>
          {relay
            ? <InventoryField label="Relay age group"><input name="ageGroup" defaultValue={ageGroup} maxLength={28} /></InventoryField>
            : <InventoryField label="Age on race day"><input type="number" name="age" defaultValue={age} min="0" max="120" step="1" /></InventoryField>}
          {relay && <LineupFields members={listFacts(current.members)} />}
          <SplitFields splits={listFacts(current.splits)} coverage={coverage} />
        </fieldset>
        <div className={styles.toolbar}>
          <button type="submit" className={styles.primary} disabled={busy || Boolean(batchId)}>{busy ? "Sending for review…" : "Send correction for review"}</button>
        </div>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {batchId && <p role="status"><Link href={`/tools/review/batches?batchId=${encodeURIComponent(batchId)}`}>Open correction in batch review</Link></p>}
      </form>
    </div>
  );
}

export function HeldReviewControls({ detail, scope }: { detail: HeldDetail; scope: "row" | "identity" | "source" }) {
  const facts = detail.candidate ?? detail.current ?? {};
  const reviewable = scope !== "row" || (detail.status !== "outcome" && detail.status !== "pending");
  const ready = detail.status === "ready" && scope !== "identity";
  return (
    <div className={styles.actions}>
      <SubmitReady ids={ready ? [detail.id] : []} show={ready} />
      {reviewable && (scope === "identity" && detail.memberIdHash ? <IdentityScope detail={detail} facts={facts} />
        : scope === "source" ? <SourceScope detail={detail} facts={facts} />
          : <RowDecision detail={detail} facts={facts} />)}
    </div>
  );
}
