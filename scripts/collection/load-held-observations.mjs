import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { assertCollectionTarget } from "./target.mjs";

const sourceUrl = "https://www.gomotionapp.com/team/ievs/controller/cms/admin/index";
const maxRows = 250;
const maxBytes = 1_500_000;
const rawFields = [
  "Athlete Name", "Relay Team", "LSC-Team", "Competitive Category", "Date",
  "Age Group", "Event Age", "Age", "Distance", "Stroke", "Final", "Final Position",
  "Prelim", "Trial", "Swim-off",
];
const roundColumns = { F: "Final", P: "Prelim", TT: "Trial", S: "Swim-off" };
const courseCodes = { Y: "SCY", S: "SCM", L: "LCM" };
const swimStrokes = { Free: "FR", Back: "BK", Breast: "BR", Fly: "FL", IM: "IM" };
const relayStrokes = { "Free Relay": "FR-R", MR: "MED-R" };
const categories = { Female: "F", Male: "M", Mixed: "X" };
const allowedDistances = {
  swim: new Set([25, 50, 100, 200, 400, 500, 800, 1000, 1500, 1650]),
  relay: new Set([100, 200, 400, 800]),
};
const statuses = new Set(["DQ", "DFS", "NS", "DNF", "SCR"]);
const factFields = new Set(["timeMs", "status", "gender", "ageAtSwim", "isOfficial"]);

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function isCompleteMemberId(value) {
  if (/^[A-Za-z0-9]{14}$/.test(value)) return true;
  // Legacy IDs use right-padded name codes and * for an unknown middle initial.
  // Hash the literal ID; its numeric prefix is not used to infer a birthday.
  return value.length === 14 && /^\d{6}$/.test(value.slice(0, 6)) &&
    /^[A-Za-z]+\**$/.test(value.slice(6, 9)) &&
    /^[A-Za-z*]$/.test(value[9]) &&
    /^[A-Za-z]+\**$/.test(value.slice(10));
}

async function readReceipt(directory, filename, checksum) {
  const contents = await readFile(join(directory, filename));
  if (checksum && sha256(contents) !== checksum) {
    throw new Error(`Checksum differs from the audit for ${basename(filename)}.`);
  }
  return JSON.parse(contents);
}

function isoDate(value) {
  if (typeof value !== "string") return undefined;
  const usa = /^([0-9]{1,2})\/([0-9]{1,2})\/([0-9]{4})$/.exec(value);
  const date = usa
    ? `${usa[3]}-${usa[1].padStart(2, "0")}-${usa[2].padStart(2, "0")}`
    : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) return undefined;
  return new Date(date).toISOString().slice(0, 10) === date ? date : undefined;
}

function parseTime(value) {
  const displayed = String(value ?? "").trim();
  if (statuses.has(displayed)) return { sourceStatus: displayed };
  const timed = /^((?:\d{1,3}:){0,2}\d{1,4})\.(\d{1,3})\s*([YSL])?(?:\s+(L))?$/.exec(displayed);
  if (!timed) return {};
  const seconds = timed[1].split(":").reduce((total, part) => total * 60 + Number(part), 0);
  const milliseconds = seconds * 1000 + Number(timed[2].padEnd(3, "0"));
  return {
    suffixCourse: courseCodes[timed[3]],
    leadOffMarker: Boolean(timed[4]),
    timeMs: milliseconds > 0 && milliseconds < 1_000_000_000 ? milliseconds : undefined,
    sourceStatus: milliseconds > 0 && milliseconds < 1_000_000_000 ? "OK" : null,
  };
}

function observedFields(raw) {
  const fields = Object.fromEntries(rawFields.filter((key) => Object.hasOwn(raw, key)).map((key) => {
    const value = raw[key];
    if (typeof value !== "string" && typeof value !== "number" && value !== null) {
      throw new Error("A GoMotion display field has an unexpected format.");
    }
    return [key, value];
  }));
  if (typeof raw.Athletes === "string" && raw.Athletes.trim()) {
    // The second line of each relay entry contains private membership data.
    const names = raw.Athletes.trim().split(/\r?\n\r?\n/).map((entry) => {
      const lines = entry.split(/\r?\n/);
      const name = lines[0].trim();
      if (lines.length !== 2 || !/^[^\d,/@:]+,[^\d,/@:]+$/u.test(name)) {
        throw new Error("A GoMotion relay entry has an unexpected format.");
      }
      return name;
    });
    fields.Athletes = names.join("\n");
  }
  return fields;
}

