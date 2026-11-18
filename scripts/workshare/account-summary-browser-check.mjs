import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const localEnv = Object.fromEntries(readFileSync(process.env.WORKSHARE_LOCAL_ENV_FILE ?? "supabase/.env.local", "utf8")
  .split("\n").filter((line) => line.includes("="))
  .map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1)]; }));
const api = localEnv.NEXT_PUBLIC_SUPABASE_URL;
const base = process.env.WORKSHARE_BROWSER_URL ?? "http://127.0.0.1:3013";
for (const url of [api, base])
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname), "Checks refuse hosted services.");
const admin = createClient(api, localEnv.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const prefix = `summary-browser-${randomUUID().slice(0, 12)}`;
const users = [];
const accountIds = ["active", "archived", "unrelated"].map((suffix) => `${prefix}-${suffix}`);
const seasonId = randomUUID();
const ticketIds = [];
const errors = [];
const evidence = "backups/workshare/account-summary-browser";
mkdirSync(evidence, { recursive: true });
let browser;

async function check(result) {
  assert.ifError(result.error);
  return result.data;
}
async function session(domain, metadata = {}) {
  const email = `${prefix}-${users.length}@${domain}`;
  const password = `Aa1!${randomUUID()}`;
  const created = await check(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: metadata }));
  users.push(created.user.id);
  const jar = new Map();
  const client = createServerClient(api, localEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (values) => values.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  await check(await client.auth.signInWithPassword({ email, password }));
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: base, sameSite: "Lax" })));
  await context.route("**/*.supabase.co/**", (route) => { errors.push("Refused hosted request"); return route.abort(); });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  return { email, client, context, page };
}

