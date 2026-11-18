import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { readFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const configPath = process.argv[2];
if (!configPath) throw new Error("Pass a local supabase status JSON file.");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const base = process.env.WORKSHARE_BROWSER_URL || "http://127.0.0.1:3011";
for (const url of [config.API_URL, base])
  assert.ok(
    ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
    "Checks refuse hosted services.",
  );
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const prefix = `workshare-browser-${randomUUID()}`;
const athleteId = `${prefix}-times`;
const email = "christiancutter02@gmail.com";
const generated = await admin.auth.admin.generateLink({
  type: "magiclink",
  email,
});
assert.ifError(generated.error);
const cookies = [];
const session = createServerClient(config.API_URL, config.PUBLISHABLE_KEY, {
  cookies: {
    getAll: () => [],
    setAll: (values) => cookies.push(...values),
  },
});
assert.ifError(
  (
    await session.auth.verifyOtp({
      token_hash: generated.data.properties.hashed_token,
      type: "magiclink",
    })
  ).error,
);
const browser = await chromium.launch({ headless: true });
const errors = [];
let savedId;
mkdirSync("backups/workshare/browser", { recursive: true });
try {
  assert.ifError(
    (
      await admin.from("people").insert({
        id: `person_${athleteId}`,
        data: { name: "Rostercheck Testswimmer" },
      })
    ).error,
  );
  assert.ifError(
    (
      await admin
        .from("athletes")
        .insert({ id: athleteId, person_id: `person_${athleteId}`, data: {} })
    ).error,
  );
  assert.ifError(
    (
      await admin.from("public_athletes").insert({
        id: athleteId,
        data: {
          id: athleteId,
          name: { first: "Rostercheck", last: "Testswimmer" },
          aliases: ["Rostercheck Testswimmer"],
        },
      })
    ).error,
  );
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  await context.addCookies(
    cookies.map(({ name, value }) => ({
      name,
      value,
      url: base,
      sameSite: "Lax",
    })),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*.supabase.co/**", (route) => {
    errors.push("Attempted hosted request");
    return route.abort();
  });
  await page.goto(base + "/tools/admin");
  await page
    .getByRole("heading", { name: "Accounts & Roster", exact: true })
    .waitFor();
  const navigation = page.getByRole("navigation", { name: "Tools navigation", exact: true });
  const adminLink = navigation.getByRole("link", { name: "Admin", exact: true });
  assert.equal(await adminLink.getAttribute("href"), "/tools/admin");
  assert.equal(await adminLink.getAttribute("aria-current"), "page");
  assert.equal(await adminLink.getAttribute("aria-controls"), null);
  assert.equal(await navigation.getByRole("link", { name: "Velocity Workshare", exact: true }).count(), 0);
  assert.equal(await navigation.getByRole("link", { name: "Accounts & Roster", exact: true }).count(), 0);
  await page
    .getByLabel("Search accounts and athletes", { exact: true })
    .fill(prefix);
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  const form = page.getByRole("form", { name: "New account", exact: true });
  assert.equal(
    await page
      .getByLabel("Search accounts and athletes", { exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page
      .getByLabel("Account archive filter", { exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page
      .getByLabel("Training group filter", { exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Add account", exact: true })
      .isDisabled(),
    true,
  );
  await form.getByLabel("Account full name", { exact: true }).fill(prefix);
  await form.getByLabel("Account / athlete emails").fill("Not an email");
  await form.getByRole("button", { name: "Save account" }).click();
  await form.getByRole("alert").filter({ hasText: "valid email" }).waitFor();
  await form
    .getByLabel("Account / athlete emails")
    .fill("Parent@example.test\nathlete@example.test");
  await form.getByLabel("Current season", { exact: true }).fill("2026–2027");
  await form.getByLabel("General hours required", { exact: true }).fill("0");
  await form
    .getByLabel("Starlight hours required", { exact: true })
    .fill("9.5");
  await form.getByRole("button", { name: "Add athlete", exact: true }).click();
  await form
    .getByLabel("Athlete full name", { exact: true })
    .fill("Rostercheck Fullname");
  await form.getByLabel("Training group", { exact: true }).fill("Juniors");
  await form
    .getByLabel("Search Times database", { exact: true })
    .fill("Rostercheck");
  await form
    .getByRole("button")
    .filter({ hasText: "Rostercheck Testswimmer" })
    .click();
  await form.getByRole("button", { name: "Save account", exact: true }).click();
  await form.waitFor({ state: "detached" });
  let all = await page.evaluate(
    async () => (await (await fetch("/api/workshare/accounts")).json()).data,
  );
  let account = all.find((account) => account.fullName === prefix);
  assert.ok(account);
  savedId = account.id;
  assert.equal(account.generalHoursRequired, 0);
  assert.equal(account.starlightHoursRequired, 9.5);
  assert.equal(account.appleCapitalHoursRequired, null);
  assert.deepEqual(account.emails, [
    "athlete@example.test",
    "parent@example.test",
  ]);
  assert.equal(account.athletes[0].timesAthleteId, athleteId);
  const original = structuredClone(account);
  await page.reload();
  await page
    .getByLabel("Search accounts and athletes", { exact: true })
    .fill(prefix);
  await page
    .getByRole("button", { name: `Edit ${prefix}`, exact: true })
    .click();
  const edit = page.getByRole("form", { name: `Edit ${prefix}`, exact: true });
  await edit.getByLabel("Archive athlete", { exact: true }).check();
  await edit
    .getByLabel("Apple Capital hours required", { exact: true })
    .fill("4");
  await page.setViewportSize({ width: 390, height: 844 });
  const closeSidebar = page.getByRole("button", {
    name: "Close navigation sidebar",
    exact: true,
  });
  if (await closeSidebar.isVisible()) await closeSidebar.click();
  await page.waitForFunction(() => {
    const sidebar = document.querySelector("aside[data-mobile-open]");
    return sidebar && getComputedStyle(sidebar).visibility === "hidden";
  });
  await page.waitForFunction(() => {
    const form = document.querySelector(
      "form[aria-label^='Edit workshare-browser-']",
    );
    return form && form.getBoundingClientRect().width < innerWidth - 30;
  });
  await page.screenshot({
    path: "backups/workshare/browser/mobile-edit.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "The mobile page must contain table overflow.",
  );
  await edit.getByRole("button", { name: "Save account", exact: true }).click();
  await edit.waitFor({ state: "detached" });
  const stale = await page.evaluate(async (input) => {
    const result = await fetch("/api/workshare/accounts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return result.status;
  }, original);
  assert.equal(stale, 409);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page
    .getByRole("button", { name: `Edit ${prefix}`, exact: true })
    .click();
  await edit.getByLabel("Archive account", { exact: true }).check();
  await edit.getByRole("button", { name: "Save account", exact: true }).click();
  await edit.waitFor({ state: "detached" });
  assert.equal(
    await page
      .getByRole("button", { name: `Edit ${prefix}`, exact: true })
      .count(),
    0,
  );
  await page
    .getByLabel("Account archive filter", { exact: true })
    .selectOption("archived");
  await page
    .getByRole("button", { name: `Edit ${prefix}`, exact: true })
    .waitFor();
  all = await page.evaluate(
    async () => (await (await fetch("/api/workshare/accounts")).json()).data,
  );
  account = all.find((account) => account.id === savedId);
  assert.equal(account.isArchived, true);
  assert.equal(account.athletes[0].isArchived, true);
  assert.equal(account.athletes[0].id, original.athletes[0].id);
  assert.equal(account.appleCapitalHoursRequired, 4);
  await page.screenshot({
    path: "backups/workshare/browser/desktop.png",
    fullPage: true,
  });
  for (const path of [
    "jobs",
    "logs",
    "admin/settings",
    "admin/roster",
    "overview",
    "admin/families",
    "admin/families/legacy-account",
  ]) {
    await page.goto(base + "/tools/workshare/" + path);
    await page.waitForURL(base + "/tools/admin");
  }
  const denied = await (
    await context.newPage()
  ).request.get(base + "/api/workshare");
  assert.equal(denied.status(), 404);
  assert.deepEqual(errors, []);
  console.log(
    "Accounts browser checks passed: validation, create, persistence, Times link, archive, stale-write conflict, retired routes, mobile overflow.",
  );
} finally {
  if (savedId)
    assert.ifError(
      (await admin.from("workshare_accounts").delete().eq("id", savedId)).error,
    );
  assert.ifError(
    (await admin.from("public_athletes").delete().eq("id", athleteId)).error,
  );
  assert.ifError(
    (await admin.from("athletes").delete().eq("id", athleteId)).error,
  );
  assert.ifError(
    (await admin.from("people").delete().eq("id", `person_${athleteId}`)).error,
  );
  await browser.close();
}