function normalizeObservation(hold, capture, wrapper, kind, round) {
  const raw = wrapper.row;
  const clubCode = { "IE-VS": "VS", "IE-CUDA": "CUDA" }[raw["LSC-Team"]];
  if (!clubCode || typeof capture.meet.name !== "string" || !capture.meet.name.trim()) {
    throw new Error(`Source meet or club is missing at ${hold.locator}.`);
  }
  const member = String(raw["#ID"] ?? "").trim();
  const memberIdHash = kind === "swim" && isCompleteMemberId(member)
    ? sha256(member).slice(0, 24)
    : null;
  const startDate = isoDate(capture.meet.startsOn);
  const endDate = isoDate(capture.meet.endsOn);
  const roundDetails = wrapper.roundDetails?.[round];
  const explicitRoundDate = isoDate(roundDetails?.date ?? roundDetails?.raceDate);
  const rowDate = isoDate(raw.Date);
  const roundCount = Object.keys(roundColumns).filter((code) => {
    const value = String(raw[roundColumns[code]] ?? "").trim();
    return (value && !["-", "—", "N/A"].includes(value)) || wrapper.roundDetails?.[code];
  }).length;
  const day = explicitRoundDate
    ?? (roundCount === 1 ? rowDate : undefined)
    ?? (startDate === endDate && (!raw.Date || rowDate === startDate) ? startDate : undefined);
  const raceDate = round !== "none" && day && startDate && endDate && day >= startDate && day <= endDate ? day : undefined;
  const { sourceStatus, timeMs, suffixCourse, leadOffMarker } = parseTime(raw[roundColumns[round]]);
  const courseEvidence = [roundDetails?.course, suffixCourse, capture.meet.course].filter(Boolean);
  const course = courseEvidence[0];
  const courseMatches = courseEvidence.every((value) => value === course);
  const stroke = (kind === "relay" ? relayStrokes : swimStrokes)[raw.Stroke];
  const distance = Number(raw.Distance);
  const eventCode = stroke && courseMatches && Object.values(courseCodes).includes(course) &&
    allowedDistances[kind].has(distance) ? `${distance}_${stroke}_${course}` : undefined;
  const finalPlace = String(raw["Final Position"] ?? "").trim();
  const awardedFinalPlace = round === "F" && sourceStatus === "OK" && /^[1-9]\d{0,4}$/.test(finalPlace)
    ? Number(finalPlace)
    : undefined;

  return {
    sourceMeetId: capture.meetId,
    workbookSha256: capture.sha256,
    kind,
    sourceRow: wrapper.sourceRow,
    round,
    clubCode,
    holdReason: hold.reason,
    sourceStatus: sourceStatus ?? null,
    memberIdHash,
    sourceUrl,
    capturedAt: capture.capturedAt,
    observed: {
      meetName: capture.meet.name,
      raceDate,
      startDate,
      endDate,
      eventCode,
      name: kind === "swim" ? raw["Athlete Name"] : undefined,
      relayName: kind === "relay" ? raw["Relay Team"] : undefined,
      category: categories[raw["Competitive Category"]],
      timeMs,
      awardedFinalPlace,
      isOfficial: typeof roundDetails?.isOfficial === "boolean" ? roundDetails.isOfficial : undefined,
      ageGroup: raw["Age Group"] || undefined,
      // Event Age is the report's eligibility age. Race-day age needs separate evidence.
      eventAge: Number.isInteger(raw["Event Age"]) ? raw["Event Age"] : undefined,
      leadOff: Boolean(leadOffMarker) || hold.reason.startsWith("Relay lead-off "),
      workbookFile: capture.file,
      differingFields: hold.differingFields?.filter((field) => factFields.has(field)),
      raw: observedFields(raw),
    },
  };
}

