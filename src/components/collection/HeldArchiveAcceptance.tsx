"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { heldArchiveReceipt, heldObservationsHref, type HeldArchiveReceipt } from "@/lib/collection/held-observations";
import styles from "./HeldObservations.module.css";

export function HeldArchiveAcceptance({ initial }: { initial: HeldArchiveReceipt | null }) {
  const router = useRouter();
  const active = useRef<AbortController | null>(null);
  const [receipt, setReceipt] = useState<HeldArchiveReceipt>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = initial?.hasUnaccepted && receipt?.completed ? initial : receipt ?? initial;
  const canAccept = !current?.completed || current.hasUnaccepted;
  const resuming = (!current?.completed && (current?.accepted ?? 0) > 0) || Boolean(error);

  useEffect(() => () => active.current?.abort(), []);

  async function accept() {
    if (active.current) return;
    const run = new AbortController();
    active.current = run;
    setBusy(true);
    setError("");
    try {
      let previous = -1;
      while (!run.signal.aborted) {
        const response = await fetch("/api/collection/held-observations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "acceptOfficialArchive" }),
          signal: run.signal,
        });
        const body = await response.json().catch(() => null);
        if (run.signal.aborted) return;
        if (!response.ok) {
          throw new Error(typeof body?.error === "string" ? body.error : "The archive could not be processed. Resume to try again.");
        }
        const next = heldArchiveReceipt(body);
        if (!next || (!next.completed && next.accepted <= previous)) {
          throw new Error("The archive stopped before finishing. Resume to continue from the last saved batch.");
        }
        setReceipt(next);
        if (next.completed) {
          router.refresh();
          return;
        }
        previous = next.accepted;
      }
    } catch (failure) {
      if (!run.signal.aborted) setError(failure instanceof Error ? failure.message : "Resume to try again.");
    } finally {
      active.current = null;
      if (!run.signal.aborted) setBusy(false);
    }
  }

  return (
    <section className={`${styles.actions} ${styles.form}`} aria-label="GoMotion archive acceptance">
      <strong>GoMotion archive</strong>
      <p>Accept every observation in this archive, across all pages and filters. Results with the details needed for Times are published. Other observations are kept as accepted source evidence.</p>
      {canAccept && (
        <div className={styles.toolbar}>
          <button type="button" className={styles.primary} disabled={busy} onClick={() => void accept()}>
            {busy ? "Accepting archive…" : resuming ? "Resume archive acceptance" : "Accept all GoMotion observations"}
          </button>
        </div>
      )}
      {current && !current.completed && current.total > 0 && (
        <progress className={styles.archiveProgress} aria-label="Archive acceptance progress" value={current.accepted} max={current.total} />
      )}
      {current && (
        <p role={current.completed ? "status" : undefined}>
          {current.accepted.toLocaleString()} of {current.total.toLocaleString()} accepted
          {` · ${current.published.toLocaleString()} published · ${current.alreadyRecorded.toLocaleString()} already recorded · ${current.sourceOnly.toLocaleString()} accepted source only`}
        </p>
      )}
      {current?.completed && current.sourceOnly > 0 && (
        <div className={styles.toolbar}>
          <Link href={`${heldObservationsHref}?view=observations&status=accepted`} prefetch={false}>View accepted source observations</Link>
        </div>
      )}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </section>
  );
}
