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
let page;
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
  page = await context.newPage();
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
  const form = page.locator("form[aria-label=\"New account\"], form[aria-label^=\"Edit workshare-browser-\"]");
  assert.equal(
    await page
      .getByLabel("Search accounts and athletes", { exact: true })
      .isDisabled(),
    false,
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
  await form.getByLabel("Account full name", { exact: true }).fill(`${prefix}-cancel`);
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await form.waitFor({ state: "detached" });
  await page.waitForTimeout(800);
  const cancelled = await page.evaluate(async (name) =>
    (await (await fetch("/api/workshare/accounts")).json()).data.find((item) => item.fullName === name),
  `${prefix}-cancel`);
  assert.equal(cancelled, undefined, "Cancelling before autosave must not create a phantom account.");
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  assert.deepEqual(await page.getByRole("columnheader").allTextContents(), [
    "Account", "Athletes", "General", "Starlight", "Apple Capital", "Actions",
  ]);
  assert.equal(await form.getByLabel("Current season", { exact: true }).count(), 0);
  assert.equal(await form.getByRole("button", { name: "Save account", exact: true }).count(), 0);

  // Observe persisted state without submitting or closing the editor.
  async function waitForAccount(fields = {}, athlete = {}) {
    let account;
    for (let attempt = 0; attempt < 100; attempt++) {
      const accounts = await page.evaluate(async () =>
        (await (await fetch("/api/workshare/accounts", { cache: "no-store" })).json()).data
      );
      account = accounts.find((item) => item.fullName === prefix);
      if (account) savedId = account.id;
      if (account && Object.entries(fields).every(([key, value]) =>
        JSON.stringify(account[key]) === JSON.stringify(value)
      ) && Object.entries(athlete).every(([key, value]) =>
        JSON.stringify(account.athletes[0]?.[key]) === JSON.stringify(value)
      )) break;
      await page.waitForTimeout(100);
      if (attempt === 99) assert.fail(`Autosave did not persist expected changes: ${JSON.stringify({ fields, athlete, account })}`);
    }
    savedId = account.id;
    return account;
  }

  await form.getByLabel("Account full name", { exact: true }).fill(prefix);
  await form.getByLabel("Account / athlete emails").fill("Not an email");
  await form.getByRole("alert").filter({ hasText: "valid email" }).waitFor();
  await form
    .getByLabel("Account / athlete emails")
    .fill("Parent@example.test\nathlete@example.test");
  await form.getByLabel("General hours required", { exact: true }).fill("0");
  await form.getByLabel("Starlight hours required", { exact: true }).fill("9.5");
  await form.getByRole("button", { name: "Add athlete", exact: true }).click();
  await form.getByLabel("Athlete full name", { exact: true }).fill("Rostercheck Fullname");
  await form.getByRole("combobox", { name: "Training group", exact: true }).selectOption("Juniors");
  await form.getByLabel("Search Times database", { exact: true }).fill("Rostercheck");
  await form.getByRole("button").filter({ hasText: "Rostercheck Testswimmer" }).click();
  assert.equal(await form.getByLabel("Search Times database", { exact: true }).count(), 0);
  assert.equal(await form.getByPlaceholder("Change Times link…").count(), 0);
  let account = await waitForAccount({
    generalHoursRequired: 0,
    starlightHoursRequired: 9.5,
    appleCapitalHoursRequired: null,
    emails: ["athlete@example.test", "parent@example.test"],
  }, {
    fullName: "Rostercheck Fullname",
    trainingGroup: "Juniors",
    timesAthleteId: athleteId,
  });
  assert.ok(account.athletes[0].id, "Autosave assigns new athletes persistent identities.");
  const original = structuredClone(account);
  assert.equal(await form.isVisible(), true, "Autosave must keep the editor open.");
  await form.getByRole("button", { name: "Done", exact: true }).click();
  await form.waitFor({ state: "detached" });

  let row = page.getByRole("row").filter({ has: page.getByText(prefix, { exact: true }) });
  let cells = row.getByRole("cell");
  assert.equal(await cells.count(), 6);
  assert.equal(await cells.nth(1).getByRole("img", { name: "Linked to Times", exact: true }).count(), 1);
  assert.equal(/Times linked|Times unlinked/.test(await cells.nth(1).textContent()), false);
  assert.equal(await cells.nth(1).textContent().then((value) => value.includes(athleteId)), false);
  assert.equal((await cells.nth(2).textContent()).replace(/\s/g, ""), "0/0");
  assert.equal((await cells.nth(3).textContent()).replace(/\s/g, ""), "0/9.5");
  assert.equal((await cells.nth(4).textContent()).replace(/\s/g, ""), "0/-");
  const tableGaps = await row.evaluate((row) => {
    const cells = row.querySelectorAll("td");
    const accountName = cells[0].querySelector("p");
    const emails = cells[0].querySelector("ul");
    const athlete = cells[1].querySelector("li");
    const athleteName = athlete.children[0];
    const group = athlete.children[1];
    return {
      account: emails.getBoundingClientRect().top - accountName.getBoundingClientRect().bottom,
      athlete: group.getBoundingClientRect().top - athleteName.getBoundingClientRect().bottom,
    };
  });
  assert.ok(Math.abs(tableGaps.account - tableGaps.athlete) <= 1, "Account and athlete names use the same detail spacing.");
  await page.screenshot({ path: "backups/workshare/browser/desktop-table.png", fullPage: true });

  await page.reload();
  await page.getByLabel("Search accounts and athletes", { exact: true }).fill(prefix);
  row = page.getByRole("row").filter({ has: page.getByText(prefix, { exact: true }) });
  // The hours cell opens the editor, just like the name and Edit button.
  await row.getByRole("cell").nth(4).click();
  const edit = page.getByRole("form", { name: `Edit ${prefix}`, exact: true });
  await edit.waitFor();
  assert.equal(await edit.getByRole("button", { name: "Cancel", exact: true }).count(), 0);
  assert.equal(await edit.getByLabel("Search Times database", { exact: true }).count(), 0);
  await edit.getByRole("button", { name: "Unlink", exact: true }).click();
  await edit.getByLabel("Search Times database", { exact: true }).waitFor();
  await waitForAccount({}, { timesAthleteId: null });
  await edit.getByRole("button", { name: "Done", exact: true }).click();
  await edit.waitFor({ state: "detached" });
  row = page.getByRole("row").filter({ has: page.getByText(prefix, { exact: true }) });
  cells = row.getByRole("cell");
  assert.equal(await cells.nth(1).getByRole("img", { name: "Linked to Times", exact: true }).count(), 0);
  assert.equal(/Times linked|Times unlinked/.test(await cells.nth(1).textContent()), false);
  await cells.nth(1).click();
  await edit.getByLabel("Search Times database", { exact: true }).fill("Rostercheck");
  await edit.getByRole("button").filter({ hasText: "Rostercheck Testswimmer" }).click();
  await waitForAccount({}, { timesAthleteId: athleteId });

  // Delay a response after the server accepts it, then edit again while saving.
  // The queued request must use the acknowledged revision and preserve all edits.
  let delayNextSave = true;
  await page.route("**/api/workshare/accounts", async (route) => {
    if (route.request().method() !== "PUT" || !delayNextSave) return route.continue();
    delayNextSave = false;
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 900));
    return route.fulfill({ response });
  });
  const saving = page.waitForRequest((request) =>
    request.url().endsWith("/api/workshare/accounts") && request.method() === "PUT"
  );
  await edit.getByLabel("General hours required", { exact: true }).fill("2");
  await saving;
  assert.equal(await edit.getByLabel("Athlete full name", { exact: true }).isEnabled(), true);
  await edit.getByLabel("Athlete full name", { exact: true }).fill("Rostercheck Updated");
  await edit.getByRole("combobox", { name: "Training group", exact: true }).selectOption("Seniors");
  await edit.getByText("Archive athlete", { exact: true }).click();
  assert.equal(await edit.getByLabel("Archive athlete", { exact: true }).isChecked(), true);
  await edit.getByLabel("Apple Capital hours required", { exact: true }).fill("4");
  account = await waitForAccount({ generalHoursRequired: 2, appleCapitalHoursRequired: 4 }, {
    fullName: "Rostercheck Updated", trainingGroup: "Seniors", isArchived: true,
    timesAthleteId: athleteId,
  });
  assert.equal(account.athletes[0].id, original.athletes[0].id);
  assert.equal(await edit.getByRole("alert").count(), 0);

  await page.screenshot({ path: "backups/workshare/browser/desktop-edit.png", fullPage: true });
  await page.setViewportSize({ width: 1920, height: 1200 });
  const geometry = await edit.evaluate((form) => {
    const labels = [...form.querySelectorAll("label")];
    const field = (name) => {
      const label = labels.find((label) => label.firstElementChild?.textContent === name);
      const control = label.querySelector("input,textarea,select");
      const text = label.firstElementChild.getBoundingClientRect();
      const bounds = control.getBoundingClientRect();
      return { top: bounds.top, width: bounds.width, gap: bounds.top - text.bottom };
    };
    const archive = (name) => labels.find((label) => label.textContent.trim() === name).getBoundingClientRect().top;
    const timesLabel = [...form.querySelectorAll("p,span")].find((element) => element.textContent === "Times database linkage");
    const timesControl = timesLabel.nextElementSibling.getBoundingClientRect();
    return {
      account: field("Account full name"), emails: field("Account / athlete emails"),
      athlete: field("Athlete full name"), training: field("Training group"),
      hours: field("General hours required"), accountArchiveTop: archive("Archive account"),
      athleteArchiveTop: archive("Archive athlete"),
      times: { top: timesControl.top, width: timesControl.width,
        gap: timesControl.top - timesLabel.getBoundingClientRect().bottom },
    };
  });
  assert.ok(geometry.account.width <= 321 && geometry.athlete.width <= 321, "Name inputs stay reasonably sized on wide screens.");
  assert.ok(geometry.emails.width <= 385 && geometry.times.width <= 385, "Email and Times fields remain readable on wide screens.");
  assert.ok(geometry.training.width <= 257 && geometry.hours.width <= 161, "Group and hours fields have compact widths.");
  assert.ok(Math.abs(geometry.accountArchiveTop - geometry.account.top) <= 1, "Account archive aligns with the account input.");
  assert.ok(Math.abs(geometry.athleteArchiveTop - geometry.athlete.top) <= 1, "Athlete archive aligns with the athlete input.");
  assert.ok(Math.abs(geometry.times.gap - geometry.athlete.gap) <= 1, "Times linkage has the same label gap as other fields.");
  const hourTops = await edit.getByRole("spinbutton").evaluateAll((inputs) => inputs.map((input) => input.getBoundingClientRect().top));
  assert.ok(Math.max(...hourTops) - Math.min(...hourTops) <= 1, "Numeric inputs align across the row.");
  await page.screenshot({ path: "backups/workshare/browser/wide-edit.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const closeSidebar = page.getByRole("button", { name: "Close navigation sidebar", exact: true });
  if (await closeSidebar.isVisible()) await closeSidebar.click();
  await page.waitForFunction(() => {
    const sidebar = document.querySelector("aside[data-mobile-open]");
    return sidebar && getComputedStyle(sidebar).visibility === "hidden";
  });
  await page.waitForFunction(() => {
    const form = document.querySelector("form[aria-label^='Edit workshare-browser-']");
    return form && form.getBoundingClientRect().width < innerWidth - 30;
  });
  await page.screenshot({ path: "backups/workshare/browser/mobile-edit.png", fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
    "The mobile page must contain table overflow.");
  await edit.getByRole("button", { name: "Done", exact: true }).click();
  await edit.waitFor({ state: "detached" });
  const stale = await page.evaluate(async (input) => {
    const result = await fetch("/api/workshare/accounts", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    return result.status;
  }, original);
  assert.equal(stale, 409);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole("button", { name: `Edit ${prefix}`, exact: true }).click();
  await edit.getByLabel("Athlete full name", { exact: true }).fill("Rostercheck Navigated");
  await edit.getByLabel("Apple Capital hours required", { exact: true }).fill("5");
  await navigation.getByRole("link", { name: "Goals", exact: true }).click();
  await page.waitForURL(base + "/tools/goals");
  await waitForAccount({ appleCapitalHoursRequired: 5 }, { fullName: "Rostercheck Navigated" });
  await navigation.getByRole("link", { name: "Admin", exact: true }).click();
  await page.waitForURL(base + "/tools/admin");
  await page.getByLabel("Search accounts and athletes", { exact: true }).fill(prefix);
  await page.getByRole("button", { name: `Edit ${prefix}`, exact: true }).click();
  await edit.getByText("Archive account", { exact: true }).click();
  assert.equal(await edit.getByLabel("Archive account", { exact: true }).isChecked(), true);
  await waitForAccount({ isArchived: true });
  assert.equal(await edit.isVisible(), true, "Archiving must not unmount the active editor during autosave.");
  await edit.getByRole("button", { name: "Done", exact: true }).click();
  await edit.waitFor({ state: "detached" });
  assert.equal(await page.getByRole("button", { name: `Edit ${prefix}`, exact: true }).count(), 0);
  await page.getByLabel("Account archive filter", { exact: true }).selectOption("archived");
  await page.getByRole("button", { name: `Edit ${prefix}`, exact: true }).waitFor();
  account = await waitForAccount({ isArchived: true, appleCapitalHoursRequired: 5 }, { isArchived: true });
  assert.equal(account.athletes[0].id, original.athletes[0].id);
  await page.screenshot({ path: "backups/workshare/browser/desktop.png", fullPage: true });
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
    "Accounts browser checks passed: autosave, queued edits, new-athlete identities, dropdown, unlink/relink, row clicks, hours, archives, stale-write conflict, retired routes, mobile overflow.",
  );
} catch (error) {
  if (page) {
    await page.screenshot({ path: "backups/workshare/browser/failed.png", fullPage: true });
    console.error("Browser failure state:", await page.locator("form").evaluateAll((forms) => forms.map((form) => ({
      label: form.getAttribute("aria-label"),
      inputs: [...form.querySelectorAll("input")].map((input) => ({ type: input.type, value: input.value })),
      alerts: [...form.querySelectorAll("[role='alert']")].map((alert) => alert.textContent),
    }))));
  }
  throw error;
} finally {
  if (!savedId) {
    const cleanup = await admin.from("workshare_accounts").select("id").eq("full_name", prefix);
    savedId = cleanup.data?.[0]?.id;
  }
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
