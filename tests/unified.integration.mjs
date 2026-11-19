import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
const config = JSON.parse(
  execFileSync("supabase", ["status", "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
);
assert.equal(
  config.API_URL,
  "http://127.0.0.1:54321",
  "Integration tests refuse hosted databases.",
);
const make = () =>
  createClient(config.API_URL, config.PUBLISHABLE_KEY, {
    auth: { persistSession: false },
  });
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const anon = make(),
  staff = make(),
  familyA = make(),
  familyB = make();
const login = async (client, email) => {
  const { error } = await client.auth.signInWithPassword({
    email,
    password: "Velocity-local-test-2026!",
  });
  assert.ifError(error);
};
await login(staff, "coach@velocity-swimming.com");
await login(familyA, "family-a@example.test");
await login(familyB, "family-b@example.test");
const query = async (client, path) => {
  const { data, error } = await client.rpc("query_records", {
    collection_path: path,
  });
  assert.ifError(error);
  return data;
};
const record = async (client, path) => {
  const parts = path.split("/");
  const { data, error } = await client.rpc("query_records", {
    collection_path: parts.slice(0, -1).join("/"),
    record_id: parts.at(-1),
  });
  assert.ifError(error);
  return data?.[0]?.data ?? null;
};
const collect = async (path, after) => {
  const { error } = await admin.rpc("test_write_records", {
    reads: [],
    writes: [{ path, after }],
  });
  assert.ifError(error);
};
const action = async (client, operation, input) =>
  client.rpc("workshare_action", { operation, input });
await test("legacy Workshare storage and actions remain retired", async () => {
  for (const client of [anon, familyA, familyB, staff, admin]) {
    assert.ok((await action(client, "registerForShift", {})).error);
  }
  for (const root of ["postings", "registrations", "manual_hours", "work_descriptions"]) {
    assert.deepEqual(await query(staff, root), []);
    const result = await admin.rpc("test_write_records", {
      reads: [],
      writes: [{ path: `${root}/retired-test`, after: { text: "Retired" } }],
    });
    assert.ok(result.error, `${root} must not accept legacy writes`);
  }
  assert.deepEqual((await admin.rpc("claim_shift_reminders", { dry_run: false })).data, []);
});
await test("database policies isolate family records and staff data", async () => {
  assert.deepEqual(
    (await query(familyA, "families")).map((r) => r.path),
    ["families/family-a"],
  );
  assert.deepEqual(
    (await query(familyB, "families")).map((r) => r.path),
    ["families/family-b"],
  );
  assert.equal((await query(familyA, "athletes")).length, 0);
  assert.equal((await query(anon, "families")).length, 0);
  assert.equal((await query(anon, "sources")).length, 0);
  // Other local workflows can leave synthetic athletes alongside the seed.
  // Check access to the seeded records without requiring an empty database.
  const seededAthletes = ["test-swimmer-a", "test-swimmer-b"];
  for (const [client, collection] of [
    [staff, "athletes"],
    [anon, "public_athletes"],
  ]) {
    const records = await query(client, collection);
    assert.deepEqual(
      records
        .map((row) => row.path.split("/").at(-1))
        .filter((id) => seededAthletes.includes(id))
        .sort(),
      seededAthletes,
    );
  }
  assert.equal((await staff.rpc("is_staff")).data, true);
  assert.equal((await familyA.rpc("is_staff")).data, false);
  const denied = await familyA.rpc("commit_records", {
    reads: [],
    writes: [{ path: "teams/forged", after: { name: "forged" } }],
  });
  assert.ok(denied.error);
  await familyA
    .from("families")
    .update({ data: { accountName: "forged" } })
    .eq("id", "family-b");
  assert.equal(
    await record(familyB, "families/family-b").then((r) => r.accountName),
    "Example Family B",
  );
  const stored = await record(familyA, "families/family-a");
  assert.deepEqual(stored.children, []);
  assert.equal(stored.requirements, undefined);
});
await test("reviewed writes reject stale state and roll back all writes", async () => {
  const before = await record(staff, "teams/velocity-swimming");
  const commit = await staff.rpc("commit_records", {
    reads: [{ path: "teams/velocity-swimming", before }],
    writes: [
      {
        path: "teams/velocity-swimming",
        after: { ...before, name: "Synthetic updated team" },
      },
    ],
  });
  assert.ifError(commit.error);
  const stale = await staff.rpc("commit_records", {
    reads: [{ path: "teams/velocity-swimming", before }],
    writes: [
      { path: "teams/should-not-exist", after: { name: "Bad" } },
      { path: "teams/velocity-swimming", after: before },
    ],
  });
  assert.equal(stale.error?.code, "40001");
  assert.equal(await record(staff, "teams/should-not-exist"), null);
  await collect("teams/velocity-swimming", before);
});
await test("bests follow corrections, invalid status, deletion, and relay eligibility", async () => {
  const first = await record(staff, "swims/test-race-1");
  let best = await query(anon, "athletes/test-swimmer-a/bests");
  assert.equal(best[0].data.bestTimeMs, 64000);
  await collect("swims/test-race-1", { ...first, status: "DQ" });
  best = await query(anon, "athletes/test-swimmer-a/bests");
  assert.equal(best[0].data.bestTimeMs, 65000);
  await collect("swims/test-race-1", {
    ...first,
    timeMs: 63000,
    isRelay: true,
    relay: { isLeadOffFlatStart: false },
  });
  assert.equal(
    (await query(anon, "athletes/test-swimmer-a/bests"))[0].data.bestTimeMs,
    65000,
  );
  await collect("swims/test-race-1", {
    ...first,
    timeMs: 63000,
    isRelay: true,
    relay: { isLeadOffFlatStart: true },
  });
  assert.equal(
    (await query(anon, "athletes/test-swimmer-a/bests"))[0].data.bestTimeMs,
    63000,
  );
  await collect("swims/test-race-1", null);
  assert.equal(
    (await query(anon, "athletes/test-swimmer-a/bests"))[0].data.bestTimeMs,
    65000,
  );
  await collect("swims/test-race-1", first);
});
await test("private captures deny public access and immutable evidence prevents overwrite", async () => {
  const bytes = new TextEncoder().encode("synthetic evidence");
  const hash = Buffer.from(
    await crypto.subtle.digest("SHA-256", bytes),
  ).toString("hex");
  const path = "evidence/127/velocity-v2/test-source/" + hash;
  const { error: upload } = await admin.storage
    .from("evidence")
    .upload(path, bytes, { upsert: false });
  if (upload && !upload.message.includes("already")) assert.ifError(upload);
  await collect("sources/test-source", {
    id: "test-source",
    name: "Synthetic source",
    reference: "https://example.test/evidence",
    enabled: true,
  });
  const revisionPath = "sources/test-source/revisions/" + hash;
  const value = {
    hash,
    bucket: "evidence",
    storagePath: path,
    contentType: "text/plain",
  };
  const existing = await record(staff, revisionPath);
  if (!existing) await collect(revisionPath, value);
  const denied = await anon.storage.from("evidence").download(path);
  assert.ok(denied.error);
  const allowed = await staff.storage.from("evidence").download(path);
  assert.ifError(allowed.error);
  const overwrite = await admin.rpc("test_write_records", {
    reads: [],
    writes: [{ path: revisionPath, after: { ...value, hash: "forged" } }],
  });
  assert.ok(overwrite.error);
});
await test("authorization uses verified server identity and explicit administrator records", async () => {
  const user = (await familyA.auth.getUser()).data.user;
  await familyA.auth.updateUser({
    data: { staff: true, isAdmin: true, role: "administrator" },
  });
  assert.equal((await familyA.rpc("is_staff")).data, false);
  let result = await admin.from("administrators").insert({ user_id: user.id });
  assert.ifError(result.error);
  assert.equal((await familyA.rpc("is_staff")).data, true);
  await admin.from("administrators").delete().eq("user_id", user.id);
  assert.equal((await familyA.rpc("is_staff")).data, false);
  const users = (await admin.auth.admin.listUsers()).data.users;
  const unverified = users.find(
    (u) => u.email === "unverified@velocity-swimming.com",
  );
  execFileSync(
    "docker",
    [
      "exec",
      "supabase_db_aboutvelocityswimming",
      "psql",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `begin;set local role authenticated;select set_config('request.jwt.claim.sub','${unverified.id}',true);do $$ begin if private.is_staff() then raise exception 'Unverified staff gained access';end if;end $$;rollback;`,
    ],
    { stdio: "pipe" },
  );
});
await test("Times roster edits preserve family contact records and update inactive ranks", async () => {
  const before = await record(staff, "athletes/test-swimmer-a");
  await collect("athletes/test-swimmer-a", {
    ...before,
    name: { first: "Avery", last: "Updated" },
    currentGroup: { ...before.currentGroup, name: "Seniors", id: "seniors" },
    status: "inactive",
  });
  const family = await record(familyA, "families/family-a");
  assert.deepEqual(family.children, []);
  const best = (await query(anon, "athletes/test-swimmer-a/bests"))[0].data;
  assert.equal(best.clubRankActiveRoster, null);
  await collect("athletes/test-swimmer-a", before);
  const invalid = await staff.rpc("commit_records", {
    reads: [],
    writes: [{ path: "teams/no-reviewed-state", after: { name: "Forged" } }],
  });
  assert.ok(invalid.error);
});
await test("public race history never exposes private source fields", async () => {
  const before = await record(staff, "swims/test-race-1");
  await collect("swims/test-race-1", { ...before, gender: "F", ageAtSwim: 12, dob: "2012-02-15", notes: "private", swimsId: "private-id" });
  const publicRace = await anon.from("public_swims").select("*").eq("id", "test-race-1").single();
  assert.ifError(publicRace.error);
  assert.equal(publicRace.data.data.timeMs, 64000);
  assert.equal(publicRace.data.data.gender, "F");
  assert.equal(publicRace.data.data.ageAtSwim, 12);
  assert.equal(publicRace.data.data.dob, undefined);
  assert.equal(publicRace.data.data.notes, undefined);
  assert.equal(publicRace.data.data.swimsId, undefined);
  await collect("swims/test-race-1", before);
});
