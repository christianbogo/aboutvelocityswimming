import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

const workdir = process.env.VELOCITY_IMPORT_TEST_WORKDIR ?? ".";
const config = readFileSync(join(workdir, "supabase/config.toml"), "utf8");
const project = config.match(/^project_id = "([a-zA-Z0-9_-]+)"/m)?.[1];
assert.ok(project);
const status = JSON.parse(execFileSync("supabase", ["status", "--workdir", workdir, "--output", "json"], {
  encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
}));
assert.match(status.API_URL, /^http:\/\/127\.0\.0\.1:\d+$/, "Import tests require a loopback Supabase project.");
const client = (key = status.PUBLISHABLE_KEY) => createClient(status.API_URL, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const admin = client(status.SERVICE_ROLE_KEY);
const anon = client();
const token = randomUUID();
const prefix = `velocity-import-${randomUUID()}`;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `${sql(JSON.stringify(value))}::jsonb`;
const write = (path, data) => `select private.put_record(${sql(path)}, ${json(data)});`;
function db(statement) {
  return execFileSync("docker", ["exec", "-i", `supabase_db_${project}`, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt"], {
    input: statement, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

async function rpc(c, name, args) {
  const result = await c.rpc(name, args).abortSignal(AbortSignal.timeout(15000));
  assert.ifError(result.error);
  return result.data;
}

function batch(label, rows, division = "times") {
  return {
    division, rows, sourceUrl: `https://example.test/imports/${prefix}/${label}`,
    capturedAt: "2026-11-10T15:00:00Z", coverage: "partial", sha256: digest(`${prefix}/${label}`), sourceScope: prefix,
  };
}

const athlete = { id: `${prefix}-swimmer`, name: { first: "Synthetic", last: "Swimmer" }, gender: "F", status: "active" };
const team = { id: "velocity-swimming", name: "Velocity Swimming", lscCode: "IE", clubCode: "VS" };
const meet = { id: `${prefix}-meet`, name: `${prefix} Synthetic Imports Meet`, dates: { startDate: "2026-11-10", endDate: "2026-11-10" } };
const earlierMeet = { id: `${prefix}-prior`, name: `${prefix} Prior Imports Meet`, dates: { startDate: "2026-10-10", endDate: "2026-10-10" } };
const earlier = {
  id: `${prefix}-earlier`, athleteId: athlete.id, teamId: team.id, eventCode: "100_FR_SCY", course: "SCY", distance: 100,
  stroke: "FR", round: "F", gender: "F", ageAtSwim: 15, ageGroup: "15-16", timeMs: 63000,
  status: "OK", isOfficial: true, isRelay: false,
  meet: { id: earlierMeet.id, date: earlierMeet.dates.startDate, name: earlierMeet.name },
};
const faster = { ...earlier, id: `${prefix}-faster`, timeMs: 55000, meet: { id: meet.id, date: meet.dates.startDate, name: meet.name } };
const newcomer = {
  id: `${prefix}-newcomer`, name: { first: "Synthetic", last: "Newcomer" }, gender: "F", status: "active",
  sourceObservation: { memberIdHash: digest(prefix).slice(0, 24) },
};
const newer = { ...faster, id: `${prefix}-new-race`, athleteId: newcomer.id, timeMs: 67000 };
const late = { ...faster, id: `${prefix}-late`, round: "P", timeMs: 56000 };
const row = (kind, data, other = {}) => ({ kind, id: data.id, data, ...other });

async function account(userIds, label, staff = false) {
  const email = `${prefix}-${label}@example.test`;
  const password = `${randomUUID()}!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(created.error);
  const userId = created.data.user.id;
  userIds.push(userId);
  if (staff) {
    const result = await admin.from("administrators").insert({ user_id: userId });
    assert.ifError(result.error);
  }
  const session = client();
  const signedIn = await session.auth.signInWithPassword({ email, password });
  assert.ifError(signedIn.error);
  return session;
}

test("private import, frozen review and transactional publication", async (t) => {
  const userIds = [];
  const resolvedSwimIds = [];
  t.after(async () => {
    db(`begin;
      set local velocity.defer_bests = 'true';
      delete from private.velocity_import_selection_rows where row_id in (
        select r.id from private.velocity_import_rows r join private.velocity_import_batches b on b.id = r.batch_id where b.source_scope = ${sql(prefix)}
      );
      update private.velocity_import_rows set swimmer_resolution_id = null, supersedes_id = null
        where batch_id in (select id from private.velocity_import_batches where source_scope = ${sql(prefix)});
      delete from private.velocity_import_swimmer_resolutions where reason like ${sql(`${prefix}%`)};
      delete from private.velocity_import_rows where batch_id in (select id from private.velocity_import_batches where source_scope = ${sql(prefix)});
      delete from private.velocity_import_batches where source_scope = ${sql(prefix)};
      delete from private.collection_workers where name in (${sql(prefix)},${sql(`${prefix}-catalog`)});
      delete from public.swims where id like ${sql(`${prefix}%`)};
      delete from public.swims where id in (select jsonb_array_elements_text(${json(resolvedSwimIds)}));
      delete from public.relay_results where id like ${sql(`${prefix}%`)};
      delete from public.athlete_bests where athlete_id like ${sql(`${prefix}%`)};
      delete from public.athletes where id like ${sql(`${prefix}%`)};
      delete from public.people where id like ${sql(`person_${prefix}%`)};
      delete from public.meets where id like ${sql(`${prefix}%`)};
      delete from public.knowledge_entries where id like ${sql(`${prefix}%`)};
      commit;`);
    for (const userId of userIds) {
      assert.ifError((await admin.from("administrators").delete().eq("user_id", userId)).error);
      assert.ifError((await admin.auth.admin.deleteUser(userId)).error);
    }
  });
  const staff = await account(userIds, "staff", true);
  const nonStaff = await account(userIds, "member");
  const stage = (capture) => rpc(anon, "stage_velocity_import", { worker_token: token, batch: capture });
  const list = (kind, input = {}) => rpc(staff, "velocity_import_queue", { input: { kind, ...input } });
  async function issues() {
    const rows = [];
    let page;
    do {
      page = await rpc(staff, "velocity_import_issues", { input: { offset: rows.length } });
      assert.ok(page.rows.length || !page.hasNext, "issue pagination must make progress");
      assert.ok(page.rows.length <= 30);
      rows.push(...page.rows);
    } while (page.hasNext);
    assert.equal(rows.length, page.total);
    return rows;
  }
  const select = (input) => rpc(staff, "velocity_import_selection", { input });
  const approve = (selectionId) => rpc(staff, "approve_velocity_import", { selection_id: selectionId });
  const times = (query_kind, input) => {
    if (query_kind === "records") db("select private.refresh_team_records()");
    return rpc(anon, "ies_times_query", { query_kind, input });
  };
  const best = () => db(`select data->>'swimId' from public.athlete_bests where athlete_id=${sql(athlete.id)} and event_code='100_FR_SCY';`);
  const source = batch("main", [
    row("meet", meet), row("swim", faster, { locator: "Event 1" }),
    row("swim", newer, { prerequisites: [row("athlete", newcomer)] }),
  ]);

  db(`insert into private.collection_workers(name,token_hash,divisions) values (${sql(prefix)},${sql(digest(token))},array['times']);
    ${write(`athletes/${athlete.id}`, athlete)}
    ${write(`meets/${earlierMeet.id}`, earlierMeet)}
    ${write(`swims/${earlier.id}`, earlier)}`);

  const staged = await stage(source);
  assert.equal(staged.staged, 3);
  assert.equal((await stage(source)).staged, 0);
  const badScope = await anon.rpc("stage_velocity_import", { worker_token: token, batch: batch("wrong-scope", source.rows, "knowledge") });
  assert.equal(badScope.error?.code, "42501");
  for (const session of [anon, nonStaff]) {
    const attempt = await session.rpc("velocity_import_queue", { input: { kind: "swims" } });
    assert.ok(attempt.error, "non-staff must be denied private queue access");
    assert.ok((await session.rpc("velocity_import_issues", { input: {} })).error, "non-staff must be denied issue access");
  }

  const { rows: meetRows } = await list("meets", { batchId: staged.batchId });
  const { rows: swimRows } = await list("swims", { batchId: staged.batchId });
  assert.equal(meetRows.length, 1);
  assert.equal(swimRows.length, 2);
  const fasterRow = swimRows.find((item) => item.recordId === faster.id);
  const detail = await rpc(staff, "velocity_import_detail", { input: { id: fasterRow.id } });
  assert.equal(detail.sourceUrl, source.sourceUrl);
  assert.equal(detail.sha256, source.sha256);
  assert.equal(detail.locator, "Event 1");
  assert.equal((await times("meet_results", { meetId: meet.id })).total, 0);
  assert.equal(best(), earlier.id);
  assert.ok((await times("records", { team: team.id })).races.some((race) => race.id === earlier.id));

  const swimSnapshot = await select({ matches: [{ kind: "swims", batchId: staged.batchId }], preview: false });
  assert.equal(swimSnapshot.selected, 2);
  assert.equal((await staff.rpc("approve_velocity_import", { selection_id: swimSnapshot.selectionId })).error?.code, "PT404");
  await stage({ ...source, rows: [row("swim", late)] });
  const preview = await select({ ids: [meetRows[0].id], selectionIds: [swimSnapshot.selectionId] });
  assert.equal(preview.selected, 3);
  assert.equal(preview.blocked, 0, JSON.stringify(preview.blockers));
  assert.ok(preview.prerequisites.some(({ kind, id }) => kind === "athlete" && id === newcomer.id));
  const selected = await list("swims", { selectionIds: [preview.selectionId], onlySelected: true });
  assert.equal(selected.total, 2);
  assert.ok(selected.rows.every(({ blocker }) => blocker === null));

  // An unrelated canonical write and a duplicate approval request must both be safe.
  db(write(`meets/${prefix}-unrelated`, { name: "Unrelated canonical write" }));
  const receipts = await Promise.all([approve(preview.selectionId), approve(preview.selectionId)]);
  assert.ok(receipts.every(({ done, approved }) => done && approved === 3));
  assert.equal(receipts.reduce((sum, result) => sum + result.published, 0), 3);
  assert.equal((await times("meet_results", { meetId: meet.id })).total, 2);
  assert.equal(best(), faster.id);
  assert.ok((await times("records", { team: team.id })).races.some((race) => race.id === faster.id));
  const remaining = await list("swims", { batchId: staged.batchId });
  assert.ok(remaining.rows.some(({ recordId }) => recordId === late.id));

  const conflict = await stage(batch("correction", [row("swim", { ...faster, timeMs: 54000 })]));
  assert.equal(conflict.blocked, 1);
  assert.equal(best(), faster.id);
  const publicRace = await anon.from("public_swims").select("data").eq("id", faster.id).single();
  assert.ifError(publicRace.error);
  assert.equal(publicRace.data.data.timeMs, 55000);

  const missingMeet = { ...meet, id: `${prefix}-blocked-meet`, name: `${prefix} Initially Missing Meet` };
  const blockedRace = {
    ...faster, id: `${prefix}-blocked-race`,
    meet: { ...faster.meet, id: missingMeet.id, name: missingMeet.name },
  };
  const pair = await stage(batch("blocked", [row("meet", missingMeet), row("swim", blockedRace)]));
  const blockedPreview = await select({ matches: [{ kind: "swims", batchId: pair.batchId }] });
  assert.equal(blockedPreview.blocked, 1);
  const blockers = await rpc(staff, "velocity_import_detail", { input: { selectionId: blockedPreview.selectionId, section: "blockers", offset: 0 } });
  assert.equal(blockers.total, 1);
  assert.match(blockers.rows[0].reason, /linked meet/i);
  const dependency = (await issues()).find(({ recordId }) => recordId === blockedRace.id);
  assert.equal(dependency.sourceUrl, batch("blocked", []).sourceUrl);
  assert.deepEqual(dependency.linkedMeetRow, {
    id: (await list("meets", { batchId: pair.batchId })).rows[0].id,
    label: missingMeet.name,
  });
  const parentPreview = await select({ matches: [{ kind: "meets", batchId: pair.batchId }] });
  assert.equal((await approve(parentPreview.selectionId)).approved, 1);
  const blockedReceipt = await approve(blockedPreview.selectionId);
  assert.equal(blockedReceipt.approved, 0);
  assert.equal(blockedReceipt.blocked, 1);
  assert.ok(!(await issues()).some(({ recordId }) => recordId === blockedRace.id), "a historical preview blocker must clear when the linked meet is published");
  const [readySwim] = (await list("swims", { batchId: pair.batchId })).rows;
  assert.equal(readySwim.recordId, blockedRace.id);
  assert.equal(readySwim.blocker, null, "the still-pending swim should be ready after publishing its linked meet");
  assert.equal((await times("meet_results", { meetId: missingMeet.id })).total, 0);
  const renewedPreview = await select({ matches: [{ kind: "swims", batchId: pair.batchId }] });
  assert.equal((await approve(renewedPreview.selectionId)).approved, 1);

  await t.test("issue list rechecks an ordinary swim when another result overlaps it", async () => {
    const ordinary = {
      ...faster, id: `${prefix}-ordinary`, eventCode: "100_BK_SCY", stroke: "BK",
      externalResult: { namespace: "synthetic", id: `${prefix}-ordinary-source` },
    };
    const competing = {
      ...ordinary, id: `${prefix}-competing`, timeMs: ordinary.timeMs + 1000,
      externalResult: { namespace: "synthetic", id: `${prefix}-competing-source` },
    };
    assert.equal((await stage(batch("ordinary", [row("swim", ordinary)]))).blocked, 0);
    assert.ok(!(await issues()).some(({ recordId }) => recordId === ordinary.id));

    // Neither record ID nor source result ID is shared. The race occurrence
    // alone is enough to make both pending rows require review.
    assert.equal((await stage(batch("competing", [row("swim", competing)]))).blocked, 1);
    const pendingIssues = new Map((await issues()).map(({ recordId, blocker }) => [recordId, blocker]));
    assert.match(pendingIssues.get(ordinary.id), /pending captures disagree/i);
    assert.match(pendingIssues.get(competing.id), /pending captures disagree/i);

    db(write(`swims/${ordinary.id}`, { ...ordinary, timeMs: ordinary.timeMs + 2000 }));
    const publishedIssues = new Map((await issues()).map(({ recordId, blocker }) => [recordId, blocker]));
    assert.match(publishedIssues.get(ordinary.id), /different published facts/i);
    assert.match(publishedIssues.get(competing.id), /published result overlaps/i);
  });

  await t.test("a slower import in another historical gender bucket updates active rank", async () => {
    const eventCode = "100_BR_SCY";
    const fastest = {
      ...earlier, id: `${prefix}-historical-best`, eventCode, stroke: "BR", gender: "M", timeMs: 55000,
    };
    const target = {
      ...fastest, id: `${prefix}-historical-rank-target`, athleteId: newcomer.id, gender: "F", timeMs: 65000,
    };
    const historical = {
      ...fastest, id: `${prefix}-alternate-historical-bucket`, gender: "F", timeMs: 60000, meet: faster.meet,
    };
    db(`${write(`swims/${fastest.id}`, fastest)}\n${write(`swims/${target.id}`, target)}`);
    const savedBest = (athleteId) => JSON.parse(db(`select data from public.athlete_bests
      where athlete_id = ${sql(athleteId)} and event_code = ${sql(eventCode)};`));
    const initialRank = savedBest(newcomer.id);

    const capture = await stage(batch("alternate-historical-bucket", [row("swim", historical)]));
    const snapshot = await select({ matches: [{ kind: "swims", batchId: capture.batchId }] });
    assert.equal((await approve(snapshot.selectionId)).approved, 1);

    const updatedRank = savedBest(newcomer.id);
    assert.equal(savedBest(athlete.id).swimId, fastest.id);
    assert.equal(updatedRank.swimId, target.id);
    assert.equal(updatedRank.clubRankAllTime, initialRank.clubRankAllTime);
    assert.equal(updatedRank.clubRankActiveRoster, initialRank.clubRankActiveRoster + 1);
  });

  await t.test("incremental bests preserve competition ties, tie breaks, and approval replay", async () => {
    const eventCode = "200_FL_SCM";
    const third = { ...athlete, id: `${prefix}-tie-third`, name: { first: "Third", last: prefix } };
    const inactive = { ...athlete, id: `${prefix}-tie-inactive`, name: { first: "Inactive", last: prefix }, status: "inactive" };
    const initial = {
      ...faster, id: `${prefix}-a-tie-later`, eventCode, course: "SCM", distance: 200, stroke: "FL", timeMs: 130000,
    };
    const competitors = [
      { ...initial, id: `${prefix}-tie-second-old`, athleteId: newcomer.id, timeMs: 132000, meet: earlier.meet },
      { ...initial, id: `${prefix}-tie-third-old`, athleteId: third.id, timeMs: 135000 },
      { ...initial, id: `${prefix}-tie-inactive-old`, athleteId: inactive.id, timeMs: 128000 },
    ];
    db(`${write(`athletes/${third.id}`, third)}\n${write(`athletes/${inactive.id}`, inactive)}\n${
      [initial, ...competitors].map((swim) => write(`swims/${swim.id}`, swim)).join("\n")
    }`);

    const winner = { ...initial, id: `${prefix}-z-tie-earlier`, meet: earlier.meet };
    const sameDay = { ...winner, id: `${prefix}-zz-tie-earlier`, round: "P" };
    const second = { ...initial, id: `${prefix}-tie-second-new`, athleteId: newcomer.id };
    const capture = await stage(batch("history-ties", [sameDay, second, winner].map((swim) => row("swim", swim))));
    const snapshot = await select({ matches: [{ kind: "swims", batchId: capture.batchId }] });
    assert.equal((await approve(snapshot.selectionId)).published, 3);

    const saved = () => JSON.parse(db(`select jsonb_object_agg(athlete_id, data) from public.athlete_bests
      where event_code = ${sql(eventCode)} and athlete_id in (${[athlete.id, newcomer.id, third.id, inactive.id].map(sql).join(",")});`));
    const bests = saved();
    assert.equal(bests[athlete.id].swimId, winner.id);
    assert.equal(bests[newcomer.id].swimId, second.id);
    assert.deepEqual([athlete, newcomer, third, inactive].map(({ id }) => bests[id].clubRankAllTime), [2, 2, 4, 1]);
    assert.deepEqual([athlete, newcomer, third, inactive].map(({ id }) => bests[id].clubRankActiveRoster), [1, 1, 3, null]);
    const replay = await approve(snapshot.selectionId);
    assert.equal(replay.approved, 3);
    assert.equal(replay.published, 0);
    assert.deepEqual(saved(), bests);
  });

  const relay = {
    id: `${prefix}-relay`, teamId: team.id, meet: faster.meet, eventCode: "200_FR-R_SCY", course: "SCY",
    distance: 200, stroke: "FR", round: "F", gender: "F", ageGroup: "15-16", timeMs: 120000,
    status: "OK", isOfficial: true, isRelay: true, relayName: "Synthetic A Relay", splitCoverage: "unavailable",
    members: [{ leg: 1, athleteId: athlete.id, name: "Synthetic Swimmer", stroke: "FR", gender: "F" }],
  };
  const relayCapture = await stage(batch("relay", [row("relay", relay)]));
  const publicRelay = () => anon.from("public_relay_results").select("data").eq("id", relay.id).maybeSingle();
  assert.equal((await publicRelay()).data, null);
  const relayPreview = await select({ matches: [{ kind: "swims", batchId: relayCapture.batchId }] });
  assert.equal((await approve(relayPreview.selectionId)).approved, 1);
  const publishedRelay = await publicRelay();
  assert.ifError(publishedRelay.error);
  assert.equal(publishedRelay.data.data.members[0].athleteId, athlete.id);

  await t.test("a relay correction cannot detach a verified lead-off", async () => {
    const leadOff = {
      ...faster, id: `${prefix}-relay-lead-off`, eventCode: "50_FR_SCY", distance: 50, timeMs: 28000,
      resultOrigin: "relay_leadoff", parentRelayResultId: relay.id,
      leadOffVerification: {
        verified: true, flatStart: true, timingVerified: true, leadOffStatus: "OK",
        sourceUrl: "https://example.test/imports/verified-relay-lead-off",
      },
    };
    db(write(`swims/${leadOff.id}`, leadOff));
    assert.throws(() => db(write(`relay_results/${relay.id}`, { ...relay, members: [] })),
      /Correct or remove the verified lead-off before changing its relay member/);
    const unchanged = await publicRelay();
    assert.ifError(unchanged.error);
    assert.equal(unchanged.data.data.members[0].athleteId, athlete.id);
  });

  await t.test("review one HY3 swimmer across pending batches and publish with a fresh approval", async () => {
    const memberIdHash = digest(`${prefix}-member`).slice(0, 24);
    const canonical = {
      ...athlete, id: `${prefix}-canonical`, name: { first: "Sam", last: prefix }, teamId: team.id,
      sourceObservation: { memberIdHash },
    };
    const captured = { ...canonical, id: `${prefix}-captured`, name: { first: "Samuel", last: prefix } };
    db(write(`athletes/${canonical.id}`, canonical));

    const raceHash = (athleteId, number, eventCode) =>
      digest([meet.id, athleteId, number, eventCode, "F", faster.meet.date].join("|")).slice(0, 24);
    const captureSwim = (distance, number, line, stagedAthlete = captured) => {
      const eventCode = `${distance}_FR_SCY`;
      const originalHash = raceHash(stagedAthlete.id, number, eventCode);
      return row("swim", {
        ...faster, id: `hytek_race_${originalHash}`, athleteId: stagedAthlete.id, athleteName: stagedAthlete.name,
        distance, eventCode, timeMs: distance * 600, metadata: { source: "hytek_hy3" },
        sourceObservation: {
          memberIdHash: stagedAthlete.sourceObservation.memberIdHash,
          eventNumber: number, line, affiliation: { name: team.name },
          url: `https://example.test/imports/${prefix}/archive`,
          file: "meet.hy3", companionFile: "meet.cl2", companionLine: line + 1,
          archiveSha256: digest(`${prefix}-archive`), hy3Sha256: digest(`${prefix}-hy3`),
          companionSha256: digest(`${prefix}-cl2`),
        },
        externalResult: { namespace: "hytek", id: originalHash },
      }, { locator: String(line), prerequisites: [row("athlete", stagedAthlete)] });
    };
    const first = captureSwim(50, "1", 10);
    const second = captureSwim(200, "2", 20);
    const third = captureSwim(500, "3", 30, { ...captured, id: canonical.id });
    const held = {
      ...captureSwim(1000, "4", 40),
      blocker: "Source time requires manual verification.",
    };
    for (const { data } of [first, second, third]) {
      resolvedSwimIds.push(`hytek_race_${raceHash(canonical.id, data.sourceObservation.eventNumber, data.eventCode)}`);
    }
    const unrelated = { ...late, id: `${prefix}-unrelated-swim`, eventCode: "50_FR_SCY", distance: 50 };
    const firstBatch = await stage(batch("match-first", [first, held, row("swim", unrelated)]));
    const secondBatch = await stage(batch("match-second", [second]));
    const firstRows = await list("swims", { batchId: firstBatch.batchId });
    const secondRows = await list("swims", { batchId: secondBatch.batchId });
    const original = firstRows.rows.find(({ recordId }) => recordId === first.id);
    const unrelatedRow = firstRows.rows.find(({ recordId }) => recordId === unrelated.id);
    assert.equal(original.canResolveSwimmerMatch, true);
    assert.equal(unrelatedRow.canResolveSwimmerMatch, false);
    assert.match(original.blocker, /swimmer identity/i);
    const matchIssues = (await issues()).filter(({ recordId }) => [first.id, second.id, held.id, unrelated.id].includes(recordId));
    assert.deepEqual(matchIssues.map(({ canResolveSwimmerMatch }) => canResolveSwimmerMatch), [true, false]);
    assert.ok([first.id, second.id].includes(matchIssues[0].recordId), "the match should appear once across both captures");
    assert.equal(matchIssues[1].recordId, held.id, "the source hold must appear independently of the match");

    const lookup = (input) => rpc(staff, "velocity_import_swimmer_matches", { input });
    const reason = `${prefix} Verified the source identity against the original archive.`;
    const before = await lookup({ id: original.id });
    assert.equal(before.affected, 2);
    assert.equal(before.capturedName, `Samuel ${prefix}`);
    assert.match(before.matchVersion, /^[a-f0-9]{64}$/);
    assert.ok(before.candidates.some(({ id, evidence }) => id === canonical.id && evidence === "source_identity"));
    const input = { id: original.id, athleteId: canonical.id, reason, matchVersion: before.matchVersion };
    for (const session of [anon, nonStaff]) {
      assert.ok((await session.rpc("velocity_import_swimmer_matches", { input: { id: original.id } })).error);
      assert.ok((await session.rpc("resolve_velocity_import_swimmer", { input })).error);
    }

    const oldSelection = await select({ ids: [original.id, secondRows.rows[0].id] });
    assert.equal(oldSelection.blocked, 2);
    await stage(batch("match-third", [third]));
    const stale = await staff.rpc("resolve_velocity_import_swimmer", { input });
    assert.equal(stale.error?.code, "PT409");

    const latest = await lookup({ id: original.id });
    assert.equal(latest.affected, 3);
    assert.notEqual(latest.matchVersion, before.matchVersion);
    const verified = { ...input, matchVersion: latest.matchVersion };
    const wrongTarget = await staff.rpc("resolve_velocity_import_swimmer", { input: { ...verified, athleteId: athlete.id } });
    assert.ok(wrongTarget.error, "an existing exact source claim must rule out a different swimmer");
    const saves = await Promise.all([
      rpc(staff, "resolve_velocity_import_swimmer", { input: verified }),
      rpc(staff, "resolve_velocity_import_swimmer", { input: verified }),
    ]);
    assert.equal(saves[0].updated, 3);
    assert.equal(saves[0].rowIds.length, 3);
    assert.deepEqual(saves[0], saves[1]);
    assert.ok(!(await issues()).some(({ recordId }) => [first.id, second.id, third.id].includes(recordId)));
    assert.equal(db(`select count(*) from private.velocity_import_swimmer_resolutions where reason = ${sql(reason)};`), "1");
    assert.equal(db(`select count(*) from private.velocity_import_rows
      where status = 'superseded' and record_id in (${[first.id, second.id, third.id].map(sql).join(",")});`), "3");

    const oldApproval = await staff.rpc("approve_velocity_import", { selection_id: oldSelection.selectionId });
    assert.equal(oldApproval.error?.code, "PT409");
    const publicMatches = () => anon.from("public_swims").select("id,data").in("id", resolvedSwimIds);
    const beforeApproval = await publicMatches();
    assert.ifError(beforeApproval.error);
    assert.deepEqual(beforeApproval.data, []);
    const result = await list("swims", { search: prefix });
    const corrected = result.rows.filter(({ recordId }) => resolvedSwimIds.includes(recordId));
    assert.equal(corrected.length, 3);
    assert.deepEqual(new Set(corrected.map(({ id }) => id)), new Set(saves[0].rowIds));
    assert.ok(corrected.every(({ blocker }) => blocker === null));
    assert.ok(corrected.every(({ label }) => label === `Sam ${prefix}`));
    assert.ok(result.rows.some(({ id }) => id === unrelatedRow.id));
    assert.ok(result.rows.some(({ recordId, blocker }) => recordId === held.id && blocker === held.blocker));
    assert.ok(result.rows.every(({ recordId }) => ![first.id, second.id].includes(recordId)));
    const detail = await rpc(staff, "velocity_import_detail", { input: { id: corrected.find(({ recordId }) => recordId === resolvedSwimIds[0]).id } });
    assert.equal(detail.locator, first.locator);
    assert.deepEqual(detail.data.sourceObservation, first.data.sourceObservation);
    assert.equal(detail.data.athleteId, canonical.id);
    assert.deepEqual(detail.data.athleteName, captured.name);
    assert.equal(detail.data.externalResult.id, resolvedSwimIds[0].slice("hytek_race_".length));

    const selection = await select({ ids: corrected.map(({ id }) => id) });
    assert.equal(selection.blocked, 0);
    assert.equal((await approve(selection.selectionId)).approved, 3);
    const published = await publicMatches();
    assert.ifError(published.error);
    assert.equal(published.data.length, 3);
    assert.ok(published.data.every(({ data }) => data.athleteId === canonical.id));

    const named = { ...athlete, id: `${prefix}-name-match`, name: { first: "Morgan", last: prefix } };
    db(write(`athletes/${named.id}`, named));
    const unlinked = {
      ...named, id: `${prefix}-name-unlinked`,
      sourceObservation: { memberIdHash: digest(`${prefix}-other-member`).slice(0, 24) },
    };
    const byName = captureSwim(50, "5", 50, unlinked);
    const nameBatch = await stage(batch("name-match", [byName]));
    const { rows: [nameRow] } = await list("swims", { batchId: nameBatch.batchId });
    assert.match(nameRow.blocker, /published swimmer has this name/i);
    const nameMatch = await lookup({ id: nameRow.id });
    assert.ok(nameMatch.candidates.some(({ id, evidence }) => id === named.id && evidence === "name_match"));
    const nameReason = `${prefix} Confirmed the source affiliation and swimmer identity.`;
    const namedReceipt = await rpc(staff, "resolve_velocity_import_swimmer", {
      input: { id: nameRow.id, athleteId: named.id, reason: nameReason, matchVersion: nameMatch.matchVersion },
    });
    assert.equal(namedReceipt.updated, 1);
    assert.equal((await list("swims", { batchId: nameBatch.batchId })).rows[0].blocker, null);
    const namedResultId = `hytek_race_${raceHash(named.id, "5", byName.data.eventCode)}`;
    const namePublication = await anon.from("public_swims").select("id").eq("id", namedResultId);
    assert.ifError(namePublication.error);
    assert.deepEqual(namePublication.data, []);
    const nameSelection = await select({ ids: namedReceipt.rowIds });
    resolvedSwimIds.push(namedResultId);
    assert.equal((await approve(nameSelection.selectionId)).approved, 1);
    assert.equal(db(`select athlete_id from private.athlete_source_identities
      where namespace = 'hytek-member' and source_id = ${sql(unlinked.sourceObservation.memberIdHash)};`), named.id);
  });

  const catalogToken = randomUUID();
  db(`insert into private.collection_workers(name,token_hash,divisions) values (${sql(`${prefix}-catalog`)},${sql(digest(catalogToken))},array['knowledge']);`);
  const catalogRows = Array.from({ length: 301 }, (_, i) => row("catalog_meet", {
    id: `${prefix}-catalog-${i}`, kind: "meet", title: `${prefix} Catalog Meet ${i}`, startsOn: "2026-11-10",
  }));
  const catalogBatch = batch("catalog", catalogRows.slice(0, 100), "knowledge");
  const catalogStage = (capture) => rpc(anon, "stage_velocity_import", { worker_token: catalogToken, batch: capture });
  const holds = Array.from({ length: 31 }, (_, index) => row("catalog_meet", {
    id: `${prefix}-held-${index}`, kind: "meet", title: `Held catalog meet ${index}`, startsOn: "2026-11-10",
  }, { blocker: "Source catalog date needs review." }));
  const heldCatalog = await catalogStage(batch("catalog-holds", holds, "knowledge"));
  const catalog = await catalogStage(catalogBatch);
  for (let offset = 100; offset < catalogRows.length; offset += 100) {
    const chunk = await catalogStage({ ...catalogBatch, rows: catalogRows.slice(offset, offset + 100) });
    assert.equal(chunk.batchId, catalog.batchId);
  }
  const page = await list("meets", { batchId: catalog.batchId });
  assert.equal(page.total, catalogRows.length);
  assert.ok(page.hasNext);
  assert.ok(page.rows.length < catalogRows.length);
  const listedHolds = (await issues()).filter(({ batchId }) => batchId === heldCatalog.batchId);
  assert.deepEqual(new Set(listedHolds.map(({ recordId }) => recordId)), new Set(holds.map(({ id }) => id)));
  assert.ok(listedHolds.every(({ kind, blocker }) => kind === "catalog_meet" && blocker === holds[0].blocker));
  const catalogSnapshot = await select({ matches: [{ kind: "meets", batchId: catalog.batchId }] });
  assert.equal(catalogSnapshot.selected, catalogRows.length);
  assert.equal(catalogSnapshot.previewRemaining, 1);
  assert.equal((await staff.rpc("approve_velocity_import", { selection_id: catalogSnapshot.selectionId })).error?.code, "PT404");
  const catalogSelection = { selection_id: catalogSnapshot.selectionId };
  const reduceBatch = (reviewer = staff) => rpc(reviewer, "reduce_velocity_import_approval_batch", catalogSelection);
  assert.equal(await reduceBatch(), null);
  const catalogPreview = await select({ prepareSelectionId: catalogSnapshot.selectionId });
  assert.equal(catalogPreview.previewRemaining, 0);
  assert.equal(catalogPreview.selectionId, catalogSnapshot.selectionId);
  const before = await anon.from("knowledge_entries").select("id").eq("id", catalogRows[0].id);
  assert.ifError(before.error);
  assert.deepEqual(before.data, []);
  const chunk = await approve(catalogSnapshot.selectionId);
  assert.equal(chunk.done, false);
  assert.equal(chunk.approved, 100);
  assert.equal(chunk.remaining, catalogRows.length - 100);

  await t.test("a smaller chunk resumes the same frozen selection after partial publication", async () => {
    const otherStaff = await account(userIds, "other-staff", true);
    assert.ok((await anon.rpc("reduce_velocity_import_approval_batch", catalogSelection)).error);
    assert.equal((await nonStaff.rpc("reduce_velocity_import_approval_batch", catalogSelection)).error?.code, "42501");
    assert.equal(await reduceBatch(otherStaff), null);
    assert.equal(await reduceBatch(), 50);

    let receipt = await approve(catalogSnapshot.selectionId);
    assert.equal(receipt.selected, catalogRows.length);
    assert.equal(receipt.approved, 150);
    assert.equal(receipt.published, 50);
    while (!receipt.done) {
      const next = await approve(catalogSnapshot.selectionId);
      assert.equal(next.published, Math.min(receipt.remaining, 50));
      assert.equal(next.approved, receipt.approved + next.published);
      receipt = next;
    }
    assert.equal(receipt.approved, catalogRows.length);
    assert.equal(await reduceBatch(), null);
    const replay = await approve(catalogSnapshot.selectionId);
    assert.equal(replay.approved, catalogRows.length);
    assert.equal(replay.published, 0);
  });
  const after = await anon.from("knowledge_entries").select("id").eq("id", catalogRows[0].id).single();
  assert.ifError(after.error);
  assert.equal(after.data.id, catalogRows[0].id);
});
