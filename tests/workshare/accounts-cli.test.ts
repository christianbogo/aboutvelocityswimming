import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SeasonRequirements } from "../../src/features/workshare/lib/tickets.ts";

const seasonId = "11111111-1111-4111-8111-111111111111";
const otherSeasonId = "22222222-2222-4222-8222-222222222222";
const savedVersion = "2026-11-18T22:30:00.000Z";
const cliPath = fileURLToPath(
  new URL("../../scripts/workshare/accounts.mjs", import.meta.url),
);
const loaderPath = fileURLToPath(
  new URL("../../scripts/workshare/register-typescript.mjs", import.meta.url),
);
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

interface RpcCall {
  name: string;
  body: Record<string, unknown>;
}
interface MockReply {
  status?: number;
  body: unknown;
}

function requirements(
  accountId: string,
  changes: Partial<SeasonRequirements> = {},
): SeasonRequirements {
  return {
    accountId,
    seasonId,
    updatedAt: "2026-11-18T20:00:00.000Z",
    generalHoursRequired: 16,
    starlightHoursRequired: 0,
    appleCapitalHoursRequired: null,
    ...changes,
  };
}

function summary(value: SeasonRequirements) {
  return {
    account: {
      id: value.accountId,
      fullName: "Synthetic account metadata must stay unchanged",
      emails: ["synthetic@example.test"],
      updatedAt: "2026-11-18T19:00:00.000Z",
      generalHoursRequired: 999,
      athletes: [{ fullName: "Synthetic athlete must stay unchanged" }],
    },
    requirements: value,
    completed: { general: 73.5, starlight: 8, appleCapital: 4 },
  };
}

function acceptedRequirements(call: RpcCall) {
  return {
    accountId: call.body.account_id,
    ...(call.body.input as Record<string, unknown>),
    updatedAt: savedVersion,
  };
}

async function fixture(t: TestContext, respond: (call: RpcCall) => MockReply) {
  const directory = await mkdtemp(join(tmpdir(), "workshare-cli-contract-"));
  const calls: RpcCall[] = [];
  const serverErrors: string[] = [];
  const server = createServer(async (request, response) => {
    try {
      const name = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(request.url ?? "")?.[1];
      assert.equal(request.method, "POST");
      assert.ok(name, `Unexpected mock request: ${request.url}`);
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const call = {
        name,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"),
      };
      calls.push(call);
      const reply = respond(call);
      response.writeHead(reply.status ?? 200, {
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify(reply.body));
    } catch (cause) {
      serverErrors.push(cause instanceof Error ? cause.message : String(cause));
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          code: "MOCK_FAILURE",
          message: "Unexpected mock request",
        }),
      );
    }
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(directory, { recursive: true, force: true });
    assert.deepEqual(serverErrors, []);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const configPath = join(directory, "synthetic-config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      API_URL: `http://127.0.0.1:${address.port}`,
      SERVICE_ROLE_KEY: "synthetic-local-test-key-with-no-database-access",
    }),
    { mode: 0o600 },
  );

  async function run(args: string[]) {
    const env = { ...process.env };
    delete env.SUPABASE_URL;
    delete env.SUPABASE_SERVICE_ROLE_KEY;
    return new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          ["--import", loaderPath, cliPath, ...args, "--config", configPath],
          { cwd: projectRoot, env, timeout: 15_000 },
        );
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
          stdout += chunk;
        });
        child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
          stderr += chunk;
        });
        child.once("error", reject);
        child.once("close", (code) => resolve({ code, stdout, stderr }));
      },
    );
  }
  async function input(value: unknown) {
    const path = join(directory, "input.json");
    await writeFile(path, JSON.stringify(value), { mode: 0o600 });
    return path;
  }
  return { calls, run, input, output: join(directory, "receipt.json") };
}

test("season export explicitly selects the summary RPC and preserves requirement versions", async (t) => {
  const records = [summary(requirements("account-alpha"))];
  const { calls, run, output } = await fixture(t, (call) => {
    assert.equal(call.name, "list_workshare_account_summaries");
    return { body: records };
  });
  const result = await run(["list", "--season", seasonId, "--output", output]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(calls, [
    { name: "list_workshare_account_summaries", body: { season_id: seasonId } },
  ]);
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), records);
  assert.equal((await stat(output)).mode & 0o777, 0o600);
});

