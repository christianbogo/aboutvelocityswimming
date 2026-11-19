import { unzipSync } from "fflate";
import { zipEntries, verifyZipEntry } from "./zip-integrity";
import { isCalendarDate } from "@/features/swim-resources/lib/domain/date";
import { validateRaceSplits } from "@/features/swim-resources/lib/domain/relay";
import type {
  Course,
  FileAthlete,
  FileMeet,
  FileResult,
  FileSource,
  ParsedFile,
  Round,
} from "./types";

// Fixed-width layouts: SDIF 3.0 (1998), sections B1/C1/D0/D3/E0/F0/G0.
// HY3 offsets and byte checksum retain the existing verified reader's behavior.
const courses: Record<string, Course> = {
  Y: "SCY",
  S: "SCM",
  L: "LCM",
  "1": "SCM",
  "2": "SCY",
  "3": "LCM",
};
const strokes: Record<string, string> = {
  A: "FR",
  B: "BK",
  C: "BR",
  D: "FL",
  E: "IM",
  "1": "FR",
  "2": "BK",
  "3": "BR",
  "4": "FL",
  "5": "IM",
  "6": "FR",
  "7": "IM",
};
const hyStatus: Record<string, string> = {
  " ": "OK",
  S: "OK",
  Q: "DQ",
  R: "NS",
  F: "NS",
  D: "DNF",
};
const maxBytes = 20 * 1024 * 1024,
  maxExpanded = 100 * 1024 * 1024;