try {
  browser = await chromium.launch({ headless: true });
  const staff = await session("velocity-swimming.com");
  assert.equal(await check(await staff.client.rpc("is_workshare_staff")), true, "Verified exact domain receives Workshare staff authority");
  assert.equal(await check(await staff.client.rpc("is_staff")), false, "Domain rule does not grant other backend staff privileges");
  await check(await admin.from("workshare_accounts").insert(accountIds.map((id, index) => ({
    id, full_name: `${prefix} ${["Active Account", "Archived Account", "Private Account"][index]}`, is_archived: index === 1,
  }))));
  await check(await admin.from("workshare_account_emails").insert([
    { account_id: accountIds[0], email: staff.email },
    { account_id: accountIds[0], email: `${prefix}-private@example.test` },
    { account_id: accountIds[1], email: staff.email },
    { account_id: accountIds[2], email: `${prefix}-other@example.test` },
  ]));
  const existing = await check(await admin.from("workshare_seasons").select("starts_on,ends_on"));
  let year = 2400;
  while (existing.some((season) => season.starts_on <= `${year}-12-31` && season.ends_on >= `${year}-01-01`)) year += 1;
  await check(await admin.from("workshare_seasons").insert({ id: seasonId, name: `${prefix} Season`, starts_on: `${year}-01-01`, ends_on: `${year}-12-31` }));
  await check(await admin.from("workshare_account_requirements").insert([
    { account_id: accountIds[0], season_id: seasonId, general_hours_required: 12, starlight_hours_required: 0, apple_capital_hours_required: null },
    { account_id: accountIds[1], season_id: seasonId, general_hours_required: 8, starlight_hours_required: null, apple_capital_hours_required: 16 },
  ]));
  for (const [accountId, category, hours] of [[accountIds[0], "general", 3.75], [accountIds[1], "apple_capital", 2.5], [accountIds[2], "general", 99]]) {
    const id = randomUUID(); ticketIds.push(id);
    await check(await admin.rpc("create_workshare_ticket", { input: { id, accountId, seasonId, completedOn: `${year}-06-01`, description: `${prefix} Timing`, category, hours } }));
  }

  let failFirstSummary = true;
  await staff.page.route("**/api/account/workshare*", (route) => {
    if (!failFirstSummary) return route.continue();
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic transient failure" }) });
  });
  await staff.page.goto(base + "/tools");
  await staff.page.getByRole("heading", { name: "Account", exact: true, level: 1 }).waitFor();
  const tracking = staff.page.getByRole("region", { name: "Workshare Tracking", exact: true });
  await tracking.waitFor();
  await tracking.getByRole("alert").waitFor();
  failFirstSummary = false;
  await tracking.getByRole("button", { name: "Retry Workshare tracking", exact: true }).click();
  await tracking.getByRole("combobox").waitFor();
  await tracking.getByRole("combobox").selectOption(seasonId);
  await tracking.getByText("3.75/12", { exact: true }).waitFor();
  await tracking.getByText("0/0", { exact: true }).waitFor();
  await tracking.getByText("2.5/16", { exact: true }).waitFor();
  assert.equal(await tracking.getByText(`${prefix} Private Account`, { exact: true }).count(), 0);
  const workshareBox = await tracking.boundingBox();
  const athleteBox = await staff.page.getByRole("region", { name: /^Athlete (Tracking|following)$/i }).boundingBox();
  assert.ok(workshareBox && athleteBox && workshareBox.y < athleteBox.y, "Workshare Tracking appears above Athlete Tracking");
  await staff.page.screenshot({ path: `${evidence}/desktop.png`, fullPage: true, animations: "disabled" });
  await staff.page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await staff.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Mobile page does not overflow horizontally");
  await staff.page.screenshot({ path: `${evidence}/mobile.png`, fullPage: true, animations: "disabled" });
  const response = await staff.context.request.get(base + `/api/account/workshare?seasonId=${seasonId}`);
  assert.equal(response.status(), 200);
  assert.equal(response.headers()["cache-control"], "private, no-store");
  const summary = (await response.json()).data;
  assert.equal(summary.accounts.length, 2);
  for (const account of summary.accounts) for (const key of ["emails", "athletes", "tickets", "updatedAt"]) assert.ok(!(key in account));
  assert.equal((await staff.context.request.get(base + `/api/account/workshare?accountId=${accountIds[2]}`)).status(), 400);
  assert.equal((await staff.context.request.get(base + "/api/account/workshare?seasonId=invalid")).status(), 400);
  assert.equal((await staff.context.request.get(base + `/api/account/workshare?seasonId=${seasonId}&seasonId=${seasonId}`)).status(), 400);
  assert.equal((await staff.context.request.get(base + `/api/account/workshare?seasonId=${randomUUID()}`)).status(), 404);
  assert.equal((await staff.context.request.get(base + "/api/times")).status(), 403, "Other Tools remain restricted to the owner");
  assert.equal((await staff.context.request.get(base + "/api/workshare/accounts")).status(), 200, "Domain staff can use Admin APIs");

  const other = await session("example.test", { email: staff.email, staff: true });
  const unrelated = await other.context.request.get(base + `/api/account/workshare?seasonId=${seasonId}`);
  assert.equal(unrelated.status(), 200);
  assert.deepEqual((await unrelated.json()).data.accounts, [], "Editable metadata cannot claim another association");
  assert.equal((await other.context.request.get(base + "/api/workshare/accounts")).status(), 403);
  const anonymous = await browser.newContext();
  assert.equal((await anonymous.request.get(base + "/api/account/workshare")).status(), 401);
  await anonymous.close();
  assert.deepEqual(errors, []);
  console.log("Workshare Tracking desktop/mobile, association privacy, API validation and scoped domain staff checks passed.");
} finally {
  await browser?.close();
  if (ticketIds.length) await admin.from("workshare_tickets").delete().in("id", ticketIds);
  await admin.from("workshare_account_requirements").delete().eq("season_id", seasonId);
  await admin.from("workshare_seasons").delete().eq("id", seasonId);
  await admin.from("workshare_accounts").delete().in("id", accountIds);
  if (ticketIds.length) await admin.from("workshare_ticket_create_keys").delete().in("id", ticketIds);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}
