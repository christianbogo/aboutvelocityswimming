import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  getImportSwimmerMatch,
  resolveImportSwimmerMatch,
  type ImportSwimmerMatch as SwimmerMatch,
  type ImportSwimmerResolution,
} from "./imports-review-api";
import styles from "./ImportsReview.module.css";
import { timesViewHref } from "./times-url-state";

const matchEvidence = {
  source_identity: "Matching source identity",
  staged_link: "Current staged link",
  name_match: "Same name",
  search: "Search result",
} satisfies Record<SwimmerMatch["candidates"][number]["evidence"], string>;

export default function ImportSwimmerMatch({
  id,
  source,
  clearsSelection,
  saving,
  onSaving,
  onResolved,
}: {
  id: string;
  source: ReactNode;
  clearsSelection: boolean;
  saving: boolean;
  onSaving: (value: boolean) => void;
  onResolved: (resolution: ImportSwimmerResolution) => void;
}) {
  const [search, setSearch] = useState({ value: "" });
  const [loaded, setLoaded] = useState<{ search: typeof search; match?: SwimmerMatch; error?: string }>();
  const [chosenAthleteId, setChosenAthleteId] = useState("");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void getImportSwimmerMatch(id, search.value, controller.signal).then(
      (match) => {
        if (!controller.signal.aborted) setLoaded({ search, match });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setLoaded({ search, error: error instanceof Error ? error.message : "Swimmer profiles could not be loaded." });
        }
      },
    );
    return () => controller.abort();
  }, [id, search]);

  const response = loaded?.search === search ? loaded : undefined;
  const match = response?.match;
  const capture = match ?? loaded?.match;
  const [suggested] = match?.candidates ?? [];
  const athleteId = chosenAthleteId || (match?.candidates.length === 1 && suggested.evidence === "source_identity" ? suggested.id : "");

  function searchProfiles(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("swimmerSearch") ?? "").trim();
    setSearch({ value });
    setChosenAthleteId("");
    setSaveError("");
  }

  async function saveMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!match || saving || !athleteId) return;

    onSaving(true);
    setSaveError("");
    try {
      const resolution = await resolveImportSwimmerMatch({ id, athleteId, matchVersion: match.matchVersion });
      onResolved(resolution);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The swimmer match could not be saved. Try again.");
    } finally {
      onSaving(false);
    }
  }

  return (
    <div className={styles.swimmerMatch}>
      {capture && (
        <p>
          <strong>{capture.capturedName}</strong>
          {capture.capturedTeamName && ` · ${capture.capturedTeamName}`}
          <span className={styles.muted}> · {capture.affected.toLocaleString()} pending {capture.affected === 1 ? "swim" : "swims"}</span>
        </p>
      )}
      {!response && <p role="status">Loading swimmer profiles…</p>}
      {response?.error && (
        <p role="alert">
          {response.error}{" "}
          <button type="button" onClick={() => setSearch({ value: search.value })}>Retry</button>
        </p>
      )}
      {match && (match.candidates.length === 0 ? (
        <p role="status">{search.value ? "No profiles matched this search." : "No profiles suggested. Search by swimmer name or ID."}</p>
      ) : (
        <form onSubmit={(event) => void saveMatch(event)} className={styles.matchForm}>
          <fieldset className={styles.matchCandidates} disabled={saving}>
            <legend>Choose a swimmer profile</legend>
            {match.candidates.map((candidate) => (
              <div key={candidate.id} className={styles.matchCandidate}>
                <label>
                  <input
                    type="radio"
                    name="swimmerMatch"
                    value={candidate.id}
                    checked={athleteId === candidate.id}
                    onChange={() => setChosenAthleteId(candidate.id)}
                  />
                  <span>
                    <strong>{candidate.name}</strong>
                    <span className={styles.muted}>
                      {[candidate.teamName, matchEvidence[candidate.evidence]].filter(Boolean).join(" · ")}
                    </span>
                    <code className={styles.muted}>{candidate.id}</code>
                  </span>
                </label>
                <a
                  href={timesViewHref("athletes", new URLSearchParams({ athleteId: candidate.id }).toString())}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`View ${candidate.name}’s profile (opens in a new tab)`}
                >
                  View profile
                </a>
              </div>
            ))}
          </fieldset>
          {clearsSelection && <p className={styles.muted}>Saving clears the current approval selection.</p>}
          {saveError && <p className={styles.blocker} role="alert">{saveError}</p>}
          <div className={styles.toolbar}>
            <button type="submit" className={styles.primary} disabled={saving || !athleteId}>
              {saving ? "Saving match…" : "Save swimmer match"}
            </button>
            {saving && <span className="sr-only" role="status">Saving swimmer match…</span>}
          </div>
        </form>
      ))}
      <form onSubmit={searchProfiles}>
        <fieldset className={styles.profileSearch} disabled={saving}>
          <label>
            <span>Search swimmer profiles</span>
            <input type="search" name="swimmerSearch" maxLength={200} placeholder="Name or swimmer ID" />
          </label>
          <button type="submit">Search</button>
        </fieldset>
      </form>
      {source && <p className={styles.matchSource}>Source: {source}</p>}
    </div>
  );
}
