import { isCalendarDate } from "@/features/swim-resources/lib/domain/date";
import {
  canonicalRelayResult,
  validateLeadOff,
  validateRaceSplits,
} from "@/features/swim-resources/lib/domain/relay";
import {
  formatSwimTime,
  parseSwimTime,
} from "@/features/swim-resources/lib/domain/swim-time";
import { validateStandard } from "@/features/swimming/domain/validate-standard";
import {
  recordKinds,
  type DataRecord,
  type FileResult,
  type RecordKind,
} from "./types";

export const validId = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
export function object(v: unknown): DataRecord {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Expected a record.");
  return v as DataRecord;
}
function text(v: unknown, label: string) {
  if (typeof v !== "string" || !v.trim() || v.length > 300)
    throw new Error(`${label} is required (up to 300 characters).`);
}
export function validateRecord(kind: RecordKind, body: DataRecord): DataRecord {
  if (!recordKinds.includes(kind) || !validId(body.id))
    throw new Error("Choose a record type and valid ID.");
  if (kind === "standard") {
    validateStandard(body, String(body.id));
    return body;
  }
  if (kind === "athlete") {
    const name = object(body.name);
    text(name.first, "First name");
    text(name.last, "Last name");
    if (body.dob && !isCalendarDate(body.dob))
      throw new Error("Enter a valid birthday.");
    if (!["M", "F", "X"].includes(String(body.gender)))
      throw new Error("Choose a swimmer category.");
    if (
      !["active", "inactive", "alumni", "taking_break"].includes(
        String(body.status),
      )
    )
      throw new Error("Choose a roster status.");
    if (body.teamId && body.teamId !== "velocity-swimming")
      throw new Error("Only Velocity profiles can be managed here.");
    return body;
  }
  if (kind === "meet") {
    text(body.name, "Meet name");
    const dates = object(body.dates);
    if (
      !isCalendarDate(dates.startDate) ||
      !isCalendarDate(dates.endDate) ||
      dates.endDate < dates.startDate
    )
      throw new Error("Enter valid meet dates in chronological order.");
    // The database and older readers recognize both shapes. Keep them synchronized.
    return { ...body, startsOn: dates.startDate, endsOn: dates.endDate };
  }
  if (body.teamId !== "velocity-swimming")
    throw new Error("Only Velocity results can be saved.");
  if (
    !["SCY", "SCM", "LCM"].includes(String(body.course)) ||
    !["M", "F", "X"].includes(String(body.gender))
  )
    throw new Error("Choose an event course and category.");
  if (!["F", "P", "S", "TT"].includes(String(body.round)))
    throw new Error("Choose the race round.");
  if (!["OK", "DQ", "DFS", "NS", "DNF", "SCR"].includes(String(body.status)))
    throw new Error("Choose a result status.");
  if (
    !Number.isSafeInteger(body.timeMs) ||
    Number(body.timeMs) < 0 ||
    Number(body.timeMs) > 2147483647 ||
    (body.status === "OK" && Number(body.timeMs) === 0)
  )
    throw new Error("Enter a valid result time.");
  if (typeof body.isOfficial !== "boolean")
    throw new Error("Choose whether this is an official result.");
  const meet = object(body.meet);
  if (!validId(meet.id) || !isCalendarDate(meet.date))
    throw new Error("Choose a meet and exact race date.");
  text(meet.name, "Meet name");
  if (kind === "relay") {
    // The canonical relay validator historically used the shorter status list.
    const checked = canonicalRelayResult({
      ...body,
      status: ["DNF", "SCR"].includes(String(body.status)) ? "NS" : body.status,
    });
    return {
      ...checked,
      status: body.status,
      timeDisplay: body.status === "OK" ? checked.timeDisplay : body.status,
    };
  }
  if (!validId(body.athleteId)) throw new Error("Choose a swimmer.");
  if (
    !Number.isSafeInteger(body.distance) ||
    !/^(25|50|100|200|400|500|800|1000|1500|1650)_(FR|BK|BR|FL|IM)_(SCY|SCM|LCM)$/.test(
      String(body.eventCode),
    ) ||
    body.eventCode !== `${body.distance}_${body.stroke}_${body.course}`
  )
    throw new Error("Event fields disagree.");
  if (
    body.ageAtSwim !== undefined &&
    (!Number.isInteger(body.ageAtSwim) ||
      Number(body.ageAtSwim) < 0 ||
      Number(body.ageAtSwim) > 120)
  )
    throw new Error("Enter a valid race age, or leave it unknown.");
  if (
    body.timeDisplay !== undefined &&
    body.status === "OK" &&
    parseSwimTime(body.timeDisplay as string) !== body.timeMs
  )
    throw new Error("Time fields disagree.");
  validateRaceSplits(body);
  validateLeadOff(body);
  return {
    ...body,
    timeDisplay:
      body.status === "OK" ? formatSwimTime(Number(body.timeMs)) : body.status,
  };
}
export function validateFileRow(value: unknown): FileResult {
  const row = object(value);
  if (!["swim", "relay"].includes(String(row.kind)))
    throw new Error("Only meet results can be imported.");
  const source = object(row.source),
    meet = object(row.meet),
    team = object(row.team);
  if (
    !["hy3", "cl2", "sd3"].includes(String(source.format)) ||
    !/^[a-f0-9]{64}$/.test(String(source.sha256)) ||
    !Number.isSafeInteger(source.line) ||
    Number(source.line) < 1
  )
    throw new Error("Invalid file provenance.");
  text(source.filename, "Filename");
  text(meet.name, "Meet name");
  if (
    !isCalendarDate(meet.startsOn) ||
    !isCalendarDate(meet.endsOn) ||
    meet.endsOn < meet.startsOn ||
    !isCalendarDate(row.date) ||
    row.date < meet.startsOn ||
    row.date > meet.endsOn
  )
    throw new Error("Race dates must be within the meet.");
  text(team.clubCode, "Source club");
  if (
    !["SCY", "SCM", "LCM"].includes(String(row.course)) ||
    !["F", "P", "S", "TT"].includes(String(row.round)) ||
    !["F", "M", "X"].includes(String(row.gender)) ||
    !["FR", "BK", "BR", "FL", "IM"].includes(String(row.stroke))
  )
    throw new Error("Unsupported event or round.");
  if (
    !Number.isSafeInteger(row.distance) ||
    Number(row.distance) <= 0 ||
    !Number.isSafeInteger(row.timeMs) ||
    Number(row.timeMs) < 0 ||
    Number(row.timeMs) > 2147483647 ||
    !["OK", "DQ", "DFS", "NS", "DNF", "SCR"].includes(String(row.status)) ||
    (row.status === "OK" && !row.timeMs)
  )
    throw new Error("Invalid result time or status.");
  validateRaceSplits(row);
  const athletes =
    row.kind === "swim"
      ? [row.athlete]
      : Array.isArray(row.members) && row.members.length <= 4
        ? row.members.map((m) => object(m).athlete)
        : (() => {
            throw new Error("Invalid relay lineup.");
          })();
  for (const a of athletes) {
    const athlete = object(a);
    text(athlete.first, "Swimmer first name");
    text(athlete.last, "Swimmer last name");
    if (athlete.dob && !isCalendarDate(athlete.dob))
      throw new Error("Invalid swimmer birthday.");
    if (
      athlete.memberHash &&
      !/^[a-f0-9]{24}$/.test(String(athlete.memberHash))
    )
      throw new Error("Invalid swimmer identity.");
  }
  return value as FileResult;
}
