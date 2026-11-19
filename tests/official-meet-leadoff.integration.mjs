import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

test("original meet lead-offs require an exact private attestation", () => {
  const fixture = readFileSync("tests/fixtures/results/official-meet-leadoff.sql", "utf8");
  // Fixed local container and rollback-only fixture: never targets hosting.
  execFileSync("docker", ["exec", "-i", "supabase_db_aboutvelocityswimming", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt"], {
    input: `BEGIN;\n${fixture}\nROLLBACK;`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
});
