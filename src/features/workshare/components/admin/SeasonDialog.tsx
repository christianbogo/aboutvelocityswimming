"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/shared/Input";
import { Button } from "@/components/shared/Button";
import { useUpdateBlocker } from "@/hooks/useUpdateBlocker";
import {
  createSeason,
  WorkshareRequestError,
  type WorkshareSeason,
} from "../../lib/tickets";
import { fieldClass, selectClass } from "./TicketFields";
import { TicketModal } from "./TicketModal";

export function SeasonDialog({
  seasons,
  selectedSeasonId,
  onCreated,
  onClose,
}: {
  seasons: WorkshareSeason[];
  selectedSeasonId?: string;
  onCreated: (season: WorkshareSeason) => void;
  onClose: () => void;
}) {
  const [id] = useState(() => crypto.randomUUID());
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [copyFromSeasonId, setCopyFromSeasonId] = useState(
    selectedSeasonId ?? seasons[0]?.id ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState("");
  const firstSeason = seasons.length === 0;
  useUpdateBlocker(busy);
  useEffect(() => {
    if (!busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [busy]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim() || !startsOn || !endsOn || startsOn > endsOn) {
      setError("Enter a season name and a valid start and end date.");
      return;
    }
    if (!firstSeason && !copyFromSeasonId) {
      setError("Choose the season to copy requirements from.");
      return;
    }
    setBusy(true);
    setLocked(true);
    setError("");
    try {
      const season = await createSeason({
        id,
        name: name.trim(),
        startsOn,
        endsOn,
        copyFromSeasonId: firstSeason ? null : copyFromSeasonId,
      });
      onCreated(season);
      onClose();
    } catch (cause) {
      if (
        cause instanceof WorkshareRequestError &&
        cause.status >= 400 &&
        cause.status < 500 &&
        cause.status !== 409
      ) {
        setLocked(false);
      }
      setError(
        cause instanceof Error ? cause.message : "Unable to create the season.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <TicketModal
      title="Create season"
      onClose={() => {
        if (!busy) onClose();
      }}
      closing={busy}
    >
      <form onSubmit={(event) => void create(event)} className="space-y-5">
        <fieldset
          disabled={busy || locked}
          className="space-y-4 disabled:opacity-60"
        >
          <label className={`${fieldClass} w-full max-w-xs`}>
            <span>Season name</span>
            <Input
              autoFocus
              required
              maxLength={100}
              value={name}
              placeholder="e.g. 2026–2027"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-4">
            <label className={`${fieldClass} w-full max-w-48`}>
              <span>Starts on</span>
              <Input
                required
                type="date"
                value={startsOn}
                max={endsOn || undefined}
                onChange={(event) => setStartsOn(event.target.value)}
              />
            </label>
            <label className={`${fieldClass} w-full max-w-48`}>
              <span>Ends on</span>
              <Input
                required
                type="date"
                value={endsOn}
                min={startsOn || undefined}
                onChange={(event) => setEndsOn(event.target.value)}
              />
            </label>
          </div>
          {firstSeason ? (
            <p className="text-sm text-text-secondary">
              This first season will use the accounts’ existing hour
              requirements.
            </p>
          ) : (
            <label className={`${fieldClass} w-full max-w-xs`}>
              <span>Copy requirements from</span>
              <select
                required
                className={selectClass}
                value={copyFromSeasonId}
                onChange={(event) => setCopyFromSeasonId(event.target.value)}
              >
                <option value="">Select a season</option>
                {seasons.map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {error && locked && (
          <p className="text-xs text-text-secondary">
            Retry to confirm this season before changing its details.
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? "Creating…" : "Create season"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
        </div>
      </form>
    </TicketModal>
  );
}
