import Link from "next/link";
import {
  InventoryField, InventoryFilters, InventoryPage, InventoryPagination, InventoryTable,
  inventoryParams, type InventorySearchParams,
} from "@/components/collection/ImportsInventory";
import { HeldArchiveAcceptance } from "@/components/collection/HeldArchiveAcceptance";
import { HeldClub, HeldPublishedCorrection, HeldResults, HeldReviewControls, RecheckDecision } from "@/components/collection/HeldObservationActions";
import table from "@/components/collection/ImportsInventory.module.css";
import styles from "@/components/collection/HeldObservations.module.css";
import { eventLabel, rounds } from "@/components/collection/times-data";
import { formatSwimTime } from "@/features/swim-resources/lib/domain/swim-time";
import {
  heldArchiveReceipt, heldEvidenceLink, heldFacts, heldObservationLabel, heldObservationLink,
  heldObservationPageSize, heldObservationsHref, heldObservationStatuses, heldRecordId, heldText, heldUuid,
  type HeldDetail, type HeldFacts, type HeldList, type HeldView,
} from "@/lib/collection/held-observations";
import { getInventoryStaffClient } from "@/lib/collection/inventory-staff";

export const metadata = { title: "Held Observations | Imports" };

const description = "Review historical source results, resolve shared issues, and send verified times for approval.";
const views = [
  ["identity", "Swimmer IDs"],
  ["event", "Meet events"],
  ["observations", "Observations"],
] as const;

function Source({ value, children }: { value: string; children?: React.ReactNode }) {
  const source = heldEvidenceLink(value);
  return source ? <a href={source} target="_blank" rel="noopener noreferrer">{children || source}</a> : value || "—";
}

function ResultFacts({ title, facts, source = false }: { title: string; facts: HeldFacts | null; source?: boolean }) {
  const meet = heldFacts(facts?.meet);
  const event = heldText(facts?.eventCode);
  const athlete = heldFacts(facts?.athleteName);
  const participant = [athlete.first, athlete.last].map(heldText).filter(Boolean).join(" ") ||
    heldText(facts?.name ?? facts?.relayName ?? facts?.athleteId);
  return (
    <section>
      <h2>{title}</h2>
      {facts ? (
        <>
          <dl>
            {participant && <><dt>Swimmer or relay</dt><dd>{participant}</dd></>}
            <dt>Meet</dt><dd>{heldText(meet.name ?? facts.meetName) || heldText(meet.id) || "—"}</dd>
            <dt>Race day</dt><dd>{heldText(meet.date ?? facts.raceDate) || "—"}</dd>
            <dt>Event</dt><dd>{event ? eventLabel(event) : "—"}</dd>
            <dt>Time</dt><dd>{typeof facts.timeMs === "number" && facts.timeMs > 0 ? formatSwimTime(facts.timeMs) : "—"}</dd>
            <dt>Category</dt><dd>{heldText(facts.category ?? facts.gender) || "—"}</dd>
            <dt>Race-day age</dt><dd>{typeof (facts.ageAtSwim ?? facts.age) === "number" ? String(facts.ageAtSwim ?? facts.age) : "—"}</dd>
            <dt>Age group</dt><dd>{heldText(facts.ageGroup) || "—"}</dd>
          </dl>
          <details>
            <summary>{source ? "Captured fields" : "Result fields"}</summary>
            <pre>{JSON.stringify(source ? facts.raw ?? facts : facts, null, 2)}</pre>
          </details>
        </>
      ) : <p className={styles.secondary}>No result draft is available yet.</p>}
    </section>
  );
}

