import { createHash } from "node:crypto";
import { serverClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/same-origin";
import { isToolsAdmin } from "@/lib/tools-access";
import {
  attendanceStatuses,
  type AttendanceDay,
  type AttendanceSave,
} from "@/lib/attendance";
import type { Json } from "@/lib/supabase/database.types";

const reply = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const identifier = (value: unknown) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,1500}$/.test(value);
function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
async function staffClient() {
  const client = await serverClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user)
    return { denied: reply({ error: "Sign in to record attendance." }, 401) };
  if (user.is_anonymous || !isToolsAdmin(user.email, !!user.email_confirmed_at))
    return {
      denied: reply(
        { error: "This account does not have access to attendance." },
        403,
      ),
    };
  const { data: staff, error: staffError } = await client.rpc("is_staff");
  if (staffError || !staff)
    return {
      denied: reply(
        { error: "Staff access is required to record attendance." },
        403,
      ),
    };
  return { client };
}
export async function GET(request: Request) {
  const access = await staffClient();
  if (access.denied) return access.denied;
  const date = new URL(request.url).searchParams.get("date");
  if (!validDate(date))
    return reply({ error: "Choose a valid practice date." }, 400);
  try {
    const { client } = access;
    const swimmers: AttendanceDay["swimmers"] = [];
    // Page the active roster rather than silently dropping swimmers after 1,000 rows.
    for (let from = 0; ; from += 500) {
      const { data, error } = await client
        .from("athletes")
        .select("id, people(name, data), training_groups(name)")
        .eq("data->>status", "active")
        .order("id")
        .range(from, from + 499);
      if (error) throw error;
      for (const row of data ?? []) {
        const person = row.people;
        const fullName = person?.name ?? "";
        const name = object(object(person?.data).structuredName);
        const firstSpace = fullName.indexOf(" ");
        swimmers.push({
          id: row.id,
          group: row.training_groups?.name ?? "No Assignment",
          name: {
            first:
              typeof name.first === "string"
                ? name.first
                : firstSpace < 0
                  ? fullName
                  : fullName.slice(0, firstSpace),
            last:
              typeof name.last === "string"
                ? name.last
                : firstSpace < 0
                  ? ""
                  : fullName.slice(firstSpace + 1),
          },
        });
      }
      if (!data || data.length < 500) break;
    }
    const { data: sessions, error: sessionError } = await client
      .from("practice_sessions")
      .select("id, data")
      .eq("practice_date", date)
      .order("id");
    if (sessionError) throw sessionError;
    const marks: AttendanceDay["marks"] = [];
    if (sessions?.length) {
      for (let from = 0; ; from += 500) {
        const { data, error } = await client
          .from("attendance")
          .select("id, data")
          .in(
            "session_id",
            sessions.map((session) => session.id),
          )
          .order("id")
          .range(from, from + 499);
        if (error) throw error;
        marks.push(...((data ?? []) as AttendanceDay["marks"]));
        if (!data || data.length < 500) break;
      }
    }
    return reply({ date, swimmers, sessions: sessions ?? [], marks });
  } catch {
    return reply({ error: "Unable to load attendance. Please retry." }, 500);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return reply({ error: "Invalid request origin." }, 403);
  const access = await staffClient();
  if (access.denied) return access.denied;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 1_500_000)
      throw new Error("Attendance batch is too large.");
    const input = object(JSON.parse(raw));
    if (
      !validDate(input.date) ||
      typeof input.group !== "string" ||
      !input.group.trim() ||
      input.group.length > 200 ||
      !Array.isArray(input.changes) ||
      !input.changes.length ||
      input.changes.length > 449
    )
      throw new Error(
        "Choose a practice and between 1 and 449 attendance changes.",
      );
    const date = input.date,
      group = input.group;
    const session = input.session === null ? null : object(input.session);
    const sessionData = object(session?.data);
    if (
      session &&
      (!identifier(session.id) ||
        sessionData.date !== date ||
        sessionData.trainingGroup !== group)
    )
      throw new Error("Reload this practice before saving attendance.");
    // The same unsaved practice resolves to one key across tabs, so competing
    // creates conflict instead of creating two sessions for the same group/day.
    const sessionId = session
      ? String(session.id)
      : `practice_${createHash("sha256")
          .update(JSON.stringify([date, group]))
          .digest("hex")}`;
    const reads: Json[] = [
      {
        path: `practice_sessions/${sessionId}`,
        before: (session?.data as Json) ?? null,
      },
    ];
    const writes: Json[] = session
      ? []
      : [
          {
            path: `practice_sessions/${sessionId}`,
            after: { id: sessionId, date, trainingGroup: group },
          },
        ];
    const ids = new Set<string>();
    for (const value of input.changes) {
      const change = object(value),
        before = change.before === null ? null : object(change.before);
      const beforeData = object(before?.data);
      if (
        !identifier(change.athleteId) ||
        ids.has(String(change.athleteId)) ||
        !attendanceStatuses.includes(
          change.status as AttendanceSave["changes"][number]["status"],
        ) ||
        (before &&
          (!identifier(before.id) ||
            beforeData.athleteId !== change.athleteId ||
            beforeData.sessionId !== sessionId))
      )
        throw new Error(
          "Invalid attendance change. Reload the practice and retry.",
        );
      const athleteId = String(change.athleteId);
      ids.add(athleteId);
      const id = before ? String(before.id) : `${sessionId}_${athleteId}`;
      reads.push({
        path: `attendance/${id}`,
        before: (before?.data as Json) ?? null,
      });
      writes.push({
        path: `attendance/${id}`,
        after: {
          ...(beforeData as Record<string, Json>),
          id,
          athleteId,
          sessionId,
          date,
          status: change.status as string,
        },
      });
    }
    // SQL retains staff authorization and compares every reviewed before-image
    // under one transaction lock; no row is saved if any mark became stale.
    const { error } = await access.client.rpc("commit_records", {
      reads,
      writes,
    });
    if (error)
      return reply(
        {
          error: ["40001", "23505"].includes(error.code)
            ? "Attendance changed since you loaded it. Reload the practice and review your changes."
            : error.message,
        },
        ["40001", "23505"].includes(error.code)
          ? 409
          : error.code === "42501"
            ? 403
            : 400,
      );
    return reply({ success: true });
  } catch (cause) {
    return reply(
      {
        error:
          cause instanceof Error ? cause.message : "Unable to save attendance.",
      },
      400,
    );
  }
}
