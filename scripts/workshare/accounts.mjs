import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import "./register-typescript.mjs";
import { parseAccount } from "../../src/features/workshare/lib/accounts-validation.ts";

const args = process.argv.slice(2);
const command = args.shift();
function flag(name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${name} requires a value.`);
  args.splice(index, 2);
  return value;
}
const configPath = flag("--config");
const file = flag("--file");
const output = flag("--output");
const seasonId = flag("--season");
if (
  !["list", "import", "apply", "apply-requirements"].includes(command) ||
  args.length ||
  (seasonId && !["list", "apply-requirements"].includes(command))
) {
  console.log(
    "Usage: node scripts/workshare/accounts.mjs list --output private.json [--season UUID] [--config local-status.json]\n       node scripts/workshare/accounts.mjs import --file staged.json --output receipt.json [--config local-status.json]\n       node scripts/workshare/accounts.mjs apply --file edited.json --output receipt.json [--config local-status.json]\n       node scripts/workshare/accounts.mjs apply-requirements --season UUID --file requirements.json --output receipt.json [--config local-status.json]\nEnvironment: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or --config from supabase status --output json). Import requires an empty account table. Apply updates existing accounts by id and exact updatedAt version.",
  );
  process.exit(command === "--help" ? 0 : 1);
}
const { parseRequirements, parseWorkshareId, parseAccountPathId } =
  await import("../../src/features/workshare/lib/tickets-validation.ts");
if (seasonId) parseWorkshareId(seasonId, "Season");
if (command === "apply-requirements" && !seasonId)
  throw new Error("Requirement edits require an explicit --season UUID.");
if (!output)
  throw new Error(
    "Choose a private --output file for records or the write receipt.",
  );
if (
  [file, configPath].some((path) => path && resolve(path) === resolve(output))
)
  throw new Error(
    "The output must be separate from the input and connection settings.",
  );
const config = configPath ? JSON.parse(await readFile(configPath, "utf8")) : {};
const url = config.API_URL || process.env.SUPABASE_URL;
const key = config.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key)
  throw new Error(
    "Supply local --config or SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const saveFile = async (value) =>
  writeFile(output, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
async function rpc(name, input) {
  const { data, error } = await client.rpc(name, input);
  if (error) throw new Error(`${name}: ${error.message} (${error.code})`);
  return data;
}
if (command === "list") {
  const accounts = seasonId
    ? await rpc("list_workshare_account_summaries", { season_id: seasonId })
    : await rpc("list_workshare_accounts");
  await saveFile(accounts);
  console.log(`Exported ${accounts.length} accounts.`);
} else {
  if (!file) throw new Error("A write requires --file.");
  const document = JSON.parse(await readFile(file, "utf8"));
  const records = Array.isArray(document)
    ? document
    : (document.requirements ?? document.accounts);
  if (!Array.isArray(records) || !records.length)
    throw new Error("File must contain a nonempty accounts array.");
  // Validate the entire request before the first write; no unsupported fields are ignored.
  const accounts =
    command === "apply-requirements"
      ? records.map((value) => {
          const entry = value.requirements ?? value;
          if (entry.seasonId !== seasonId)
            throw new Error(
              "Each requirement record must match the explicit --season.",
            );
          const { accountId, ...fields } = entry;
          return {
            accountId: parseAccountPathId(accountId),
            ...parseRequirements(fields),
          };
        })
      : records.map((value) =>
          parseAccount(value, command === "import" ? "create" : "update"),
        );
  // Open the receipt before making changes so an invalid path cannot lose a write result.
  await writeFile(
    output,
    JSON.stringify({ completed: false, accounts: [] }) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  if (command === "import") {
    const result = await rpc("import_workshare_accounts", {
      input: { accounts },
    });
    await saveFile({
      source: document.source ?? null,
      result,
      importedAt: new Date().toISOString(),
    });
    console.log(
      `Imported ${accounts.length} accounts and ${accounts.reduce((count, account) => count + account.athletes.length, 0)} athletes.`,
    );
  } else {
    const saved = [];
    try {
      for (const account of accounts) {
        if (command === "apply-requirements") {
          const { accountId, ...input } = account;
          saved.push(
            await rpc("save_workshare_requirements", {
              account_id: accountId,
              input,
            }),
          );
        } else {
          saved.push(await rpc("save_workshare_account", { input: account }));
        }
        await saveFile({ completed: false, accounts: saved });
      }
      await saveFile({ completed: true, accounts: saved });
      console.log(`Updated ${saved.length} accounts.`);
    } catch (error) {
      await saveFile({
        completed: false,
        accounts: saved,
        error: error.message,
      });
      throw new Error(
        `Stopped after ${saved.length} updates. Read the receipt and reload versions before retrying. ${error.message}`,
      );
    }
  }
}
