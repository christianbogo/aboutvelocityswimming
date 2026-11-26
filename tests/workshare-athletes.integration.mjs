import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { localDatabaseContainer } from "../scripts/local-supabase.mjs";

test("athlete group changes are atomic, versioned, and staff-only", () => {
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      localDatabaseContainer(),
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
      input: readFileSync("tests/fixtures/workshare-athletes.sql"),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
});