async function verifyWorkbooks(archiveRoot, captures) {
  const paths = await readdir(archiveRoot, { recursive: true });
  const files = new Map();
  for (const path of paths) {
    const filename = basename(path);
    if (!captures.has(filename)) continue;
    const pathsForFile = files.get(filename) ?? [];
    pathsForFile.push(join(archiveRoot, path));
    files.set(filename, pathsForFile);
  }
  for (const [filename, checksum] of captures) {
    let confirmed = false;
    for (const path of files.get(filename) ?? []) {
      if (sha256(await readFile(path)) === checksum) {
        confirmed = true;
        break;
      }
    }
    if (!confirmed) throw new Error(`Missing the checksummed source workbook ${filename}.`);
  }
}

export async function prepareHeldObservations(auditPath, archiveRoot) {
  const directory = dirname(resolve(auditPath));
  const audit = await readReceipt(directory, basename(auditPath));
  const holdFile = audit.normalizedSourceReceipt;
  const coverageFile = audit.sourceCoverageReceipt;
  if (![holdFile, coverageFile].every((entry) => entry && typeof entry.file === "string" &&
    /^[a-f0-9]{64}$/.test(entry.sha256))) {
    throw new Error("The audit must name checksummed hold and coverage receipts.");
  }
  const captureDirectory = join(directory, "acquisition-confirmed");
  const [holdReceipt, coverage, captures] = await Promise.all([
    readReceipt(directory, basename(holdFile.file), holdFile.sha256),
    readReceipt(captureDirectory, basename(coverageFile.file), coverageFile.sha256),
    readReceipt(captureDirectory, "joined-scoped-captures.json"),
  ]);
  if (
    !Array.isArray(holdReceipt.holds) ||
    holdReceipt.holds.length !== audit.heldOrNonfinishSourceObservations ||
    holdReceipt.holds.length !== holdReceipt.distinctHeldSourceObservations ||
    !Array.isArray(captures) || coverage.tabsWithGoMotionVelocityOrBarracuda !== captures.length
  ) {
    throw new Error("The audit counts do not reconcile with the source receipts.");
  }
  const captureRows = new Map();
  for (const capture of captures) {
    const kind = { individuals: "swim", relays: "relay" }[capture.tab];
    if (!kind || !/^\d+$/.test(capture.meetId) || !/^[a-f0-9]{64}$/.test(capture.sha256) ||
      !/^[A-Za-z0-9_.-]+\.xls$/.test(capture.file) || !Number.isFinite(Date.parse(capture.capturedAt))) {
      throw new Error("A captured workbook lacks its source metadata.");
    }
    const key = `meet/${capture.meetId}/${kind}/xls/${capture.sha256.slice(0, 24)}`;
    const rows = new Map(capture.rows.map((row) => [row.sourceRow, row]));
    if (captureRows.has(key) || rows.size !== capture.rows.length) {
      throw new Error(`The captured workbook has an ambiguous source locator ${key}.`);
    }
    captureRows.set(key, { capture, rows });
  }
  const seen = new Set();
  const workbooks = new Map();
  const reasons = new Map();
  const observations = holdReceipt.holds.map((hold) => {
    const locator = /^(meet\/\d+\/(swim|relay)\/xls\/[a-f0-9]{24})\/([1-9]\d*)(?:\/(F|P|S|TT))?$/.exec(hold.locator);
    if (!locator || seen.has(hold.locator) || !Object.hasOwn(audit.holdReasons, hold.reason)) {
      throw new Error("The hold receipt contains a duplicate, unknown reason, or invalid locator.");
    }
    const source = captureRows.get(locator[1]);
    const wrapper = source?.rows.get(Number(locator[3]));
    if (!wrapper) throw new Error(`No captured workbook row matches ${hold.locator}.`);
    seen.add(hold.locator);
    const { capture } = source;
    if (workbooks.has(capture.file) && workbooks.get(capture.file) !== capture.sha256) {
      throw new Error("One workbook filename refers to differing source checksums.");
    }
    workbooks.set(capture.file, capture.sha256);
    reasons.set(hold.reason, (reasons.get(hold.reason) ?? 0) + 1);
    const observation = normalizeObservation(hold, capture, wrapper, locator[2], locator[4] ?? "none");
    if (hold.reason.startsWith("Source reports ") &&
      !hold.reason.endsWith(`(${observation.sourceStatus})`)) {
      throw new Error(`The source result status disagrees with the hold at ${hold.locator}.`);
    }
    return observation;
  });
  if (Object.entries(audit.holdReasons).some(([reason, count]) => reasons.get(reason) !== count)) {
    throw new Error("Source hold counts differ from the audit.");
  }
  await verifyWorkbooks(archiveRoot ?? dirname(directory), workbooks);
  return { observations, verifiedWorkbooks: workbooks.size };
}

