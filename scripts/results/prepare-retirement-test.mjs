import { mkdtempSync, cpSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
// CI uses a fresh local project. Never resets an existing database or connects remotely.
const directory = mkdtempSync(join(tmpdir(), "velocity-retirement-"));
mkdirSync(join(directory, "supabase", "migrations"), { recursive: true });
for (const name of ["config.toml", "seed.sql", "templates"])
  cpSync(join("supabase", name), join(directory, "supabase", name), {
    recursive: true,
  });
const migrations = readdirSync("supabase/migrations"),
  retirement = migrations.find((name) =>
    name.endsWith("_retire_collection_workflows.sql"),
  );
if (!retirement) throw new Error("Missing retirement migration.");
for (const name of migrations)
  if (name < retirement)
    cpSync(
      join("supabase", "migrations", name),
      join(directory, "supabase", "migrations", name),
    );
execFileSync(
  "supabase",
  [
    "start",
    "--workdir",
    directory,
    "-x",
    "studio,imgproxy,logflare,vector,supavisor",
  ],
  { stdio: "inherit" },
);
execFileSync(
  process.execPath,
  ["--test", "tests/data-retirement.integration.mjs"],
  { stdio: "inherit" },
);
// The normal checkout now advances the tested disposable database to the final schema.
// CLI 3 targets the local stack unless --remote is explicitly provided.
execFileSync("supabase", ["migration", "up"], { stdio: "inherit" });
