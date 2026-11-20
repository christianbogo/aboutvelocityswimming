import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const container =
  process.env.VELOCITY_DATA_TEST_CONTAINER ??
  "supabase_db_aboutvelocityswimming";
assert.match(container, /^supabase_db_[a-z0-9_-]+$/i);
test("attendance batches preserve staff authorization, stale checks and atomic writes", () => {
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
      input: readFileSync("tests/fixtures/attendance.sql"),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
});
