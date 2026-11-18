import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const workdir = process.env.VELOCITY_IMPORT_TEST_WORKDIR ?? ".";
const project = readFileSync(join(workdir, "supabase/config.toml"), "utf8")
  .match(/^project_id = "([a-zA-Z0-9_-]+)"/m)?.[1];

test("official source lead-offs preserve private versioned proof and normal public rankings", () => {
  if (!project) throw new Error("A local Supabase project is required.");
  const migrations = (process.env.VELOCITY_IMPORT_TEST_MIGRATIONS ?? "")
    .split(",").filter(Boolean).map((path) => readFileSync(path, "utf8")).join("\n");
  const fixture = readFileSync(new URL("./fixtures/official-gomotion-source-leadoff.sql", import.meta.url), "utf8");
  try {
    execFileSync("docker", ["exec", "-i", "supabase_db_" + project, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt"], {
      input: "begin;\n" + migrations + "\n" + fixture + "\nrollback;",
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(error.stderr?.toString() || error.message, { cause: error });
  }
});