test("summary imports update only season requirements using their independent versions", async (t) => {
  const edits = [
    requirements("account-alpha"),
    requirements("account-beta", {
      updatedAt: null,
      generalHoursRequired: 7.25,
      appleCapitalHoursRequired: 4,
    }),
  ];
  const { calls, run, input, output } = await fixture(t, (call) => {
    assert.equal(call.name, "save_workshare_requirements");
    return { body: acceptedRequirements(call) };
  });
  const file = await input(edits.map(summary));
  const result = await run([
    "apply-requirements",
    "--season",
    seasonId,
    "--file",
    file,
    "--output",
    output,
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(
    calls,
    edits.map(({ accountId, ...fields }) => ({
      name: "save_workshare_requirements",
      body: { account_id: accountId, input: fields },
    })),
  );
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), {
    completed: true,
    accounts: edits.map((entry) => ({ ...entry, updatedAt: savedVersion })),
  });
});

test("a mismatched later season aborts the entire requirement file before any write", async (t) => {
  const { calls, run, input, output } = await fixture(t, () => ({
    body: null,
  }));
  const file = await input([
    summary(requirements("account-alpha")),
    summary(requirements("account-beta", { seasonId: otherSeasonId })),
  ]);
  const result = await run([
    "apply-requirements",
    "--season",
    seasonId,
    "--file",
    file,
    "--output",
    output,
  ]);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /match the explicit --season/);
  assert.deepEqual(calls, []);
  await assert.rejects(readFile(output), { code: "ENOENT" });
});

test("requirement writes refuse an implicit season even when the file contains one", async (t) => {
  const { calls, run, input, output } = await fixture(t, () => ({
    body: null,
  }));
  const file = await input([requirements("account-alpha")]);
  const result = await run([
    "apply-requirements",
    "--file",
    file,
    "--output",
    output,
  ]);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /require an explicit --season UUID/);
  assert.deepEqual(calls, []);
  await assert.rejects(readFile(output), { code: "ENOENT" });
});

test("a stale requirements version stops subsequent writes and leaves an exact partial receipt", async (t) => {
  const edits = ["account-alpha", "account-beta", "account-gamma"].map((id) =>
    requirements(id),
  );
  const { calls, run, input, output } = await fixture(t, (call) => {
    assert.equal(call.name, "save_workshare_requirements");
    return call.body.account_id === "account-beta"
      ? {
          status: 409,
          body: {
            code: "40001",
            message: "These season requirements changed. Reload before saving.",
            details: null,
            hint: null,
          },
        }
      : { body: acceptedRequirements(call) };
  });
  const file = await input({ requirements: edits });
  const result = await run([
    "apply-requirements",
    "--season",
    seasonId,
    "--file",
    file,
    "--output",
    output,
  ]);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Stopped after 1 updates/);
  assert.match(result.stderr, /reload versions before retrying/);
  assert.deepEqual(
    calls.map((call) => call.body.account_id),
    ["account-alpha", "account-beta"],
  );
  const receipt = JSON.parse(await readFile(output, "utf8"));
  assert.equal(receipt.completed, false);
  assert.deepEqual(receipt.accounts, [
    { ...edits[0], updatedAt: savedVersion },
  ]);
  assert.match(receipt.error, /save_workshare_requirements:.*changed.*40001/);
  assert.equal((await stat(output)).mode & 0o777, 0o600);
});

test("an existing receipt prevents all writes and is never overwritten", async (t) => {
  const { calls, run, input, output } = await fixture(t, () => ({
    body: null,
  }));
  const file = await input([requirements("account-alpha")]);
  const existing = '{"completed":false,"accounts":["previous run"]}\n';
  await writeFile(output, existing, { mode: 0o600 });
  const result = await run([
    "apply-requirements",
    "--season",
    seasonId,
    "--file",
    file,
    "--output",
    output,
  ]);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /EEXIST/);
  assert.deepEqual(calls, []);
  assert.equal(await readFile(output, "utf8"), existing);
});
