import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

// Read-only smoke/load check, not a production capacity certification.
// RPC mode measures the database without the app cache. App mode measures the
// authenticated /api/times route; supply a Cookie header in a private file.
// Never run alongside fixture writers or a production import/moderation run.
const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "rpc" },
    concurrency: { type: "string", default: "8,16" },
    waves: { type: "string", default: "3" },
    "timeout-ms": { type: "string", default: "15000" },
    "pause-ms": { type: "string", default: "1000" },
    workdir: { type: "string" },
    "status-json": { type: "string" },
    "app-url": { type: "string" },
    "cookie-file": { type: "string" },
    "server-log": { type: "string" },
    "athlete-ids": { type: "string" },
    output: { type: "string" },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`Usage: node scripts/collection/times-concurrency-check.mjs [options]

  --mode rpc|app              Database RPCs (default) or authenticated app route
  --concurrency 8,16          Sequential stages; maximum 32 simultaneous requests
  --waves 3                  Waves per stage (1–10); stops after a failed wave
  --timeout-ms 15000          Per-request deadline (1000–30000)
  --pause-ms 1000             Pause between waves (0–5000)
  --workdir PATH             Local Supabase CLI workdir
  --status-json PATH         Private Supabase status JSON instead of invoking CLI
  --app-url URL              App origin (default VELOCITY_TEST_URL or :3001)
  --cookie-file PATH         Private text file containing an app Cookie header
  --server-log PATH          Optional local app log for completed DB-read counts
  --athlete-ids ID,ID         Optional My Times cases; identifiers never printed
  --output PATH              Write the safe JSON summary and response hashes

RPC credentials can alternatively be supplied as VELOCITY_LOAD_SUPABASE_URL and
VELOCITY_LOAD_PUBLISHABLE_KEY. Hosted targets require
VELOCITY_ALLOW_HOSTED_READ_TEST=1 after the operator approves the bounded run.
Only publishable/anon keys are accepted. No records or auth users are written.

Each stage includes identical-query and mixed-filter waves. Serial references
are checked after the bursts so the harness does not deliberately warm every
app cache first. Arrays retain their ordering; expiresAt and recordsUpdatedAt
are excluded from hashes. Existing caches may already be warm. Empty results
are reported: use representative synthetic data before interpreting timings.`);
  process.exit(0);
}

function boundedInteger(value, name, min, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return number;
}

function targetUrl(value) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new Error(
      "Target must be an HTTP(S) URL without embedded credentials",
    );
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (!local && process.env.VELOCITY_ALLOW_HOSTED_READ_TEST !== "1")
    throw new Error("Hosted load requires VELOCITY_ALLOW_HOSTED_READ_TEST=1");
  if (!local && url.protocol !== "https:")
    throw new Error("Hosted load requires HTTPS");
  return url.origin;
}

const concurrency = values.concurrency
  .split(",")
  .map((value) => boundedInteger(value, "concurrency", 1, 32));
if (concurrency.length > 4) throw new Error("At most four concurrency stages");
const waves = boundedInteger(values.waves, "waves", 1, 10);
const timeoutMs = boundedInteger(
  values["timeout-ms"],
  "timeout-ms",
  1000,
  30000,
);
const pauseMs = boundedInteger(values["pause-ms"], "pause-ms", 0, 5000);
if (!["rpc", "app"].includes(values.mode))
  throw new Error("Mode must be rpc or app");

