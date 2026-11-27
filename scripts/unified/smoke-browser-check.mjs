import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { assertLocalBackend, localSupabase } from "../local-supabase.mjs";
import { artifactPath } from "../verification-artifacts.mjs";

// A short check of released workflows. Fixtures belong only to this run;
// existing users, athlete preferences, seasons, and accounts stay untouched.
const base = process.env.VELOCITY_BROWSER_URL ?? "http://127.0.0.1:3001";
assertLocalBackend(base);
const config = localSupabase();
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const prefix = `smoke-${randomUUID()}`;
const password = `Velocity-${randomUUID()}!`;
const users = [];
const errors = [];
let browser;
let page;

function checked(result) {
  assert.ifError(result.error);
  return result.data;
}

async function newPage() {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      return route.continue();
    // No live email, identity provider, or hosted backend is used by this suite.
    if (url.hostname.endsWith(".supabase.co"))
      errors.push("Attempted hosted backend request");
    return route.abort();
  });
  const next = await context.newPage();
  next.setDefaultTimeout(30_000);
  next.on("pageerror", (error) => errors.push(error.message));
  return next;
}

async function signIn(target, email) {
  await target.goto(`${base}/login`);
  await target.getByRole("button", { name: /password instead/i }).click();
  await target.locator('input[type="email"]').fill(email);
  await target.locator('input[type="password"]').fill(password);
  await target.locator('button[type="submit"]').click();
  await target.waitForURL(`${base}/tools`);
  await target.getByRole("heading", { name: "Account", exact: true }).waitFor();
  await target
    .getByRole("group", { name: "Signed-in account" })
    .getByText(email, { exact: true })
    .waitFor();
}

try {
  const memberEmail = `${prefix}@example.test`;
  const staffEmail = `${prefix}@velocity-swimming.com`;
  for (const email of [memberEmail, staffEmail]) {
    const { user } = checked(
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      }),
    );
    users.push(user.id);
  }
  browser = await chromium.launch({ headless: true });
  page = await newPage();
  assert.equal(
    (await page.request.get(`${base}/api/workshare/accounts`)).status(),
    401,
  );

  // Password sign-in, account settings, and persistent athlete selection.
  await signIn(page, memberEmail);
  assert.equal(
    (await page.request.get(`${base}/api/workshare/accounts`)).status(),
    403,
  );
  await page
    .getByRole("button", { name: "Manage Account", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Sign-in methods", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Manage Account", exact: true })
    .click();
  const tracking = page.getByRole("region", {
    name: "Athlete Tracking",
    exact: true,
  });
  await tracking
    .getByRole("button", { name: "Add primary athlete", exact: true })
    .click();
  await tracking
    .getByLabel("Search for a primary athlete", { exact: true })
    .fill("Avery Example");
  await tracking
    .getByRole("button", {
      name: "Select Avery Example as primary athlete",
      exact: true,
    })
    .click();
  await tracking
    .getByRole("status")
    .filter({ hasText: "Athletes saved" })
    .waitFor();
  await page.reload();
  await tracking
    .getByRole("list", { name: "Selected primary athlete", exact: true })
    .getByText("Avery Example", { exact: true })
    .waitFor();

  // A released Times page consumes the saved preference and actual seeded results.
  await page.goto(`${base}/tools/my-times`);
  const times = page.getByRole("region", {
    name: "Athlete times",
    exact: true,
  });
  await times
    .getByRole("button", { name: "Athlete: Avery Example", exact: true })
    .waitFor();
  await times.getByRole("button", { name: /^View:/ }).click();
  await times
    .getByRole("group", { name: "View options", exact: true })
    .getByRole("button", { name: "Bests Grid", exact: true })
    .click();
  const result = times.getByRole("button", {
    name: "View 100 Freestyle rankings",
    exact: true,
  });
  await result.waitFor();
  assert.match(await result.innerText(), /1:0[45]\.00/);
  await result.click();
  await page.waitForURL((url) => url.pathname === "/tools/rankings");
  await page
    .getByRole("row")
    .filter({ hasText: "Avery Example" })
    .first()
    .waitFor();
  await page.goto(`${base}/tools`);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("heading", { name: "Access restricted", exact: true })
    .waitFor();
  await page.goto(`${base}/tools`);
  await page.waitForURL((url) => url.pathname === "/login");
  assert.equal(
    (await page.request.get(`${base}/api/workshare/accounts`)).status(),
    401,
  );
  await page.context().close();

  // Domain staff can edit roster accounts without gaining the owner's Data tool.
  page = await newPage();
  await signIn(page, staffEmail);
  assert.equal(
    (await page.request.get(`${base}/api/data?kind=swim`)).status(),
    403,
  );
  await page.goto(`${base}/tools/admin`);
  const search = page.getByRole("searchbox", {
    name: "Search accounts and athletes",
    exact: true,
  });
  await search.fill(prefix);
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  const editor = page.getByRole("complementary", {
    name: "Account editor",
    exact: true,
  });
  await editor.getByLabel("Account full name", { exact: true }).fill(prefix);
  await editor
    .getByRole("button", { name: "Account settings", exact: true })
    .click();
  await editor
    .getByLabel("Account / athlete emails", { exact: true })
    .fill(memberEmail);
  await editor
    .getByRole("button", { name: "Add athlete", exact: true })
    .click();
  await editor
    .getByLabel("Athlete full name", { exact: true })
    .fill(`${prefix} Swimmer`);
  await editor
    .getByRole("button", {
      name: `Athlete settings: ${prefix} Swimmer`,
      exact: true,
    })
    .click();
  await editor.getByText("Juniors", { exact: true }).click();
  assert.equal(
    await editor
      .getByRole("radio", { name: "Juniors", exact: true })
      .isChecked(),
    true,
  );
  await editor
    .getByRole("status")
    .filter({ hasText: "All changes saved" })
    .waitFor();
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  await page.reload();
  await search.fill(prefix);
  const row = page
    .getByRole("row")
    .filter({ has: page.getByText(prefix, { exact: true }) });
  await row.getByText(`${prefix} Swimmer`, { exact: true }).waitFor();
  await row.getByText("Juniors", { exact: true }).waitFor();
  const stored = checked(
    await admin
      .from("workshare_accounts")
      .select("id")
      .eq("full_name", prefix)
      .single(),
  );
  assert.deepEqual(
    checked(
      await admin
        .from("workshare_account_emails")
        .select("email")
        .eq("account_id", stored.id),
    ),
    [{ email: memberEmail }],
  );
  assert.deepEqual(errors, []);
  console.log(
    "Browser smoke passed: sign-in/out, account settings, athlete preferences, My Times/rankings, and staff roster autosave/access.",
  );
} catch (error) {
  if (page && !page.isClosed()) {
    const screenshot = artifactPath("smoke/failure.png");
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    console.error(`Smoke failure screenshot: ${screenshot}`);
  }
  throw error;
} finally {
  await browser?.close();
  checked(
    await admin.from("workshare_accounts").delete().eq("full_name", prefix),
  );
  for (const id of users) checked(await admin.auth.admin.deleteUser(id));
}
