import { assertLocalBackend, localEnvironmentFile } from "../local-supabase.mjs";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
const env = { ...process.env, VELOCITY_TEST_BUILD: "true" };
for (const line of readFileSync(localEnvironmentFile(), "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
}
assertLocalBackend(env.NEXT_PUBLIC_SUPABASE_URL);
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", ...process.argv.slice(2)],
  { stdio: "inherit", env },
);
child.on("exit", (code) => process.exit(code ?? 1));