let target;
let headers;
if (values.mode === "rpc") {
  let config;
  if (process.env.VELOCITY_LOAD_SUPABASE_URL) {
    config = {
      API_URL: process.env.VELOCITY_LOAD_SUPABASE_URL,
      PUBLISHABLE_KEY: process.env.VELOCITY_LOAD_PUBLISHABLE_KEY,
    };
  } else {
    config = JSON.parse(
      values["status-json"]
        ? readFileSync(values["status-json"], "utf8")
        : execFileSync(
            "supabase",
            [
              "status",
              "--output",
              "json",
              ...(values.workdir ? ["--workdir", values.workdir] : []),
            ],
            { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
          ),
    );
  }
  target = targetUrl(config.API_URL);
  const key = config.PUBLISHABLE_KEY ?? config.ANON_KEY;
  if (!key || key.startsWith("sb_secret_"))
    throw new Error("Supply a publishable or anon API key");
  if (!key.startsWith("sb_publishable_")) {
    let role;
    try {
      role = JSON.parse(
        Buffer.from(key.split(".")[1], "base64url").toString(),
      ).role;
    } catch {
      throw new Error("API key is not a publishable key or anon JWT");
    }
    if (role !== "anon")
      throw new Error("Only the anon database role may be tested");
  }
  headers = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_publishable_"))
    headers.Authorization = `Bearer ${key}`;
} else {
  target = targetUrl(
    values["app-url"] ??
      process.env.VELOCITY_TEST_URL ??
      "http://127.0.0.1:3001",
  );
  if (!values["cookie-file"])
    throw new Error("App mode requires --cookie-file");
  const cookie = readFileSync(values["cookie-file"], "utf8").trim();
  if (!cookie || /[\r\n]/.test(cookie))
    throw new Error("Cookie file must contain one Cookie header value");
  headers = { Cookie: cookie };
}

const cases = [
  ["women-100-free", "rankings", { event: "100_FR", genders: ["F"] }],
  ["men-100-free", "rankings", { event: "100_FR", genders: ["M"] }],
  ["women-50-free", "rankings", { event: "50_FR", genders: ["F"] }],
  ["men-200-im", "rankings", { event: "200_IM", genders: ["M"] }],
  [
    "women-13-14",
    "rankings",
    { event: "100_FR", genders: ["F"], ageGroups: ["13-14"] },
  ],
  [
    "all-performances",
    "rankings",
    { event: "100_FR", mode: "performances", genders: ["F", "M", "X"] },
  ],
  [
    "women-year-filter",
    "rankings",
    { event: "100_FR", genders: ["F"], year: "2026" },
  ],
  [
    "women-long-course",
    "rankings",
    { event: "50_FR", course: "LCM", genders: ["F"] },
  ],
  [
    "men-short-course-meters",
    "rankings",
    { event: "50_BK", course: "SCM", genders: ["M"] },
  ],
  ["ranking-years", "ranking_years", {}],
  ["record-board", "records_board", {}],
].map(([label, kind, input]) => ({
  label,
  kind,
  input: {
    team: "velocity-swimming",
    ...(kind === "rankings"
      ? { course: "SCY", mode: "bests", limit: 25, offset: 0 }
      : {}),
    ...input,
  },
}));
const athletes = (values["athlete-ids"] ?? "").split(",").filter(Boolean);
if (athletes.length > 8 || athletes.some((id) => id.length > 200))
  throw new Error("At most eight athlete IDs, each at most 200 characters");
athletes.forEach((athleteId, index) =>
  cases.push({
    label: `my-times-${index + 1}`,
    kind: "my_times",
    input: {
      team: "velocity-swimming",
      athleteId,
      course: "SCY",
      rankPeriod: "all",
    },
  }),
);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

function responseHash(data) {
  const content = { ...data };
  delete content.expiresAt;
  delete content.recordsUpdatedAt;
  return createHash("sha256")
    .update(JSON.stringify(canonical(content)))
    .digest("hex");
}

function requestFor(item) {
  if (values.mode === "app") {
    const url = new URL("/api/times", target);
    url.searchParams.set("view", item.kind);
    for (const [key, value] of Object.entries(item.input))
      if (key !== "team")
        url.searchParams.set(
          key,
          Array.isArray(value) ? value.join(",") : String(value),
        );
    return [url, { headers }];
  }
  const rpc =
    {
      ranking_years: "ies_times_ranking_years",
      records_board: "ies_team_records_board",
      my_times: "ies_my_times_all_time",
    }[item.kind] ?? "ies_times_query";
  return [
    new URL(`/rest/v1/rpc/${rpc}`, target),
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...(rpc === "ies_times_query" ? { query_kind: item.kind } : {}),
        input: item.input,
      }),
    },
  ];
}

