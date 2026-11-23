import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

// WebAuthn needs a domain RP ID. Use localhost rather than the numeric loopback
// address; supabase/config.toml explicitly allows this origin.
const base = "http://localhost:3001";
const config = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], {
  encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
}));
assert.equal(config.API_URL, "http://127.0.0.1:54321", "Passkey checks require the local backend.");
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const email = "christiancutter02@gmail.com";
const listed = await admin.auth.admin.listUsers();
assert.ifError(listed.error);
const user = listed.data.users.find((candidate) => candidate.email === email);
assert.ok(user, "Run seed:local before the browser check.");
const browser = await chromium.launch({ headless: true });
let createdPasskeyId;
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.route("**/*.supabase.co/**", (route) => { errors.push("Refused hosted backend"); return route.abort(); });
  page.on("pageerror", (error) => errors.push(error.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });

  await page.goto(base + "/login");
  await page.getByRole("button", { name: /password instead/i }).click();
  await page.locator("input[type=email]").fill(email);
  await page.locator("input[type=password]").fill("Velocity-local-test-2026!");
  await page.locator("button[type=submit]").click();
  await page.waitForURL(base + "/tools");
  const account = page.getByRole("region", { name: "Account management", exact: true });
  await account.getByRole("button", { name: "Manage Account", exact: true }).click();
  const verification = page.waitForResponse(response => response.url().endsWith("/auth/v1/passkeys/registration/verify") && response.request().method() === "POST");
  await account.getByRole("button", { name: "Create passkey", exact: true }).click();
  const registered = await verification;
  assert.ok(registered.ok(), `Passkey registration returned ${registered.status()}`);
  createdPasskeyId = (await registered.json()).id;
  assert.ok(createdPasskeyId, "The backend returned a persisted passkey ID");
  await account.getByRole("status").filter({ hasText: "Passkey created" }).waitFor();
  await account.getByRole("list", { name: "Your passkeys", exact: true }).waitFor();
  const passkeys = await admin.auth.admin.passkey.listPasskeys({ userId: user.id });
  assert.ifError(passkeys.error);
  assert.ok(passkeys.data.some(passkey => passkey.id === createdPasskeyId), "The passkey belongs to the existing account");

  await account.getByRole("group", { name: "Signed-in account", exact: true }).getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByText("Tools are temporarily locked", { exact: true }).waitFor();
  await page.goto(base + "/login");
  const authentication = page.waitForResponse(response => response.url().endsWith("/auth/v1/passkeys/authentication/verify") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Sign in with passkey", exact: true }).click();
  const authenticated = await authentication;
  assert.ok(authenticated.ok(), `Passkey sign-in returned ${authenticated.status()}`);
  assert.equal((await authenticated.json()).user.id, user.id, "Passkey sign-in restores the same account");
  await page.waitForURL(base + "/tools");
  await account.getByRole("group", { name: "Signed-in account", exact: true }).getByText(email, { exact: true }).waitFor();
  await account.getByRole("group", { name: "Signed-in account", exact: true }).getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByText("Tools are temporarily locked", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log("Verified real passkey creation, backend persistence, sign-out, and passwordless sign-in to the same account using a virtual WebAuthn authenticator.");
} finally {
  await browser.close();
  if (createdPasskeyId) {
    const removed = await admin.auth.admin.passkey.deletePasskey({ userId: user.id, passkeyId: createdPasskeyId });
    assert.ifError(removed.error);
  }
}