const gender = (v: string) => (v === "X" || v === "Mixed" ? "X" : v);
const clean = (s: string) => s.trim();
function date(s: string): string {
  const raw = s.trim();
  const iso = `${raw.slice(4, 8)}-${raw.slice(0, 2)}-${raw.slice(2, 4)}`;
  if (!/^\d{8}$/.test(raw) || !isCalendarDate(iso))
    throw new Error("Missing or invalid calendar date.");
  return iso;
}
function optionalDate(s: string) {
  try {
    return date(s);
  } catch {
    return undefined;
  }
}
export function fileTime(s: string): { timeMs: number; status: string } {
  const value = s.trim();
  if (["DQ", "DFS", "NS", "DNF", "SCR"].includes(value))
    return { timeMs: 0, status: value };
  const m = /^(?:(\d+):)?(\d+)\.(\d{2})$/.exec(value);
  if (!m || (m[1] && +m[2] >= 60))
    throw new Error("Time must be an exact hundredths result.");
  const timeMs = ((+(m[1] || 0) * 60 + +m[2]) * 100 + +m[3]) * 10;
  if (timeMs <= 0) throw new Error("Timed results must be positive.");
  return { timeMs, status: "OK" };
}
async function sha(bytes: Uint8Array) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function name(s: string) {
  const [last, ...first] = s.split(",");
  if (!first.length) return { first: "", last: s.trim() };
  return { first: first.join(",").trim(), last: last.trim() };
}
type RawAthlete = FileAthlete & { member?: string; number?: string };
type RawRow = Omit<FileResult, "athlete" | "members"> & {
  athlete?: RawAthlete;
  members?: Array<{ leg: number; athlete: RawAthlete; timeMs?: number }>;
  hySplits?: number[];
  splitIncrement?: number;
  hyMembers?: Array<{ number: string; gender: string; leg: number }>;
};
function base(
  source: FileSource,
  meet: FileMeet,
  team: FileResult["team"],
): RawRow {
  return {
    kind: "swim",
    source,
    meet,
    team,
    eventNumber: "",
    distance: 0,
    stroke: "",
    course: "SCY",
    gender: "",
    date: "",
    round: "F",
    status: "OK",
    timeMs: 0,
    splits: [],
    splitCoverage: "unavailable",
  };
}
function ageGroup(min: string, max: string) {
  const lo = Number.parseInt(min) || 0,
    hi = Number.parseInt(max) || 0;
  return !hi || hi >= 99
    ? lo
      ? `${lo}&O`
      : "Open"
    : !lo
      ? `${hi}&U`
      : `${lo}-${hi}`;
}
function parseHy3(
  bytes: Uint8Array,
  source: Omit<FileSource, "line">,
): ParsedFile {
  const raw = new TextDecoder("windows-1252").decode(bytes);
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const byteLines: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i <= bytes.length; i++)
    if (i === bytes.length || bytes[i] === 10 || bytes[i] === 13) {
      if (i > start) byteLines.push(bytes.slice(start, i));
      if (bytes[i] === 13 && bytes[i + 1] === 10) i++;
      start = i + 1;
    }
  if (!["A107", "A104"].includes(lines[0]?.slice(0, 4)))
    throw new Error("This is not a HY3 results export.");
  for (let i = 0; i < byteLines.length; i++) {
    const l = byteLines[i];
    let sum = 0;
    for (let c = 0; c < 128; c++) sum += l[c] * (c % 2 ? 2 : 1);
    const checksum = Math.floor(sum / 21) + 205;
    if (
      l.length !== 130 ||
      lines[i]?.slice(128) !==
        `${checksum % 10}${Math.floor(checksum / 10) % 10}`
    )
      throw new Error(`HY3 line ${i + 1} has an invalid length or checksum.`);
  }
  let meet: FileMeet | undefined,
    team: FileResult["team"] | undefined,
    athlete: RawAthlete | undefined;
  let entry: Partial<RawRow> | undefined, current: RawRow | undefined;
  const athletes = new Map<string, RawAthlete>(),
    rows: RawRow[] = [],
    issues: ParsedFile["issues"] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i],
      code = l.slice(0, 2),
      line = i + 1;
    try {
      if (code === "B1") {
        if (meet) throw new Error("A file must describe exactly one meet.");
        meet = {
          name: clean(l.slice(2, 47)),
          startsOn: date(l.slice(92, 100)),
          endsOn: date(l.slice(100, 108)),
        };
      } else if (code === "C1") {
        team = {
          clubCode: clean(l.slice(2, 7)),
          lscCode: clean(l.slice(53, 55)),
          name: clean(l.slice(7, 37)),
        };
        athlete = undefined;
        entry = undefined;
        current = undefined;
      } else if (code === "D1") {
        athlete = {
          first: clean(l.slice(28, 48)),
          last: clean(l.slice(8, 28)),
          gender: gender(l[2]),
          dob: optionalDate(l.slice(88, 96)),
          member: clean(l.slice(69, 83)),
          number: clean(l.slice(3, 8)),
        };
        athletes.set(
          `${team?.lscCode}|${team?.clubCode}|${athlete.number}|${athlete.gender}`,
          athlete,
        );
        entry = undefined;
        current = undefined;
      } else if (code === "E1" || code === "F1") {
        entry = undefined;
        current = undefined;
        if (
          code === "E1" &&
          (!athlete || clean(l.slice(3, 8)) !== athlete.number)
        )
          throw new Error("Entry does not identify its preceding swimmer.");
        entry = {
          kind: code === "E1" ? "swim" : "relay",
          athlete: code === "E1" ? athlete : undefined,
          distance: +l.slice(15, 21),
          stroke: strokes[l[21]],
          eventNumber: clean(l.slice(38, 42)),
          gender: code === "E1" ? athlete?.gender : gender(l[12]),
          relayName: code === "F1" ? clean(l[7]) : undefined,
          ageGroup: ageGroup(l.slice(22, 25), l.slice(25, 28)),
        };
        current = undefined;
      } else if (code === "E2" || code === "F2") {
        current = undefined;
        if (
          !meet ||
          !team ||
          !entry ||
          (code === "E2") !== (entry.kind === "swim") ||
          (code === "E2" && !entry.athlete)
        )
          throw new Error("Result lacks its meet, team, or entry context.");
        const status = hyStatus[l[12]];
        if (!status || !courses[l[11]] || !["F", "P", "S", "T"].includes(l[2]))
          throw new Error("Unknown HY3 status, course, or round.");
        current = {
          ...base({ ...source, line }, meet, team),
          ...entry,
          status,
          round: l[2] === "T" ? "TT" : (l[2] as Round),
          course: courses[l[11]],
          date: date(
            l.slice(code === "E2" ? 87 : 102, code === "E2" ? 95 : 110),
          ),
          timeMs: status === "OK" ? fileTime(l.slice(4, 11)).timeMs : 0,
          hySplits: [],
          hyMembers: [],
        } as RawRow;
        rows.push(current);
      } else if (code === "G1" && current) {
        for (let c = 2; c < 123; c += 11)
          if (
            l[c] === (current.round === "TT" ? "T" : current.round) &&
            l.slice(c + 3, c + 11).trim()
          ) {
            if (!/^(?:0+:)?0+\.00$/.test(l.slice(c + 3, c + 11).trim()))
              current.hySplits!.push(fileTime(l.slice(c + 3, c + 11)).timeMs);
          }
      } else if (code === "F3" && current?.kind === "relay") {
        for (let c = 2; c < 119; c += 13)
          if (
            l[c + 11] === (current.round === "TT" ? "T" : current.round) &&
            /^[1-4]$/.test(l[c + 12]) &&
            l.slice(c + 1, c + 6).trim()
          )
            current.hyMembers!.push({
              number: clean(l.slice(c + 1, c + 6)),
              gender: gender(l[c]),
              leg: +l[c + 12],
            });
      }
    } catch (e) {
      if (code === "B1") throw e;
      if (current && ["G1", "F3"].includes(code))
        current.issue = String((e as Error).message);
      issues.push({
        filename: source.filename,
        line,
        status: "error",
        message: (e as Error).message,
      });
    }
  }
  if (!meet) throw new Error("No meet header found.");
  for (const row of rows)
    if (row.kind === "relay") {
      row.members = [];
      for (const member of row.hyMembers ?? []) {
        const a = athletes.get(
          `${row.team.lscCode}|${row.team.clubCode}|${member.number}|${member.gender}`,
        );
        if (!a) row.issue = "A relay member has no matching swimmer record.";
        else row.members.push({ leg: member.leg, athlete: a });
      }
    }
  return { rows, issues };
}
function parseSdif(
  bytes: Uint8Array,
  source: Omit<FileSource, "line">,
): ParsedFile {
  const lines = new TextDecoder("windows-1252")
    .decode(bytes)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines[0]?.slice(0, 2) !== "A0" || !lines.some((l) => l.startsWith("Z0")))
    throw new Error("A SDIF results file needs its header and terminator.");
  if (lines.some((l) => l.length !== 160))
    throw new Error("SDIF records must contain 160 characters.");
  let meet: FileMeet | undefined,
    team: FileResult["team"] | undefined,
    current: RawRow[] = [],
    lastAthlete: RawAthlete | undefined;
  let memberOrders: Record<string, string> | undefined;
  const rows: RawRow[] = [],
    issues: ParsedFile["issues"] = [],
    athletes = new Map<string, RawAthlete>();
  function remember(a: RawAthlete) {
    const key = `${team?.lscCode}|${team?.clubCode}|${a.member}|${a.last}|${a.first}|${a.dob}`;
    const prior = athletes.get(key);
    if (prior) return prior;
    athletes.set(key, a);
    return a;
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i],
      code = l.slice(0, 2),
      line = i + 1;
    try {
      if (code === "B1") {
        if (meet) throw new Error("A file must describe exactly one meet.");
        meet = {
          name: clean(l.slice(11, 41)),
          startsOn: date(l.slice(121, 129)),
          endsOn: date(l.slice(129, 137)),
        };
      } else if (code === "C1") {
        team = {
          lscCode: clean(l.slice(11, 13)),
          clubCode: clean(l.slice(13, 17)) + clean(l[149]),
          name: clean(l.slice(17, 47)),
        };
        current = [];
        lastAthlete = undefined;
        memberOrders = undefined;
      } else if (code === "D0" || code === "E0") {
        current = [];
        memberOrders = undefined;
        lastAthlete = undefined;
        if (!meet || !team) throw new Error("Missing meet or team header.");
        const relay = code === "E0";
        if (!relay)
          lastAthlete = remember({
            ...name(l.slice(11, 39)),
            member: clean(l.slice(39, 51)),
            dob: optionalDate(l.slice(55, 63)),
            gender: gender(l[65]),
          });
        const distance = +l.slice(relay ? 21 : 67, relay ? 25 : 71),
          stroke = strokes[l[relay ? 25 : 71]];
        for (const [round, offset] of (relay
          ? [
              ["P", 54],
              ["S", 63],
              ["F", 72],
            ]
          : [
              ["P", 97],
              ["S", 106],
              ["F", 115],
            ]) as [Round, number][]) {
          const timing = l.slice(offset, offset + 8).trim();
          if (!timing || timing === "NT") continue;
          const course = courses[l[offset + 8]];
          if (
            !course ||
            !distance ||
            !stroke ||
            (relay
              ? !["6", "7"].includes(l[25])
              : !["1", "2", "3", "4", "5"].includes(l[71]))
          )
            throw new Error("Unsupported event or course.");
          const result = fileTime(timing);
          const row: RawRow = {
            ...base({ ...source, line }, meet, team),
            kind: relay ? "relay" : "swim",
            ...result,
            distance,
            stroke,
            course,
            round,
            athlete: lastAthlete,
            gender: gender(l[relay ? 20 : 65]),
            date: date(l.slice(relay ? 37 : 80, relay ? 45 : 88)),
            eventNumber: clean(l.slice(relay ? 26 : 72, relay ? 30 : 76)),
            ageGroup: ageGroup(
              l.slice(relay ? 30 : 76, relay ? 32 : 78),
              l.slice(relay ? 32 : 78, relay ? 34 : 80),
            ),
            ...(relay
              ? { relayName: clean(l[11]), members: [] }
              : /^\d{1,2}$/.test(l.slice(63, 65).trim())
                ? { ageAtSwim: +l.slice(63, 65) }
                : {}),
          };
          // SDIF attachment U means unattached, even under a club's C1 header.
          if (!relay && l[51] === "U")
            row.issue =
              "Unattached performances are outside the Velocity result scope.";
          current.push(row);
          rows.push(row);
        }
      } else if (code === "F0") {
        if (!current.length || current[0].kind !== "relay")
          throw new Error("Relay member lacks a relay event.");
        lastAthlete = remember({
          ...name(l.slice(22, 50)),
          member: clean(l.slice(50, 62)),
          dob: optionalDate(l.slice(65, 73)),
          gender: gender(l[75]),
        });
        memberOrders = { P: l[76], S: l[77], F: l[78] };
        for (const row of current)
          if (/^[1-4]$/.test(memberOrders[row.round] ?? ""))
            row.members!.push({
              leg: +memberOrders[row.round],
              athlete: lastAthlete,
            });
      } else if (code === "D3" && lastAthlete) {
        const full = clean(l.slice(2, 16));
        if (full) lastAthlete.member = full;
      } else if (code === "G0") {
        const row = current.find((r) => r.round === l[143]);
        if (!row) continue;
        const increment = +l.slice(58, 62),
          sequence = +l[55];
        if (l[62] !== "C" || increment <= 0 || sequence < 1)
          throw new Error("Unsupported split distance or timing convention.");
        if (row.splitIncrement && row.splitIncrement !== increment)
          throw new Error("Split distances use inconsistent increments.");
        row.splitIncrement = increment;
        const leg =
          row.kind === "relay" ? +(memberOrders?.[row.round] ?? 0) : 0;
        if (row.kind === "relay" && ![1, 2, 3, 4].includes(leg))
          throw new Error("Relay splits lack an explicit leg boundary.");
        for (let slot = 0; slot < 10; slot++) {
          const raw = l.slice(63 + slot * 8, 71 + slot * 8).trim();
          if (!raw || /^(?:0+:)?0+(\.00)?$/.test(raw)) continue;
          const localDistance = ((sequence - 1) * 10 + slot + 1) * increment;
          if (leg && localDistance > row.distance / 4)
            throw new Error("A split falls outside its relay leg.");
          row.splits.push({
            distance:
              (leg ? ((leg - 1) * row.distance) / 4 : 0) + localDistance,
            cumulativeMs: fileTime(raw).timeMs,
          });
        }
      }
    } catch (e) {
      if (code === "B1") throw e;
      for (const row of current) row.issue = (e as Error).message;
      issues.push({
        filename: source.filename,
        line,
        status: "error",
        message: (e as Error).message,
      });
    }
  }
  if (!meet) throw new Error("No meet header found.");
  for (const row of rows) {
    row.splits.sort((a, b) => a.distance - b.distance);
    let previous = 0,
      previousDistance = 0;
    row.splits = row.splits.filter(
      (s, i, all) =>
        i === 0 ||
        s.distance !== all[i - 1].distance ||
        s.cumulativeMs !== all[i - 1].cumulativeMs,
    );
    for (const split of row.splits) {
      if (split.distance - previousDistance === row.splitIncrement)
        split.lapMs = split.cumulativeMs - previous;
      previous = split.cumulativeMs;
      previousDistance = split.distance;
    }
    row.splitCoverage = row.splits.length
      ? row.splits.at(-1)?.distance === row.distance &&
        previous === row.timeMs &&
        row.splits.length * (row.splitIncrement ?? 0) === row.distance
        ? "complete"
        : "partial"
      : "unavailable";
    if (
      row.status === "OK" &&
      row.splits.at(-1)?.distance === row.distance &&
      previous !== row.timeMs
    )
      row.issue = "Final split disagrees with the race total.";
    try {
      validateRaceSplits(row as unknown as Record<string, unknown>);
    } catch (e) {
      row.issue = (e as Error).message;
    }
  }
  return { rows, issues };
}
function pairingKey(r: RawRow) {
  const owner =
    r.kind === "relay"
      ? [r.team.lscCode, r.team.clubCode, r.relayName, r.gender].join("|")
      : r.athlete?.member?.slice(0, 12) ||
        [
          r.athlete?.first,
          r.athlete?.last,
          r.athlete?.dob,
          r.athlete?.gender,
        ].join("|");
  return JSON.stringify([
    r.kind,
    owner,
    r.meet.startsOn,
    r.date,
    r.distance,
    r.stroke,
    r.round,
    r.eventNumber,
  ]);
}
const normalizedName = (value: string) =>
  value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
