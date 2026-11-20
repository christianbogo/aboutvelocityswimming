import type { Json } from "./supabase/database.types";
import { withUpdateHold } from "./update-safety";

export const attendanceStatuses = [
  "unmarked",
  "present",
  "absent",
  "late",
  "excused",
] as const;
export type AttendanceStatus = (typeof attendanceStatuses)[number];
export interface AttendanceSwimmer {
  id: string;
  name: { first: string; last: string };
  group: string;
}
export interface AttendanceSession {
  id: string;
  data: {
    [key: string]: Json | undefined;
    date: string;
    trainingGroup: string;
  };
}
export interface AttendanceMark {
  id: string;
  data: {
    [key: string]: Json | undefined;
    athleteId: string;
    sessionId: string;
    status: AttendanceStatus;
  };
}
export interface AttendanceDay {
  date: string;
  swimmers: AttendanceSwimmer[];
  sessions: AttendanceSession[];
  marks: AttendanceMark[];
}
export interface AttendanceSave {
  date: string;
  group: string;
  session: AttendanceSession | null;
  changes: Array<{
    athleteId: string;
    status: AttendanceStatus;
    before: AttendanceMark | null;
  }>;
}

async function responseData<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load attendance.");
  return body as T;
}
export function loadAttendanceDay(date: string, signal: AbortSignal) {
  return fetch(`/api/attendance?date=${encodeURIComponent(date)}`, {
    cache: "no-store",
    signal,
  }).then(responseData<AttendanceDay>);
}
export function saveAttendance(input: AttendanceSave) {
  return withUpdateHold(async () =>
    responseData<{ success: true }>(
      await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    ),
  );
}
