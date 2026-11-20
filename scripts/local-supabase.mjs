import { execFileSync } from "node:child_process";
import { join } from "node:path";

// Shared by local fixtures and tests; never accepts a hosted backend.
export function localSupabase() {
  const workdir = process.env.VELOCITY_SUPABASE_WORKDIR;
  const config = JSON.parse(execFileSync("supabase", [
    "status", "--output", "json", ...(workdir ? ["--workdir", workdir] : []),
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  assertLocalBackend(config.API_URL);
  return config;
}
export function assertLocalBackend(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw new Error("Synthetic fixtures and tests require a local backend.");
}
export function localDatabaseContainer() {
  if (process.env.VELOCITY_SUPABASE_WORKDIR && !process.env.VELOCITY_SUPABASE_DB_CONTAINER)
    throw new Error("Set VELOCITY_SUPABASE_DB_CONTAINER with VELOCITY_SUPABASE_WORKDIR so API and SQL tests use the same local stack.");
  const container = process.env.VELOCITY_SUPABASE_DB_CONTAINER ?? "supabase_db_aboutvelocityswimming";
  if (!/^supabase_db_[a-z0-9_-]+$/i.test(container))
    throw new Error("Tests require a local Supabase database container.");
  return container;
}
export function localEnvironmentFile() {
  return join(process.env.VELOCITY_SUPABASE_WORKDIR ?? ".", "supabase", ".env.local");
}
