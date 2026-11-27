"use client";

import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Search,
  Users,
  ArrowRight,
  Settings,
  ArrowUp,
  ArrowDown,
  ListOrdered,
} from "lucide-react";
import { Button } from "@/components/shared/Button";
import { Input } from "@/components/shared/Input";
import { useUpdateBlocker } from "@/hooks/useUpdateBlocker";
import {
  loadAthleteRoster,
  saveRosterAction,
  type AthleteRoster,
  type RosterAction,
  type TrainingGroup,
} from "../../lib/athletes";
import styles from "./AthletesPanel.module.css";

const selectClass =
  "h-11 rounded-lg border border-border bg-surface px-3 text-sm";
export function AthletesPanel({
  onLoaded,
  onEditingChange,
}: {
  onLoaded: (roster: AthleteRoster) => void;
  onEditingChange: (editing: boolean) => void;
}) {
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
  const [ordering, setOrdering] = useState<TrainingGroup[] | null>(null);
  const [editor, setEditor] = useState<TrainingGroup | "new" | null>(null);
  const [name, setName] = useState("");
  const [coach, setCoach] = useState("");
  const [removing, setRemoving] = useState(false);
  const [removeDestination, setRemoveDestination] = useState("");
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
      busy || loading || editor !== null || ordering !== null,
    );
    return () => callbacks.current.onEditingChange(false);
  }, [busy, loading, editor, ordering]);
  useUpdateBlocker(busy || loading || editor !== null || ordering !== null);
  const groups = roster?.groups ?? [];
  const athletes = (roster?.accounts ?? []).flatMap((account) =>
    account.athletes.map((athlete) => ({
      ...athlete,
      id: athlete.id!,
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
        (showArchived || !athlete.archived) &&
        (filter === "all" ||
          athlete.trainingGroup === (activeGroup?.name ?? "")) &&
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
    visible.length > 0 && visible.every((athlete) => selected.has(athlete.id));
  const groupMembers =
    typeof editor === "object" && editor
      ? athletes.filter((athlete) => athlete.trainingGroup === editor.name)
      : [];
  function changeFilter(value: string) {
    setFilter(value);
    setSelected(new Set());
  }
  function openEditor(group: TrainingGroup | "new") {
    setEditor(group);
    setName(group === "new" ? "" : group.name);
    setCoach(group === "new" ? "" : group.coach);
    setRemoving(false);
    setRemoveDestination("");
    setError("");
    setNotice("");
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
      setEditor(null);
      setOrdering(null);
      if (
        filter !== "all" &&
        filter !== "unassigned" &&
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
      if (action.action !== "reorderGroups") setSelected(new Set());
      setEditor(null);
      setOrdering(null);
      setNotice(message);
      if (action.action === "removeGroup") setFilter(action.destinationId);
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
            Manage practice groups, coaches, and your registration roster.
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
          <Button
            variant="outline"
            size="sm"
            disabled={
              busy || loading || !!editor || !!ordering || groups.length < 2
            }
            onClick={() => {
              setOrdering([...groups]);
              setError("");
              setNotice("");
            }}
          >
            <ListOrdered className="mr-2 size-4" aria-hidden="true" />
            Reorder groups
          </Button>
          <Button
            size="sm"
            disabled={busy || loading || !!editor || !!ordering || !roster}
            onClick={() => openEditor("new")}
          >
            <Plus className="mr-2 size-4" aria-hidden="true" />
            Add group
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
            ...groups,
          ].map((group) => {
            const members = athletes.filter(
              (athlete) =>
                (showArchived || !athlete.archived) &&
                (group.id === "all" ||
                  athlete.trainingGroup ===
                    (group.id === "unassigned" ? "" : group.name)),
            );
            return (
              <button
                key={group.id}
                className={styles.group}
                aria-label={`${group.name}, ${members.length} athletes${"coach" in group ? `, ${group.coach || "No coach assigned"}` : ""}`}
                aria-pressed={filter === group.id}
                disabled={busy || loading || !!editor || !!ordering}
                onClick={() => changeFilter(group.id)}
              >
                <span className="min-w-0">
                  <span className="block break-words font-medium">
                    {group.name}
                  </span>
                  {"coach" in group && (
                    <span className="block text-xs text-text-secondary">
                      {group.coach || "No coach assigned"}
                    </span>
                  )}
                </span>
                <span className={styles.count}>{members.length}</span>
              </button>
            );
          })}
        </aside>
        <div className="min-w-0 space-y-4">
          {ordering && (
            <section className={styles.editor} aria-label="Reorder groups">
              <div>
                <h3 className="font-semibold">Group order</h3>
                <p className="mt-1 text-sm text-text-secondary">
                  Use the arrows to arrange groups, then save. This order is
                  shared across group lists. New groups are added at the end.
                </p>
              </div>
              <ol aria-label="Group order" className="space-y-2">
                {ordering.map((group, index) => (
                  <li key={group.id} className={styles.orderRow}>
                    <span
                      className="text-sm tabular-nums text-text-secondary"
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 break-words text-sm font-medium">
                      {group.name}
                    </span>
                    <div className="flex shrink-0 gap-1">
                      {([-1, 1] as const).map((direction) => (
                        <Button
                          key={direction}
                          variant="outline"
                          className="h-11 w-11 p-0"
                          aria-label={`Move ${group.name} ${direction === -1 ? "up" : "down"}`}
                          disabled={
                            busy ||
                            loading ||
                            index + direction < 0 ||
                            index + direction >= ordering.length
                          }
                          onClick={() =>
                            setOrdering((previous) => {
                              if (!previous) return previous;
                              const next = [...previous];
                              [next[index], next[index + direction]] = [
                                next[index + direction],
                                next[index],
                              ];
                              return next;
                            })
                          }
                        >
                          {direction === -1 ? (
                            <ArrowUp className="size-4" aria-hidden="true" />
                          ) : (
                            <ArrowDown className="size-4" aria-hidden="true" />
                          )}
                        </Button>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={
                    busy ||
                    loading ||
                    ordering.every(
                      (group, index) => group.id === groups[index]?.id,
                    )
                  }
                  onClick={() =>
                    void save(
                      {
                        action: "reorderGroups",
                        groups: ordering.map((group) => ({
                          id: group.id,
                          updatedAt: group.updated_at,
                        })),
                      },
                      "Group order saved.",
                    )
                  }
                >
                  {busy ? "Saving…" : "Save order"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || loading}
                  onClick={() => setOrdering(null)}
                >
                  Cancel
                </Button>
              </div>
            </section>
          )}
          {editor && (
            <form
              className={styles.editor}
              onSubmit={(event) => {
                event.preventDefault();
                if (removing && editor !== "new") {
                  void save(
                    {
                      action: "removeGroup",
                      id: editor.id,
                      updatedAt: editor.updated_at,
                      destinationId: removeDestination,
                      athleteIds: groupMembers
                        .map((athlete) => athlete.id)
                        .sort(),
                    },
                    "Group removed and athletes reassigned.",
                  );
                } else {
                  void save(
                    editor === "new"
                      ? {
                          action: "createGroup",
                          name: name.trim(),
                          coach: coach.trim(),
                        }
                      : {
                          action: "updateGroup",
                          id: editor.id,
                          updatedAt: editor.updated_at,
                          name: name.trim(),
                          coach: coach.trim(),
                        },
                    editor === "new" ? "Group created." : "Group saved.",
                  );
                }
              }}
            >
              <h3 className="font-semibold">
                {editor === "new"
                  ? "Add group"
                  : removing
                    ? `Remove ${editor.name}?`
                    : "Group settings"}
              </h3>
              {removing ? (
                <>
                  <p className="text-sm text-text-secondary">
                    Move all {groupMembers.length} athletes in this group,
                    including archived athletes, before removing it. Athlete
                    records will be kept.
                  </p>
                  <label className="grid gap-1 text-sm">
                    Move athletes to
                    <select
                      required
                      className={selectClass}
                      value={removeDestination}
                      disabled={busy || loading}
                      onChange={(event) =>
                        setRemoveDestination(event.target.value)
                      }
                    >
                      <option value="" disabled>
                        Choose destination…
                      </option>
                      {options(editor === "new" ? undefined : editor.id)}
                    </select>
                  </label>
                </>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm">
                    Group name
                    <Input
                      required
                      maxLength={100}
                      value={name}
                      disabled={busy || loading}
                      onChange={(event) => setName(event.target.value)}
                      autoFocus
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    Coach name
                    <Input
                      maxLength={200}
                      value={coach}
                      disabled={busy || loading}
                      onChange={(event) => setCoach(event.target.value)}
                      placeholder="Not assigned"
                    />
                  </label>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    busy ||
                    loading ||
                    (removing ? !removeDestination : !name.trim())
                  }
                >
                  {busy
                    ? "Saving…"
                    : removing
                      ? "Remove group and move athletes"
                      : "Save group"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || loading}
                  onClick={() => setEditor(null)}
                >
                  Cancel
                </Button>
                {editor !== "new" && !removing && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy || loading}
                    onClick={() => setRemoving(true)}
                  >
                    Remove group
                  </Button>
                )}
              </div>
            </form>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold">
                {filter === "all"
                  ? "All athletes"
                  : (activeGroup?.name ?? "Unassigned")}
              </h3>
              <p className="text-xs text-text-secondary">
                {visible.length} athletes
                {activeGroup
                  ? ` · Coach: ${activeGroup.coach || "Not assigned"}`
                  : ""}
              </p>
            </div>
            {activeGroup && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy || loading || !!editor || !!ordering}
                onClick={() => openEditor(activeGroup)}
              >
                <Settings className="mr-2 size-4" aria-hidden="true" />
                Group settings
              </Button>
            )}
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
                disabled={busy || loading || !!editor || !!ordering}
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
                  !!editor ||
                  !!ordering ||
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
                        loading ||
                        !!editor ||
                        !!ordering
                      }
                      checked={allSelected}
                      onChange={() =>
                        setSelected(
                          allSelected
                            ? new Set()
                            : new Set(visible.map((athlete) => athlete.id)),
                        )
                      }
                    />
                  </th>
                  <th>Athlete</th>
                  <th>Account</th>
                  <th>Group</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((athlete) => (
                  <tr key={athlete.id} data-selected={selected.has(athlete.id)}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${athlete.fullName}`}
                        disabled={busy || loading || !!editor || !!ordering}
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
                      {athlete.fullName}
                      {athlete.archived && (
                        <span className="ml-2 text-xs text-text-secondary">
                          Archived
                        </span>
                      )}
                    </td>
                    <td>{athlete.accountName}</td>
                    <td>{athlete.trainingGroup || "Unassigned"}</td>
                  </tr>
                ))}
                {!visible.length && (
                  <tr>
                    <td colSpan={4} className="text-center">
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
