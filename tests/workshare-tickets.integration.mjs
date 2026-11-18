import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const container = process.env.WORKSHARE_TEST_DB_CONTAINER ?? "supabase_db_aboutvelocityswimming";
assert.match(container, /^supabase_db_[a-zA-Z0-9_-]+$/, "Tests require a local Supabase container.");
await test("season-scoped requirements and completed tickets", () => {
  const label = execFileSync("docker", ["inspect", "--format", '{{index .Config.Labels "com.supabase.cli.project"}}', container], { encoding: "utf8" }).trim();
  assert.ok(label && label !== "<no value>");
  const result = execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
    input: readFileSync(new URL("./workshare-tickets.integration.sql", import.meta.url), "utf8"), encoding: "utf8",
  });
  assert.match(result, /Workshare seasons, requirements, tickets.*passed/);
});
