import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const container =
  process.env.VELOCITY_DATA_TEST_CONTAINER ??
  "supabase_db_aboutvelocityswimming";
assert.match(container, /^supabase_db_[a-z0-9_-]+$/i);
test("owner management, stale edits, projections, partial imports and safe retries", () => {
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
    {
      input: readFileSync("tests/fixtures/results/direct-management.sql"),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
});
