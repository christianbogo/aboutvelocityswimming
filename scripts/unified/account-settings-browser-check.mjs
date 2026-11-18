import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

// This harness uses synthetic in-memory Auth and RPC responses, never a hosted
// account, password, or athlete preference. Run against an isolated source copy.
const appDir = process.env.ACCOUNT_TEST_APP_DIR;
assert.ok(appDir, "Set ACCOUNT_TEST_APP_DIR to an isolated copy of the app.");
assert.notEqual(resolve(appDir), process.cwd(), "Do not start a second dev server in the active checkout.");
const appPort = Number(process.env.ACCOUNT_TEST_PORT || 3021);
const base = `http://127.0.0.1:${appPort}`;
const userId = "00000000-0000-4000-8000-000000000001";
const email = "christiancutter02@gmail.com";
const user = {
  id: userId, aud: "authenticated", role: "authenticated", email,
  email_confirmed_at: "2026-11-18T00:00:00Z", confirmed_at: "2026-11-18T00:00:00Z",
  created_at: "2026-11-18T00:00:00Z", updated_at: "2026-11-18T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email", "google"] }, user_metadata: {},
  identities: [{ id: "google-fixture", identity_id: "google-fixture", user_id: userId, provider: "google", identity_data: { email } }],
};
const athletes = ["Avery", "Blake", "Casey"].map((name, i) => ({ id: `athlete-fixture-${i}`, name: `${name} Accountcheck`, team_name: "Synthetic Swimming" }));
let selection = [];
const passwordUpdates = [];
const unknownRequests = [];
let failNextSave = false;
let holdNextSave;
let releaseHeldSave;
let activeSaves = 0;
let maxConcurrentSaves = 0;
let saveCount = 0;
const json = (response, status, value) => {
  response.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS" });
  response.end(JSON.stringify(value));
};
const backend = createServer(async (request, response) => {
  if (request.method === "OPTIONS") return json(response, 200, {});
  const url = new URL(request.url, "http://fixture.local");
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  if (url.pathname === "/auth/v1/token") {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: userId, email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600 })}.synthetic-signature`;
    return json(response, 200, { access_token: token, refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, user });
  }
  if (url.pathname === "/auth/v1/user") {
    if (request.method === "PUT") passwordUpdates.push(body);
    return json(response, 200, user);
  }
  if (url.pathname === "/auth/v1/passkeys") return json(response, 200, []);
  if (url.pathname === "/auth/v1/logout") return json(response, 200, {});
  if (["/rest/v1/rpc/is_staff", "/rest/v1/rpc/is_workshare_staff"].includes(url.pathname)) return json(response, 200, true);
  if (url.pathname === "/rest/v1/rpc/read_my_workshare_summary") return json(response, 200, { seasons: [], seasonId: null, accounts: [] });
  if (url.pathname === "/rest/v1/public_athletes") return json(response, 200, athletes.map((athlete, index) => ({ id: athlete.id, public_swims: [{ count: 10 + index }] })));
  if (url.pathname === "/rest/v1/family_emails") return json(response, 200, []);
  if (url.pathname === "/rest/v1/rpc/get_account_athletes") return json(response, 200, selection);
  if (url.pathname === "/rest/v1/rpc/search_account_athletes") return json(response, 200, athletes.filter((athlete) => athlete.name.toLowerCase().includes(body.search_text.toLowerCase())));
  if (url.pathname === "/rest/v1/rpc/save_account_athletes") {
    activeSaves++;
    maxConcurrentSaves = Math.max(maxConcurrentSaves, activeSaves);
    saveCount++;
    if (holdNextSave) {
      const held = holdNextSave;
      holdNextSave = undefined;
      await held;
    }
    activeSaves--;
    if (failNextSave) {
      failNextSave = false;
      return json(response, 503, { message: "Synthetic save failure" });
    }
    assert.equal(body.account_user_id, userId);
    selection = athletes.filter((athlete) => athlete.id === body.primary_id || body.favorite_ids.includes(athlete.id)).map((athlete) => ({ ...athlete, is_primary: athlete.id === body.primary_id }));
    return json(response, 200, selection);
  }
  unknownRequests.push(`${request.method} ${url.pathname}`);
  json(response, 404, { message: "Unconfigured synthetic response" });
});
backend.listen(0, "127.0.0.1");
await once(backend, "listening");
const backendUrl = `http://127.0.0.1:${backend.address().port}`;
const dev = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(appPort)], {
  cwd: appDir,
  env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: backendUrl, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_fixture", NEXT_PUBLIC_GOOGLE_AUTH_ENABLED: "true", VELOCITY_TEST_BUILD: "true" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
dev.stdout.on("data", (chunk) => { serverLog += chunk; });
dev.stderr.on("data", (chunk) => { serverLog += chunk; });
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function eventually(condition, message, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await condition()) return;
    if (dev.exitCode !== null) throw new Error(`Local app stopped: ${serverLog}`);
    await pause(50);
  }
  assert.fail(message);
}
let browser;
try {
  await eventually(async () => { try { return (await fetch(base + "/login")).ok; } catch { return false; } }, "Local app did not become ready", 60000);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*.supabase.co/**", (route) => { pageErrors.push("Refused hosted backend"); return route.abort(); });
  await page.goto(base + "/login");
  await page.getByRole("button", { name: "Sign in with password instead", exact: true }).click();
  await page.locator("input[type=email]").fill(email);
  await page.locator("input[type=password]").fill("Synthetic-login-only-2026!");
  await page.getByRole("button", { name: "Sign In with Password", exact: true }).click();
  await page.waitForURL(base + "/tools");
  const account = page.getByRole("region", { name: "Account management", exact: true });
  const settingsButton = account.getByRole("button", { name: "Account Sign-in Settings", exact: true });
  await settingsButton.waitFor();
  assert.equal(await settingsButton.getAttribute("aria-expanded"), "false");
  assert.equal(await account.getByRole("heading", { name: "Sign-in methods", exact: true }).count(), 0);
  const signOutBox = await account.getByRole("button", { name: "Sign out", exact: true }).boundingBox();
  const settingsBox = await settingsButton.boundingBox();
  assert.ok(settingsBox.x < signOutBox.x, "Settings button is to the left of Sign out");
  await settingsButton.click();
  const settings = account.getByRole("region", { name: "Account Sign-in Settings", exact: true });
  await settings.getByRole("button", { name: "Google linked", exact: true }).waitFor();
  const password = settings.getByLabel("New password", { exact: true });
  const confirmation = settings.getByLabel("Confirm password", { exact: true });
  await password.fill("Synthetic-password-2026!");
  await confirmation.fill("Different-password-2026!");
  await settings.getByRole("button", { name: "Save password", exact: true }).click();
  await settings.getByRole("alert").filter({ hasText: /don.t match/ }).waitFor();
  assert.deepEqual(passwordUpdates, [], "Mismatched passwords are never submitted");
  await confirmation.fill("Synthetic-password-2026!");
  await settings.getByRole("button", { name: "Save password", exact: true }).click();
  await settings.getByRole("status").filter({ hasText: "Password saved" }).waitFor();
  assert.deepEqual(passwordUpdates, [{ password: "Synthetic-password-2026!", code_challenge: null, code_challenge_method: null }]);
  assert.equal(await password.inputValue(), "");
  assert.equal(await confirmation.inputValue(), "");
  await settingsButton.click();

  const workshare = account.getByRole("region", { name: "Workshare Tracking", exact: true });
  await workshare.getByText("No Workshare account is linked to your sign-in email.", { exact: true }).waitFor();
  const following = account.getByRole("region", { name: "Athlete Tracking", exact: true });
  assert.equal(await following.locator("h2 + p").count(), 0, "Following subtitle is removed");
  assert.equal(await following.locator("h2 svg").count(), 0);
  assert.equal(await following.getByRole("button", { name: "Save athletes", exact: true }).count(), 0);
  const primary = following.getByLabel("Search for a primary athlete", { exact: true });
  const favorites = following.getByLabel("Search for favorite athletes", { exact: true });
  const choosePrimary = async (athlete) => { await following.getByRole("button", { name: "Add primary athlete", exact: true }).click(); await primary.fill(athlete.name); await following.getByRole("button", { name: `Select ${athlete.name} as primary athlete`, exact: true }).click(); };
  const addFavorite = async (athlete) => { await following.getByRole("button", { name: "Add favorite athlete", exact: true }).click(); await favorites.fill(athlete.name); await following.getByRole("button", { name: `Add ${athlete.name} to favorite athletes`, exact: true }).click(); };
  const removeFavorite = (athlete) => following.getByRole("button", { name: `Remove ${athlete.name} from favorite athletes`, exact: true });
  holdNextSave = new Promise((done) => { releaseHeldSave = done; });
  await choosePrimary(athletes[0]);
  await eventually(() => activeSaves === 1, "Autosave did not start");
  await addFavorite(athletes[1]);
  assert.equal(activeSaves, 1);
  releaseHeldSave();
  await eventually(() => selection.length === 2 && activeSaves === 0, "Rapid edits did not persist together");
  await following.getByRole("status").filter({ hasText: "Athletes saved" }).waitFor();
  assert.equal(maxConcurrentSaves, 1, "Autosaves are serialized");
  assert.ok(saveCount >= 2, "The newer draft is saved after the first request");
  failNextSave = true;
  await removeFavorite(athletes[1]).click();
  await following.getByRole("alert").filter({ hasText: /couldn.t save/ }).waitFor();
  assert.equal(selection.length, 2, "Failed saves preserve stored data");
  assert.equal(await removeFavorite(athletes[1]).count(), 0, "Failed saves preserve the visible newer selection");
  await following.getByRole("button", { name: "Retry saving athletes", exact: true }).click();
  await eventually(() => selection.length === 1, "Retry did not save the pending selection");
  await following.getByRole("status").filter({ hasText: "Athletes saved" }).waitFor();
  await page.reload();
  await following.getByRole("button", { name: `Remove ${athletes[0].name} as primary athlete`, exact: true }).waitFor();
  assert.equal(await removeFavorite(athletes[1]).count(), 0, "Autosaved removal persists on reload");
  await page.screenshot({ path: "/tmp/velocity-account-settings-desktop.png", fullPage: true, animations: "disabled" });

  const sidebar = page.getByRole("complementary", { name: "Navigation sidebar", exact: true });
  const home = sidebar.getByRole("link", { name: "Leave Tools", exact: true });
  const expand = sidebar.getByRole("button", { name: "Open navigation sidebar", exact: true });
  const accountLink = sidebar.getByRole("link", { name: "Account", exact: true });
  assert.equal(await sidebar.getByRole("button", { name: "Collapse navigation sidebar", exact: true }).count(), 0);
  assert.equal(await sidebar.getByRole("button", { name: "Sign Out", exact: true }).count(), 0);
  assert.equal(await expand.count(), 0, "Expanded sidebar has no collapse or expand footer button");
  assert.equal(await home.getAttribute("href"), "/");
  assert.ok(await home.getByText("Leave Tools", { exact: true }).isVisible());
  await accountLink.press("[");
  await eventually(async () => Math.round((await sidebar.boundingBox()).width) === 72, "Collapsed sidebar is not an icon rail");
  const navLinks = sidebar.getByRole("navigation", { name: "Tools navigation", exact: true }).getByRole("link");
  for (const link of await navLinks.all()) {
    assert.ok(await link.isVisible());
    assert.ok(await link.getAttribute("aria-label"), "Icon links keep accessible labels");
    assert.equal(await link.locator("svg").count(), 1);
    assert.equal(await link.locator("span").isVisible(), false, "Collapsed labels are hidden visually");
  }
  assert.ok(await home.isVisible());
  assert.ok(await expand.isVisible(), "Collapsed sidebar keeps the expand button");
  await page.screenshot({ path: "/tmp/velocity-account-sidebar-icons.png", fullPage: true, animations: "disabled" });
  await expand.press("Enter");
  await eventually(async () => Math.round((await sidebar.boundingBox()).width) === 256, "Expand restores the full sidebar");
  await eventually(async () => accountLink.evaluate((link) => document.activeElement === link), "Expanding restores focus to the current navigation link");
  assert.equal(await expand.count(), 0);
  await accountLink.press("[");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("[data-tool-sidebar] > header").getByRole("button", { name: "Open navigation sidebar", exact: true }).click();
  await eventually(async () => (await sidebar.boundingBox()).width > 180, "Mobile drawer did not retain full labels");
  assert.ok(await sidebar.getByRole("navigation", { name: "Tools navigation", exact: true }).getByRole("link", { name: "Account", exact: true }).locator("span").isVisible());
  assert.equal(await expand.count(), 0, "Mobile drawer has no desktop expand or collapse button");
  assert.ok(await home.getByText("Leave Tools", { exact: true }).isVisible());
  await page.screenshot({ path: "/tmp/velocity-account-settings-mobile.png", fullPage: true, animations: "disabled" });
  await page.keyboard.press("Escape");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Mobile layout does not overflow");
  assert.deepEqual(unknownRequests, []);
  assert.deepEqual(pageErrors, []);
  console.log("Verified synthetic account settings disclosure, password validation/save, serialized athlete autosave/retry/reload, desktop icon rail, and mobile drawer.");
} finally {
  releaseHeldSave?.();
  await browser?.close();
  dev.kill("SIGTERM");
  await writeFile("/tmp/velocity-account-settings-browser.log", serverLog);
  backend.closeAllConnections();
  await new Promise((done) => backend.close(done));
}