function ObservationDetail({ detail, params }: { detail: HeldDetail; params: URLSearchParams }) {
  const scope = params.get("scope");
  const hasSwimmerGroup = detail.kind === "swim" && Boolean(detail.memberIdHash);
  const active = scope === "source" ? "source" : hasSwimmerGroup && scope !== "row" ? "identity" : "row";
  const decisionNames = { row: "Observation review", identity: "Swimmer match", source: "Meet export review" };
  const sourceOutcome = detail.round === "none" || ["DQ", "DFS", "NS", "DNF", "SCR"].includes(detail.sourceStatus ?? "");
  const reviewable = !sourceOutcome && detail.status !== "outcome" && detail.status !== "pending";
  const detailLink = (changes: Record<string, string | null>) => heldObservationLink(params, changes);
  const sourceTime = heldText(detail.observed.raceDate);
  return (
    <div className={styles.detail}>
      <div className={styles.toolbar}>
        <Link href={detailLink({ id: null, scope: null })} prefetch={false}>Back to observations</Link>
        <strong>{heldObservationStatuses[detail.status]}</strong>
      </div>
      <h2>{heldObservationLabel(detail)}</h2>
      {detail.status === "accepted" && <p>This observation is accepted in the source archive. It is not counted as a published time.</p>}
      {detail.blocker && <p>{detail.blocker}</p>}
      <dl className={styles.sourceFacts}>
        <dt>Source</dt><dd><Source value={detail.sourceUrl}>Open meet results</Source></dd>
        <dt>Club</dt><dd><HeldClub code={detail.clubCode} /></dd>
        <dt>Workbook</dt><dd>{heldText(detail.observed.workbookFile) || "Original GoMotion export"} <code>{detail.workbookSha256}</code></dd>
        <dt>Source row</dt><dd>{detail.sourceRow} · {rounds[detail.round] ?? detail.round}{detail.sourceStatus && ` · ${detail.sourceStatus}`}</dd>
        <dt>Original hold</dt><dd>{detail.holdReason}</dd>
        {detail.memberIdHash && <><dt>Source swimmer</dt><dd><code>{detail.memberIdHash}</code></dd></>}
        {detail.recordId && <><dt>Linked result</dt><dd><code>{detail.recordId}</code></dd></>}
        {!sourceTime && <><dt>Source race day</dt><dd>Unconfirmed</dd></>}
      </dl>
      <div className={styles.comparison}>
        <ResultFacts title="Original observation" facts={detail.observed} source />
        <ResultFacts title="Proposed result" facts={detail.candidate} />
        {detail.current && <ResultFacts title="Published result" facts={detail.current} />}
      </div>
      <nav className={table.viewerNav} aria-label="Review options">
        {hasSwimmerGroup && <Link href={detailLink({ scope: "identity" })} aria-current={active === "identity" ? "page" : undefined} prefetch={false}>Link swimmer</Link>}
        {reviewable && <Link href={detailLink({ scope: "row" })} aria-current={active === "row" ? "page" : undefined} prefetch={false}>Review one result</Link>}
        <Link href={detailLink({ scope: "source" })} aria-current={active === "source" ? "page" : undefined} prefetch={false}>Review meet export</Link>
      </nav>
      {detail.status === "pending" && <div className={styles.toolbar}>
        <Link href={detail.reviewBatchId ? `/tools/review?batchId=${encodeURIComponent(detail.reviewBatchId)}` : "/tools/review"}>Import review</Link>
        <Link href={detail.reviewBatchId ? `/tools/review/batches?batchId=${encodeURIComponent(detail.reviewBatchId)}` : "/tools/review/batches"}>Batch review and history</Link>
      </div>}
      <HeldReviewControls key={`${detail.id}/${active}`} detail={detail} scope={active} />
      {detail.decisions.length > 0 && (
        <details>
          <summary>Decision history</summary>
          <ol>
            {detail.decisions.map((decision) => (
              <li key={decision.id}>
                <strong>{decisionNames[decision.scope]}</strong> · <time dateTime={decision.createdAt}>{new Date(decision.createdAt).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" })}</time>
                {decision.reviewerId && ` · Reviewer ${decision.reviewerId}`}
                <p>{decision.reason} · <Source value={decision.evidenceUrl}>Review source</Source></p>
                <RecheckDecision decision={decision} />
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

export default async function HeldObservationsPage({ searchParams }: { searchParams: Promise<InventorySearchParams> }) {
  const [incoming, auth] = await Promise.all([searchParams, getInventoryStaffClient()]);
  const params = inventoryParams(incoming);
  if ("error" in auth) {
    return <InventoryPage title="Held Observations" description={description}><p role="alert" className={table.notice}>{auth.error}</p></InventoryPage>;
  }
  const recordId = params.get("recordId") ?? "";
  const correctionKind = params.get("correct");
  if ((correctionKind === "swim" || correctionKind === "relay") && heldRecordId.test(recordId)) {
    const result = await auth.client.rpc("velocity_held_observations", {
      input: { action: "record", kind: correctionKind, recordId },
    });
    const record = heldFacts(heldFacts(result.data).current);
    const available = !result.error && record.id === recordId;
    return <InventoryPage title="Correct result details" description="Send checked age, splits, or relay lineup details for staff approval.">
      <div className={styles.detail}>
        <div className={styles.toolbar}>
          <Link href={correctionKind === "relay" ? "/tools/review/swims?kind=relays" : "/tools/review/swims"} prefetch={false}>Back to Viewer</Link>
          <Link href={`${heldObservationsHref}?view=observations&recordId=${encodeURIComponent(recordId)}`} prefetch={false}>Find related observations</Link>
        </div>
        {available ? (
          <>
            <div className={styles.comparison}><ResultFacts title="Published result" facts={record} /></div>
            <HeldPublishedCorrection current={record} kind={correctionKind} recordId={recordId} />
          </>
        ) : <p role="alert" className={table.notice}>This result is unavailable for detail corrections.</p>}
      </div>
    </InventoryPage>;
  }
  const id = params.get("id");
  if (id) {
    const result = heldUuid.test(id)
      ? await auth.client.rpc("velocity_held_observations", { input: { action: "detail", id } })
      : null;
    return <InventoryPage title="Held Observations" description={description}>
      {result?.data
        ? <ObservationDetail detail={result.data as unknown as HeldDetail} params={params} />
        : <p role="alert" className={table.notice}>This observation could not be loaded. <Link href={heldObservationLink(params, { id: null, scope: null })}>Back to observations</Link></p>}
    </InventoryPage>;
  }

  const viewParam = params.get("view");
  const view: HeldView = viewParam === "event" || viewParam === "observations" ? viewParam : recordId ? "observations" : "identity";
  const search = (params.get("search") ?? "").trim().slice(0, 150);
  const kind = params.get("kind");
  const clubCode = params.get("clubCode");
  const status = params.get("status");
  const memberIdHash = params.get("memberIdHash");
  const sourceMeetId = params.get("sourceMeetId");
  const workbookSha256 = params.get("workbookSha256");
  const eventCode = params.get("eventCode");
  const round = params.get("round");
  const offsetParam = params.get("offset") ?? "";
  const offset = /^\d{1,6}$/.test(offsetParam) ? Math.min(100000, Number(offsetParam)) : 0;
  const input = {
    action: "list", search, offset,
    ...(view !== "observations" && { groupBy: view }),
    ...((kind === "swim" || kind === "relay") && { kind }),
    ...((clubCode === "VS" || clubCode === "CUDA") && { clubCode }),
    ...(status && Object.hasOwn(heldObservationStatuses, status) && { status }),
    ...(memberIdHash && /^[0-9a-f]{24}$/.test(memberIdHash) && { memberIdHash }),
    ...(sourceMeetId && heldRecordId.test(sourceMeetId) && { sourceMeetId }),
    ...(workbookSha256 && /^[0-9a-f]{64}$/.test(workbookSha256) && { workbookSha256 }),
    ...(eventCode && /^\d{1,5}_[A-Z-]{2,5}_(SCY|SCM|LCM)$/.test(eventCode) && { eventCode }),
    ...(round && Object.hasOwn(rounds, round) && { round }),
    ...(heldRecordId.test(recordId) && { recordId }),
  };
  const [{ data, error }, archive] = await Promise.all([
    auth.client.rpc("velocity_held_observations", { input }),
    auth.client.rpc("velocity_held_observations", { input: { action: "officialArchiveStatus" } }),
  ]);
  const report = data as unknown as HeldList | null;
  const scoped = Boolean(input.memberIdHash || input.sourceMeetId || input.recordId);
  const links = (changes: Record<string, string | null>) => heldObservationLink(params, changes);

  return (
    <InventoryPage title="Held Observations" description={description}>
      <nav className={table.viewerNav} aria-label="Observation views">
        {views.map(([mode, label]) => (
          <Link key={mode} href={links({ view: mode, offset: null, memberIdHash: null, sourceMeetId: null, workbookSha256: null, eventCode: null, round: null, recordId: null })}
            aria-current={view === mode ? "page" : undefined} prefetch={false}>{label}</Link>
        ))}
      </nav>
      {!archive.error && <HeldArchiveAcceptance initial={heldArchiveReceipt(archive.data)} />}
      <InventoryFilters action={heldObservationsHref} params={params}>
        <input type="hidden" name="view" value={view} />
        {(["memberIdHash", "sourceMeetId", "workbookSha256", "eventCode", "recordId"] as const).map((key) =>
          input[key] && <input key={key} type="hidden" name={key} value={input[key]} />)}
        <InventoryField label="Search">
          <input type="search" name="search" defaultValue={search} maxLength={150} placeholder="Swimmer, meet, or hold reason" />
        </InventoryField>
        <InventoryField label="Result type">
          <select name="kind" defaultValue={kind ?? ""}>
            <option value="">All types</option><option value="swim">Individual</option><option value="relay">Relay</option>
          </select>
        </InventoryField>
        <InventoryField label="Source club">
          <select name="clubCode" defaultValue={clubCode ?? ""}>
            <option value="">Both clubs</option><option value="VS">Velocity</option><option value="CUDA">Barracuda</option>
          </select>
        </InventoryField>
        <InventoryField label="Review status">
          <select name="status" defaultValue={status ?? ""}>
            <option value="">All statuses</option>
            {Object.entries(heldObservationStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </InventoryField>
        <InventoryField label="Round">
          <select name="round" defaultValue={round ?? ""}>
            <option value="">All rounds</option>
            {Object.entries(rounds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </InventoryField>
        {scoped && <Link href={links({ memberIdHash: null, sourceMeetId: null, workbookSha256: null, eventCode: null, round: null, recordId: null, offset: null })} prefetch={false}>Clear group</Link>}
      </InventoryFilters>
      {error || !report
        ? <p className={table.notice} role="alert">Held observations could not be loaded. Refresh to try again.</p>
        : <>
          <ul className={styles.counts} aria-label="Observation totals">
            {Object.entries(heldObservationStatuses).map(([key, label]) => (
              <li key={key}><strong>{(report.counts[key as keyof HeldList["counts"]] ?? 0).toLocaleString()}</strong> {label.toLowerCase()}</li>
            ))}
          </ul>
          <InventoryPagination href={heldObservationsHref} params={params} offset={offset} pageSize={heldObservationPageSize}
            count={view === "observations" ? report.rows.length : report.groups.length} hasMore={report.hasNext} total={report.total} />
          {view === "observations"
            ? <HeldResults key={params.toString()} rows={report.rows} details={Object.fromEntries(report.rows.map((row) => [row.id, links({ id: row.id, scope: null })]))} />
            : <InventoryTable label={view === "identity" ? "Source swimmer groups" : "Meet event groups"} tableClassName={styles.groups}
                columns={[view === "identity" ? "Swimmer" : "Meet event", "Observations", ""]} empty={report.groups.length ? undefined : "No groups match these filters."}>
                {report.groups.map((group) => {
                  const groupLink = links({
                    view: "observations", offset: null, search: null,
                    memberIdHash: group.memberIdHash || null, sourceMeetId: group.sourceMeetId || null,
                    eventCode: group.eventCode || null, round: group.round || null, workbookSha256: group.workbookSha256 || null,
                  });
                  return (
                    <tr key={group.anchorId}>
                      <th scope="row"><Link href={groupLink} prefetch={false}>
                        {group.label || "Unnamed group"}
                        {group.eventCode && <span className={styles.secondary}>{eventLabel(group.eventCode)}{group.round ? ` · ${rounds[group.round] ?? group.round}` : ""}</span>}
                      </Link></th>
                      <td className={table.numeric}>{group.count.toLocaleString()}</td>
                      <td><Link href={links({ id: group.anchorId, scope: view === "identity" ? "identity" : "source" })} prefetch={false}>{view === "identity" ? "Link swimmer" : "Review group"}</Link></td>
                    </tr>
                  );
                })}
              </InventoryTable>}
        </>}
    </InventoryPage>
  );
}
