import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const container = process.env.WORKSHARE_TEST_DB_CONTAINER ?? "supabase_db_aboutvelocityswimming";
assert.match(container, /^supabase_db_[a-zA-Z0-9_-]+$/, "Tests require a local Supabase database container.");

await test("Accounts & Roster persistence, validation, concurrency, security, import and retirement", () => {
  const project = execFileSync("docker", [
    "inspect", "--format", '{{index .Config.Labels "com.supabase.cli.project"}}', container,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  assert.ok(project && project !== "<no value>", "Refusing a container without the Supabase local project label.");
  const output = execFileSync("docker", [
    "exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1",
  ], {
    encoding: "utf8",
    input: readFileSync(new URL("./workshare-accounts.integration.sql", import.meta.url), "utf8"),
    stdio: ["pipe", "pipe", "pipe"],
  });
  assert.match(output, /Accounts & Roster CRUD.*passed/);
});
