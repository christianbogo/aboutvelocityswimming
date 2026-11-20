"use client";
import { useUpdateBlocker } from "@/hooks/useUpdateBlocker";
import { useEffect, useState } from "react";
import {
  loadAttendanceDay,
  saveAttendance,
  type AttendanceDay,
  type AttendanceStatus,
} from "@/lib/attendance";
import { teamDate } from "@/lib/dates";
import { Button } from "@/components/shared/Button";
import { Input } from "@/components/shared/Input";
import { useAuth } from "@/features/workshare/contexts/auth";
export default function AttendanceBoard() {
  const { isAdmin, loading } = useAuth();
  const [day, setDay] = useState<AttendanceDay | null>(null);
  const [attempt, setAttempt] = useState(0),
    [loadingDay, setLoadingDay] = useState(true);
  const [date, setDate] = useState(teamDate()),
    [group, setGroup] = useState(""),
    [draft, setDraft] = useState<Record<string, AttendanceStatus>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  useUpdateBlocker(busy || Object.keys(draft).length > 0);
  useEffect(() => {
    if (!isAdmin) return;
    const controller = new AbortController();
    void loadAttendanceDay(date, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return;
        setDay(loaded);
        setLoadingDay(false);
        setError("");
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to load attendance.",
          );
          setLoadingDay(false);
        }
      });
    return () => controller.abort();
  }, [isAdmin, date, attempt]);
  const current = day?.date === date ? day : null;
  const swimmers = current?.swimmers ?? [];
  const groups = [...new Set(swimmers.map((s) => s.group))].sort();
  const selected = group || groups[0] || "";
  const practice = current?.sessions.find(
    (p) => p.data.trainingGroup === selected,
  );
  const roster = swimmers
    .filter((s) => s.group === selected)
    .sort(
      (a, b) =>
        a.name.last.localeCompare(b.name.last) ||
        a.name.first.localeCompare(b.name.first),
    );
  const status = (id: string) =>
    draft[id] ??
    current?.marks.find(
      (m) => m.data.athleteId === id && m.data.sessionId === practice?.id,
    )?.data.status ??
    "unmarked";
  async function save() {
    setBusy(true);
    setError("");
    try {
      await saveAttendance({
        date,
        group: selected,
        session: practice ?? null,
        changes: roster
          .filter((swimmer) => draft[swimmer.id])
          .map((swimmer) => ({
            athleteId: swimmer.id,
            status: draft[swimmer.id],
            before:
              current?.marks.find(
                (mark) =>
                  mark.data.athleteId === swimmer.id &&
                  mark.data.sessionId === practice?.id,
              ) ?? null,
          })),
      });
      setDraft({});
      setSaved(true);
      setLoadingDay(true);
      setAttempt((value) => value + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save attendance.");
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <p role="status">Checking your account…</p>;
  if (!isAdmin)
    return <p role="alert">Staff access is required to record attendance.</p>;
  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-3xl mb-2">Practice attendance</h1>
      <p className="text-text-secondary mb-6">
        Swimmers and groups come from the shared team roster.
      </p>
      <div className="flex flex-wrap gap-4 mb-6">
        <label>
          Date
          <Input
            type="date"
            disabled={busy}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setLoadingDay(true);
              setDraft({});
              setSaved(false);
            }}
          />
        </label>
        <label>
          Training group
          <select
            disabled={busy || loadingDay}
            className="block rounded-lg border border-border p-3 bg-surface"
            value={selected}
            onChange={(e) => {
              setGroup(e.target.value);
              setDraft({});
              setSaved(false);
            }}
          >
            {groups.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <div className="mb-4">
          <p role="alert" className="mb-2 text-red-600">
            {error}
          </p>
          <Button
            disabled={busy}
            onClick={() => {
              setDraft({});
              setLoadingDay(true);
              setSaved(false);
              setAttempt((value) => value + 1);
            }}
          >
            Reload practice
          </Button>
          {Object.keys(draft).length > 0 && (
            <p className="mt-2 text-sm">
              Reloading clears your unsaved attendance changes.
            </p>
          )}
        </div>
      )}
      {saved && (
        <p role="status" className="mb-4">
          Attendance saved.
        </p>
      )}
      {loadingDay ? (
        <p role="status">Loading attendance…</p>
      ) : roster.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th className="p-3">Swimmer</th>
                <th className="p-3">Attendance</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((s) => (
                <tr className="border-t border-border" key={s.id}>
                  <td className="p-3">
                    {s.name.first} {s.name.last}
                  </td>
                  <td className="p-3">
                    <select
                      disabled={busy}
                      aria-label={
                        "Attendance for " + s.name.first + " " + s.name.last
                      }
                      className="border border-border rounded-lg bg-surface p-2"
                      value={status(s.id)}
                      onChange={(e) => {
                        setDraft({
                          ...draft,
                          [s.id]: e.target.value as AttendanceStatus,
                        });
                        setSaved(false);
                      }}
                    >
                      <option value="unmarked">Unmarked</option>
                      <option value="present">Present</option>
                      <option value="absent">Absent</option>
                      <option value="late">Late</option>
                      <option value="excused">Excused</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No active swimmers in this group.</p>
      )}
      <Button
        className="mt-6"
        disabled={busy || loadingDay || !Object.keys(draft).length}
        onClick={() => void save()}
      >
        {busy ? "Saving…" : "Save attendance"}
      </Button>
    </main>
  );
}