export function splitObservationRequests(observations) {
  const requests = [];
  let chunk = [];
  let bytes = 2;
  for (const observation of observations) {
    const rowBytes = Buffer.byteLength(JSON.stringify(observation));
    if (rowBytes + 2 > maxBytes) throw new Error("A held observation exceeds the request size limit.");
    if (chunk.length >= maxRows || bytes + 1 + rowBytes > maxBytes) {
      requests.push(chunk);
      chunk = [];
      bytes = 2;
    }
    bytes += rowBytes + Number(chunk.length > 0);
    chunk.push(observation);
  }
  if (chunk.length) requests.push(chunk);
  return requests;
}

export async function stageHeldObservations({ client, workerToken, requests }) {
  const totals = { inserted: 0, duplicates: 0 };
  for (const [index, observations] of requests.entries()) {
    const { data, error } = await client.rpc("stage_velocity_held_observations", {
      worker_token: workerToken,
      observations,
    }).abortSignal(AbortSignal.timeout(30_000));
    if (error) {
      const code = /^[A-Z\d]{5}$/.test(error.code ?? "") ? ` (${error.code})` : "";
      throw new Error(`Upload stopped at request ${index + 1} of ${requests.length}${code}. Rerun the same audited input to resume.`);
    }
    if (!data || !Object.keys(totals).every((key) => Number.isSafeInteger(data[key]) && data[key] >= 0) ||
      data.inserted + data.duplicates !== observations.length) {
      throw new Error("The archive returned an unexpected receipt. Rerun the same audited input to resume.");
    }
    totals.inserted += data.inserted;
    totals.duplicates += data.duplicates;
  }
  return totals;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean" },
      "dry-run": { type: "boolean" },
      "archive-root": { type: "string" },
      project: { type: "string" },
    },
  });
  if (values.help) {
    console.log("node --env-file-if-exists=.env.collection.local scripts/collection/load-held-observations.mjs <final-audit.json> [--archive-root <originals-directory>] [--dry-run | --project <exact-project>]");
    return;
  }
  if (positionals.length !== 1) throw new Error("Supply one final archive audit path. Use --help for options.");
  const { observations, verifiedWorkbooks } = await prepareHeldObservations(positionals[0], values["archive-root"]);
  const requests = splitObservationRequests(observations);
  const summary = {
    observations: observations.length,
    sourceOutcomes: observations.filter((row) => statuses.has(row.sourceStatus)).length,
    meetCount: new Set(observations.map((row) => row.sourceMeetId)).size,
    verifiedWorkbooks,
    requests: requests.length,
  };
  if (values["dry-run"]) {
    console.log(JSON.stringify({ ...summary, dryRun: true }));
    return;
  }
  const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
    VELOCITY_COLLECTOR_TOKEN: workerToken } = process.env;
  if (!values.project || !url || !key || !workerToken) {
    throw new Error("Set the Supabase URL, publishable key, and collector token and pass --project.");
  }
  assertCollectionTarget({ evidence: { project: values.project } }, url);
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const result = await stageHeldObservations({ client, workerToken, requests });
  console.log(JSON.stringify({ ...summary, ...result }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