function sameAthlete(a: RawAthlete | undefined, b: RawAthlete | undefined) {
  if (!a || !b || a.gender !== b.gender || (a.dob && b.dob && a.dob !== b.dob))
    return false;
  if (a.member && b.member)
    return a.member.slice(0, 12) === b.member.slice(0, 12);
  return (
    !!a.dob &&
    a.dob === b.dob &&
    !!a.first &&
    !!a.last &&
    normalizedName(a.first) === normalizedName(b.first) &&
    normalizedName(a.last) === normalizedName(b.last)
  );
}
export async function parseMeetFiles(
  files: Array<{ name: string; bytes: Uint8Array }>,
): Promise<ParsedFile> {
  if (
    !files.length ||
    files.length > 20 ||
    files.reduce((n, f) => n + f.bytes.length, 0) > maxBytes
  )
    throw new Error("Choose up to 20 files totaling no more than 20 MB.");
  const members: typeof files = [];
  let expanded = 0,
    entries = 0;
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      const directory = zipEntries(file.bytes),
        checks = new Map<string, (typeof directory)[number]>();
      let position = 0;
      const unzipped = unzipSync(file.bytes, {
        filter(info) {
          const expected = directory[position++];
          if (
            !expected ||
            expected.size !== info.originalSize ||
            checks.has(info.name)
          )
            throw new Error("Ambiguous or inconsistent ZIP directory.");
          checks.set(info.name, expected);
          if (
            ++entries > 250 ||
            info.originalSize > maxExpanded ||
            (expanded += info.originalSize) > maxExpanded
          )
            throw new Error(
              "ZIP exceeds the 250-entry / 100 MB extraction limit.",
            );
          if (
            info.name.includes("..") ||
            info.name.startsWith("/") ||
            info.name.includes("\\")
          )
            throw new Error("Unsafe ZIP member path.");
          return /\.(hy3|cl2|sd3)$/i.test(info.name);
        },
      });
      for (const [name, bytes] of Object.entries(unzipped)) {
        verifyZipEntry(bytes, checks.get(name)!);
        members.push({ name: `${file.name}/${name}`, bytes });
      }
      if (!Object.keys(unzipped).length)
        throw new Error("ZIP contains no HY3, CL2, or SD3 result files.");
    } else if (/\.(hy3|cl2|sd3)$/i.test(file.name)) members.push(file);
    else throw new Error("Choose HY3, CL2, SD3, or ZIP files.");
  }
  const result: ParsedFile = { rows: [], issues: [] },
    unique = new Set<string>();
  for (const member of members) {
    const checksum = await sha(member.bytes);
    if (unique.has(checksum)) continue;
    unique.add(checksum);
    const format = member.name
      .split(".")
      .at(-1)!
      .toLowerCase() as FileSource["format"];
    const source = { filename: member.name, sha256: checksum, format };
    const parsed =
      format === "hy3"
        ? parseHy3(member.bytes, source)
        : parseSdif(member.bytes, source);
    result.rows.push(...parsed.rows);
    result.issues.push(...parsed.issues);
  }
  const hy = result.rows.filter((r) => r.source.format === "hy3") as RawRow[];
  const sd = result.rows.filter((r) => r.source.format !== "hy3") as RawRow[];
  const used = new Set<RawRow>();
  const index = (rows: RawRow[]) => {
    const map = new Map<string, RawRow[]>();
    for (const r of rows) {
      const key = pairingKey(r);
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return map;
  };
  const hyIndex = index(hy),
    sdIndex = index(sd);
  for (const row of hy) {
    const companion = sdIndex.get(pairingKey(row)) ?? [];
    if (companion.length) {
      const other = companion[0];
      companion.forEach((r) => used.add(r));
      if (
        companion.length !== 1 ||
        hyIndex.get(pairingKey(row))!.length !== 1 ||
        other.timeMs !== row.timeMs ||
        other.course !== row.course ||
        other.meet.endsOn !== row.meet.endsOn ||
        normalizedName(row.meet.name.slice(0, 30)) !==
          normalizedName(other.meet.name.slice(0, 30)) ||
        (row.kind === "swim" && !sameAthlete(row.athlete, other.athlete)) ||
        (other.status !== row.status &&
          !(row.status === "NS" && other.status === "DFS"))
      )
        row.issue = "Paired exports disagree or contain ambiguous occurrences.";
      else if (other.issue) row.issue = other.issue;
      else {
        row.source.companion = {
          filename: other.source.filename,
          sha256: other.source.sha256,
          line: other.source.line,
        };
        row.status = other.status;
        if (
          row.hySplits?.length &&
          JSON.stringify(row.hySplits) !==
            JSON.stringify(other.splits.map((s) => s.cumulativeMs))
        )
          row.issue = "Paired split times disagree.";
        else {
          row.splits = other.splits;
          row.splitCoverage = other.splitCoverage;
        }
        if (row.kind === "relay") {
          const membersMatch =
            row.members?.length === other.members?.length &&
            (row.members ?? []).every((m) =>
              other.members?.some(
                (n) => n.leg === m.leg && sameAthlete(n.athlete, m.athlete),
              ),
            );
          if (!membersMatch) row.issue = "Paired relay lineups disagree.";
        }
      }
    } else if (row.hySplits?.length)
      result.issues.push({
        filename: row.source.filename,
        line: row.source.line,
        status: "skipped",
        message:
          "Split distances are not explicit in HY3; supply its CL2 companion to retain verified splits.",
      });
  }
  const all = [...hy, ...sd.filter((r) => !used.has(r))];
  const athleteCache = new Map<RawAthlete, FileAthlete>();
  async function finalize(a: RawAthlete): Promise<FileAthlete> {
    const cached = athleteCache.get(a);
    if (cached) return cached;
    const next: FileAthlete = {
      first: a.first,
      last: a.last,
      gender: a.gender,
      ...(a.dob ? { dob: a.dob } : {}),
      ...(a.member
        ? {
            memberHash: (await sha(new TextEncoder().encode(a.member))).slice(
              0,
              24,
            ),
          }
        : {}),
    };
    athleteCache.set(a, next);
    return next;
  }
  result.rows = [];
  for (const raw of all) {
    const {
      hySplits: _splits,
      hyMembers: _members,
      splitIncrement: _increment,
      ...row
    } = raw;
    void _splits;
    void _members;
    void _increment;
    if (row.athlete) row.athlete = await finalize(row.athlete);
    if (row.members)
      row.members = await Promise.all(
        row.members.map(async (m) => ({
          ...m,
          athlete: await finalize(m.athlete),
        })),
      );
    result.rows.push(row);
  }
  return result;
}
