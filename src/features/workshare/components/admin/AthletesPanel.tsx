"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Search,
  Users,
  ArrowRight,
  Link2,
  Columns3,
} from "lucide-react";
import { Button } from "@/components/shared/Button";
import { Input } from "@/components/shared/Input";
import { useUpdateBlocker } from "@/hooks/useUpdateBlocker";
import {
  fixedGroupNames,
  loadAthleteRoster,
  saveRosterAction,
  type AthleteRoster,
  type RosterAction,
} from "../../lib/athletes";
import styles from "./AthletesPanel.module.css";

const columnsKey = "velocity-athlete-columns-v1";
function subscribeColumns(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("velocity-athlete-columns", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("velocity-athlete-columns", callback);
  };
}
function readColumns() {
  try {
    return localStorage.getItem(columnsKey) ?? "";
  } catch {
    return "";
  }
}
const selectClass =
  "h-11 rounded-lg border border-border bg-surface px-3 text-sm";
export function AthletesPanel({
  onLoaded,
  onEditingChange,
  onOpenAccount,
}: {
  onOpenAccount?: (id: string) => void;
  onLoaded: (roster: AthleteRoster) => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const storedColumns = useSyncExternalStore(
    subscribeColumns,
    readColumns,
    () => "",
  );
  const [columnOverride, setColumnOverride] = useState<{
    account: boolean;
    group: boolean;
    swims: boolean;
  }>();
  let columns = { account: true, group: true, swims: true };
  try {
    const saved = JSON.parse(storedColumns);
    columns = {
      account: saved.account !== false,
      group: saved.group !== false,
      swims: saved.swims !== false,
    };
  } catch {
    /* Use defaults. */
  }
  columns = columnOverride ?? columns;
  function setColumns(next: typeof columns) {
    setColumnOverride(next);
    try {
      localStorage.setItem(columnsKey, JSON.stringify(next));
      window.dispatchEvent(new Event("velocity-athlete-columns"));
    } catch {
      /* Keep in-memory preference. */
    }
  }
  const [roster, setRoster] = useState<AthleteRoster>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [destination, setDestination] = useState("");
  const callbacks = useRef({ onLoaded, onEditingChange });
  useEffect(() => {
    callbacks.current = { onLoaded, onEditingChange };
  });
  useEffect(() => {
    const controller = new AbortController();
    void loadAthleteRoster(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setRoster(data);
          callbacks.current.onLoaded(data);
          setLoading(false);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error ? cause.message : "Unable to load athletes.",
          );
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    callbacks.current.onEditingChange(
      busy || loading,
    );
    return () => callbacks.current.onEditingChange(false);
  }, [busy, loading]);
  useUpdateBlocker(busy || loading);
  const groups = fixedGroupNames.flatMap(name => (roster?.groups ?? []).filter(group => group.name === name));
  const athletes = (roster?.accounts ?? []).flatMap((account) =>
    account.athletes.map((athlete) => ({
      ...athlete,
      id: athlete.id!,
      accountId: account.id!,
      accountName: account.fullName,
      updatedAt: account.updatedAt!,
      archived: account.isArchived || athlete.isArchived,
    })),
  );
  const activeGroup = groups.find((group) => group.id === filter);
  const term = search.trim().toLowerCase();
  const visible = athletes
    .filter(
      (athlete) =>
        (filter === "archived"
          ? athlete.isArchived
          : showArchived || !athlete.archived) &&
        (filter === "archived" ||
          filter === "all" ||
          (!athlete.isArchived &&
            athlete.trainingGroup === (activeGroup?.name ?? ""))) &&
        (!term ||
          [athlete.fullName, athlete.accountName, athlete.trainingGroup].some(
            (value) => value.toLowerCase().includes(term),
          )),
    )
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const selectedAthletes = athletes.filter((athlete) =>
    selected.has(athlete.id),
  );
  const allSelected =
    visible.some((athlete) => !athlete.isArchived) &&
    visible
      .filter((athlete) => !athlete.isArchived)
      .every((athlete) => selected.has(athlete.id));
  function changeFilter(value: string) {
    setFilter(value);
    setSelected(new Set());
  }
  async function reload() {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const data = await loadAthleteRoster();
      setRoster(data);
      callbacks.current.onLoaded(data);
      setSelected(new Set());
      if (
        filter !== "all" &&
        filter !== "unassigned" &&
        filter !== "archived" &&
        !data.groups.some((group) => group.id === filter)
      )
        setFilter("all");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to load athletes.",
      );
    } finally {
      setLoading(false);
    }
  }
  async function save(action: RosterAction, message: string) {
    if (busy || loading) return;
    setBusy(true);
    setError("");
    setNotice("");
    let saved = false;
    try {
      await saveRosterAction(action);
      saved = true;
      const data = await loadAthleteRoster();
      setRoster(data);
      callbacks.current.onLoaded(data);
      setSelected(new Set());
      setNotice(message);
    } catch (cause) {
      setError(
        saved
          ? "Changes saved, but the roster could not refresh. Reload the roster before continuing."
          : `${cause instanceof Error ? cause.message : "Could not confirm this save."} Reload the roster before trying again.`,
      );
    } finally {
      setBusy(false);
    }
  }
  function options(exclude?: string) {
    return (
      <>
        <option value="unassigned">Unassigned</option>
        {groups
          .filter((group) => group.id !== exclude)
          .map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
      </>
    );
  }
  if (loading && !roster)
    return (
      <p role="status" className="p-6">
        Loading athletes and groups…
      </p>
    );
  return (
    <section aria-label="Athletes and groups" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Athletes</h2>
          <p className="text-sm text-text-secondary">
            Move athletes between practice groups.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || loading}
            onClick={() => void reload()}
          >
            {loading ? "Reloading…" : "Reload roster"}
          </Button>
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-lg border border-border p-3 text-sm"
        >
          {notice}
        </p>
      )}
      <div className={styles.workspace}>
        <aside className={styles.groups} aria-label="Practice groups">
          <h3 className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Groups
          </h3>
          {[
            { id: "all", name: "All athletes" },
            { id: "unassigned", name: "Unassigned" },
            { id: "archived", name: "Archived" },
            ...groups,
          ].map((group) => {
            const members = athletes.filter(
              (athlete) =>
                (group.id === "archived"
                  ? athlete.isArchived
                  : showArchived || !athlete.archived) &&
                (group.id === "archived" ||
                  group.id === "all" ||
                  (!athlete.isArchived &&
                    athlete.trainingGroup ===
                      (group.id === "unassigned" ? "" : group.name))),
            );
            if (group.id === "unassigned" && members.length === 0) return null;
            return (
              <button
                key={group.id}
                className={styles.group}
                data-archived-divider={group.id === "archived"}
                data-other-divider={group.name === "Other"}
                aria-label={`${group.name}, ${members.length} athletes`}
                aria-pressed={filter === group.id}
                disabled={busy || loading}
                onClick={() => changeFilter(group.id)}
              >
                <span className="min-w-0">
                  <span className="block break-words font-medium">
                    {group.name}
                  </span>
                </span>
                <span className={styles.count}>{members.length}</span>
              </button>
            );
          })}
        </aside>
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold">
                {filter === "all"
                  ? "All athletes"
                  : (activeGroup?.name ??
                    (filter === "archived" ? "Archived" : "Unassigned"))}
              </h3>
              <p className="text-xs text-text-secondary">
                {visible.length} athletes
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-48 flex-1">
              <Search
                className="absolute left-3 top-3 size-4 text-text-secondary"
                aria-hidden="true"
              />
              <Input
                type="search"
                aria-label="Search athletes"
                placeholder="Search athletes or accounts…"
                className="pl-9"
                value={search}
                disabled={busy || loading}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setSelected(new Set());
                }}
              />
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showArchived}
                disabled={busy || loading}
                onChange={(event) => {
                  setShowArchived(event.target.checked);
                  setSelected(new Set());
                }}
              />
              Include archived
            </label>
          </div>
          {selected.size > 0 && (
            <div className={styles.moveBar}>
              <span className="text-sm font-semibold">
                {selected.size} selected
              </span>
              <select
                aria-label="Move selected athletes to"
                className={selectClass}
                value={destination}
                disabled={busy || loading}
                onChange={(event) => setDestination(event.target.value)}
              >
                <option value="" disabled>
                  Move to…
                </option>
                {options()}
              </select>
              <Button
                size="sm"
                disabled={
                  busy ||
                  loading ||
                  !destination ||
                  selected.size > 1000
                }
                onClick={() =>
                  void save(
                    {
                      action: "move",
                      destinationId: destination,
                      athletes: selectedAthletes.map((athlete) => ({
                        id: athlete.id,
                        updatedAt: athlete.updatedAt,
                      })),
                    },
                    `${selected.size} ${selected.size === 1 ? "athlete" : "athletes"} moved.`,
                  )
                }
              >
                <ArrowRight className="mr-2 size-4" aria-hidden="true" />
                {busy ? "Moving…" : "Move athletes"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || loading}
                onClick={() => setSelected(new Set())}
              >
                Clear selection
              </Button>
              {selected.size > 1000 && (
                <p className="text-sm">Select up to 1,000 athletes per move.</p>
              )}
            </div>
          )}
          <details className="relative w-fit rounded-lg border border-border p-2 text-sm">
            <summary className="flex cursor-pointer items-center gap-2">
              <Columns3 className="size-4" aria-hidden="true" />
              Columns
            </summary>
            <fieldset className="space-y-2 p-2">
              <legend className="sr-only">Visible athlete columns</legend>
              {(["account", "group", "swims"] as const).map((key) => (
                <label key={key} className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={columns[key]}
                    onChange={(event) =>
                      setColumns({ ...columns, [key]: event.target.checked })
                    }
                  />
                  {key === "account" ? "Account" : key === "group" ? "Group" : "Swims"}
                </label>
              ))}
            </fieldset>
          </details>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className="w-12">
                    <input
                      type="checkbox"
                      aria-label="Select all visible athletes"
                      disabled={
                        !visible.length ||
                        busy ||
                        loading ||false
                      }
                      checked={allSelected}
                      onChange={() =>
                        setSelected(
                          allSelected
                            ? new Set()
                            : new Set(
                                visible
                                  .filter((athlete) => !athlete.isArchived)
                                  .map((athlete) => athlete.id),
                              ),
                        )
                      }
                    />
                  </th>
                  <th>Athlete</th>
                  {columns.account && <th>Account</th>}
                  {columns.group && <th>Group</th>}
                  {columns.swims && <th>Swims</th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((athlete) => (
                  <tr
                    key={athlete.id}
                    data-selected={selected.has(athlete.id)}
                    className="cursor-pointer"
                    onClick={(event) => {
                      if (
                        !busy &&
                        !loading &&
                        !(
                          event.target instanceof Element &&
                          event.target.closest("button,input,a")
                        )
                      )
                        onOpenAccount?.(athlete.accountId);
                    }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        className={styles.rowSelect}
                        aria-label={`Select ${athlete.fullName}`}
                        disabled={
                          athlete.isArchived ||
                          busy ||
                          loading
                        }
                        checked={selected.has(athlete.id)}
                        onChange={() =>
                          setSelected((previous) => {
                            const next = new Set(previous);
                            if (next.has(athlete.id)) next.delete(athlete.id);
                            else next.add(athlete.id);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="font-medium">
                      <button
                        type="button"
                        className="text-left hover:underline"
                        disabled={busy || loading}
                        onClick={() => onOpenAccount?.(athlete.accountId)}
                      >
                        {athlete.fullName}
                      </button>
                      {athlete.timesAthleteId && (
                        <span
                          role="img"
                          aria-label="Linked to Times"
                          title="Linked to Times"
                        >
                          <Link2
                            className="ml-1 inline size-4 text-accent"
                            aria-hidden="true"
                          />
                        </span>
                      )}
                      {athlete.archived && (
                        <span className="ml-2 text-xs text-text-secondary">
                          Archived
                        </span>
                      )}
                    </td>
                    {columns.account && <td>{athlete.accountName}</td>}
                    {columns.group && (
                      <td>
                        {athlete.isArchived
                          ? "Archived"
                          : athlete.trainingGroup || "Unassigned"}
                      </td>
                    )}
                    {columns.swims && <td>{athlete.timesAthleteId ? (roster?.swimCounts?.[athlete.timesAthleteId]?.toLocaleString() ?? "—") : "—"}</td>}
                  </tr>
                ))}
                {!visible.length && (
                  <tr>
                    <td
                      colSpan={
                        2 + Number(columns.account) + Number(columns.group) + Number(columns.swims)
                      }
                      className="text-center"
                    >
                      <Users
                        className="mx-auto mb-2 size-5 text-text-secondary"
                        aria-hidden="true"
                      />
                      {athletes.length
                        ? "No athletes match these filters."
                        : "No athletes yet. Add athletes from the Accounts tab."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
