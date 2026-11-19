import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
const container =
  process.env.VELOCITY_DATA_TEST_CONTAINER ??
  "supabase_db_aboutvelocityswimming";
assert.match(container, /^supabase_db_[a-z0-9_-]+$/i);
test("retirement preserves populated records, source identities, projections and lead-off eligibility", () => {
  // Run after the additive migration, before retirement. CI prepares that exact state.
  const migration = readdirSync("supabase/migrations").find((name) =>
    name.endsWith("_retire_collection_workflows.sql"),
  );
  assert.ok(migration);
  const sql = [
    "begin;",
    readFileSync("tests/fixtures/results/legacy-leadoff.sql", "utf8"),
    readFileSync("supabase/migrations/" + migration, "utf8"),
    readFileSync("tests/fixtures/results/retired-leadoff-check.sql", "utf8"),
    "rollback;",
  ].join("\n");
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
    ],
    { input: sql, stdio: ["pipe", "pipe", "pipe"] },
  );
});
