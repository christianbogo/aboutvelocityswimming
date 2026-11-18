import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const container = process.env.WORKSHARE_TEST_DB_CONTAINER ?? "supabase_db_aboutvelocityswimming";
assert.match(container, /^supabase_db_[a-zA-Z0-9_-]+$/, "Tests require a local Supabase database container.");
function query(sql) {
  const label = execFileSync("docker", ["inspect", "--format", '{{index .Config.Labels "com.supabase.cli.project"}}', container], { encoding: "utf8", timeout: 20_000 }).trim();
  assert.ok(label && label !== "<no value>", "Refusing a container without the Supabase local project label.");
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", timeout: 60_000 });
}
await test("verified domain authority stays scoped to Workshare", () => {
  assert.match(query(readFileSync(new URL("./workshare-domain-staff.integration.sql", import.meta.url), "utf8")), /Workshare domain authority passed/);
});
await test("domain staff can perform the full seasonal ticket workflow without explicit grants", () => {
  const sql = readFileSync(new URL("./workshare-tickets.integration.sql", import.meta.url), "utf8")
    .replace("ticket-staff@example.test", "ticket-domain@velocity-swimming.com")
    .replace("insert into public.administrators(user_id) values('33333333-3333-4333-8333-333333333333');", "");
  assert.match(query(sql), /Workshare seasons, requirements, tickets.*passed/);
});