const observed = new Map();
const coverage = new Map();
function databaseReads() {
  if (!values["server-log"]) return undefined;
  return (
    readFileSync(values["server-log"], "utf8").match(
      /\[velocity:times\] database read completed/g,
    )?.length ?? 0
  );
}
async function read(item) {
  const start = performance.now();
  let status = null;
  try {
    const [url, init] = requestFor(item);
    const response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    status = response.status;
    const data = await response.json();
    if (!response.ok) {
      const code = /^[\w-]{1,40}$/.test(data.code ?? "")
        ? data.code
        : "http_error";
      return {
        label: item.label,
        ms: performance.now() - start,
        status,
        error: code,
      };
    }
    const list =
      item.kind === "rankings"
        ? data.rows
        : item.kind === "records_board"
          ? data.races
          : item.kind === "my_times"
            ? data.myTimes?.events
            : data.years;
    if (!Array.isArray(list)) {
      return {
        label: item.label,
        ms: performance.now() - start,
        status,
        error: "invalid_response_shape",
      };
    }
    const hash = responseHash(data);
    const previous = observed.get(item.label);
    observed.set(item.label, previous ?? hash);
    coverage.set(item.label, {
      total: data.total ?? null,
      returned:
        data.rows?.length ??
        data.races?.length ??
        data.myTimes?.events?.length ??
        data.years?.length ??
        null,
      hash: previous ?? hash,
    });
    return {
      label: item.label,
      ms: performance.now() - start,
      status,
      ...(previous && previous !== hash ? { error: "response_changed" } : {}),
    };
  } catch (error) {
    return {
      label: item.label,
      ms: performance.now() - start,
      status,
      error: ["TimeoutError", "AbortError"].includes(error.name)
        ? "timeout"
        : "transport_or_json_error",
    };
  }
}

function summarize(results) {
  const timings = results.map((result) => result.ms).sort((a, b) => a - b);
  const percentile = (p) =>
    Math.round(timings[Math.max(0, Math.ceil(timings.length * p) - 1)] ?? 0);
  return {
    requests: results.length,
    failures: results.filter((result) => result.error).length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: percentile(1),
    errors: results
      .filter((result) => result.error)
      .map(({ label, status, error }) => ({ label, status, error })),
  };
}

const report = {
  mode: values.mode,
  target,
  startedAt: new Date().toISOString(),
  waves,
  stages: [],
};
let failed = false;
for (const count of concurrency) {
  for (const pattern of ["identical", "mixed"]) {
    const readsBefore = databaseReads();
    const results = [];
    for (let wave = 0; wave < waves; wave++) {
      const batch = await Promise.all(
        Array.from({ length: count }, (_, i) =>
          read(
            cases[
              pattern === "identical" ? 0 : (wave * count + i) % cases.length
            ],
          ),
        ),
      );
      results.push(...batch);
      if (batch.some((result) => result.error)) {
        failed = true;
        break;
      }
      if (pauseMs) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
    const stage = {
      concurrency: count,
      pattern,
      ...summarize(results),
      ...(readsBefore === undefined
        ? {}
        : { databaseReads: databaseReads() - readsBefore }),
    };
    report.stages.push(stage);
    console.log(JSON.stringify(stage));
    if (failed) break;
  }
  if (failed) break;
}

if (!failed) {
  const references = [];
  for (const item of cases) references.push(await read(item));
  report.serialReference = summarize(references);
  failed = references.some((result) => result.error);
}
report.coverage = Object.fromEntries(coverage);
report.finishedAt = new Date().toISOString();
report.passed = !failed;
if (values.output)
  writeFileSync(values.output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
if (failed) process.exitCode = 1;
