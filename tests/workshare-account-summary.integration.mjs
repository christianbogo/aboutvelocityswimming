import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { localDatabaseContainer } from "../scripts/local-supabase.mjs";

const container = process.env.WORKSHARE_TEST_DB_CONTAINER ?? localDatabaseContainer();
assert.match(container, /^supabase_db_[a-zA-Z0-9_-]+$/, "Tests require a local Supabase container.");

await test("verified accounts read only their associated Workshare summaries", () => {
  const label = execFileSync("docker", ["inspect", "--format", '{{index .Config.Labels "com.supabase.cli.project"}}', container], { encoding: "utf8" }).trim();
  assert.ok(label && label !== "<no value>");
  const result = execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
    input: readFileSync(new URL("./workshare-account-summary.integration.sql", import.meta.url), "utf8"),
    encoding: "utf8",
  });
  assert.match(result, /Workshare account summaries.*passed/);
});
