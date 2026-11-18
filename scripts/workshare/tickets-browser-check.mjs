import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const configPath = process.argv[2];
if (!configPath) throw new Error("Pass a local Supabase status JSON file.");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const base = process.env.WORKSHARE_BROWSER_URL || "http://127.0.0.1:3011";
for (const url of [config.API_URL, base]) {
  assert.ok(
    ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
    "Checks refuse hosted services.",
  );
}
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const prefix = `ticket-browser-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const users = [];
const accounts = [];
const seasonIds = new Set();
const ticketIds = new Set();
const errors = [];
let browser;
let page;
let season;
const evidence = "backups/workshare/tickets-browser";
mkdirSync(evidence, { recursive: true });

async function rpc(name, input) {
  const result = await admin.rpc(name, input);
  assert.ifError(result.error);
  return result.data;
}
async function authenticatedContext(staff) {
  const email = `${prefix}-${staff ? "staff" : "member"}@example.test`;
  const password = `Aa1!${randomUUID()}`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.ifError(created.error);
  users.push(created.data.user.id);
  if (staff)
    assert.ifError(
      (
        await admin
          .from("administrators")
          .insert({ user_id: created.data.user.id })
      ).error,
    );
  const jar = new Map();
  const client = createServerClient(
    config.API_URL,
    config.PUBLISHABLE_KEY || config.ANON_KEY,
    {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (values) =>
          values.forEach(({ name, value }) => jar.set(name, value)),
      },
    },
  );
  assert.ifError(
    (await client.auth.signInWithPassword({ email, password })).error,
  );
  const role = await client.rpc("is_staff");
  assert.ifError(role.error);
  assert.equal(
    role.data,
    staff,
    "Explicit local staff approval must control access.",
  );
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  await context.addCookies(
    [...jar].map(([name, value]) => ({
      name,
      value,
      url: base,
      sameSite: "Lax",
    })),
  );
  await context.route("**/*.supabase.co/**", (route) => {
    errors.push("Attempted hosted request");
    return route.abort();
  });
  return context;
}
async function request(path, method = "GET", body) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(path, {
        method,
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        body: response.status === 204 ? null : await response.json(),
      };
    },
    { path, method, body },
  );
}
async function readTickets(seasonId = season.id) {
  const result = await request(
    `/api/workshare/tickets?seasonId=${encodeURIComponent(seasonId)}&q=${encodeURIComponent(prefix)}`,
  );
  assert.equal(result.status, 200);
  for (const ticket of result.body.data.tickets) ticketIds.add(ticket.id);
  return result.body.data.tickets;
}
async function waitForTickets(predicate, description) {
  let tickets = [];
  for (let attempt = 0; attempt < 100; attempt++) {
    tickets = await readTickets();
    if (predicate(tickets)) return tickets;
    await page.waitForTimeout(100);
  }
  assert.fail(`${description}: ${JSON.stringify(tickets)}`);
}
async function summary(accountId, seasonId = season.id) {
  const result = await request(
    `/api/workshare/accounts?seasonId=${encodeURIComponent(seasonId)}`,
  );
  assert.equal(result.status, 200);
  return result.body.data.find(({ account }) => account.id === accountId);
}
async function waitForSummary(accountId, expected) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const item = await summary(accountId);
    if (
      Object.entries(expected).every(
        ([field, value]) => item.completed[field] === value,
      )
    )
      return item;
    await page.waitForTimeout(100);
  }
  assert.fail(
    `Completed hours did not settle for fixture account ${accountId}.`,
  );
}
async function waitForTicketList() {
  const section = page.getByRole("region", {
    name: "Season tickets",
    exact: true,
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      !(await section.getByText("Loading tickets…", { exact: true }).count())
    ) {
      const rows = section.locator("tbody tr");
      if (await rows.count()) return;
    }
    await page.waitForTimeout(100);
  }
  assert.fail("Ticket list did not settle before capture.");
}
async function closeMobileSidebar() {
  const toggle = page.getByRole("button", {
    name: "Close navigation sidebar",
    exact: true,
  });
  if (await toggle.isVisible()) await toggle.click();
  await page.waitForFunction(() => {
    const sidebar = document.querySelector("aside[data-mobile-open]");
    return sidebar && getComputedStyle(sidebar).visibility === "hidden";
  });
}
async function closeDialog(dialog) {
  const done = dialog.getByRole("button", { name: "Done", exact: true });
  if (await done.count()) await done.click();
  else await dialog.getByRole("button", { name: /^Close / }).click();
  await dialog.waitFor({ state: "detached" });
}

try {
  // Every person and registration used by this check is synthetic and local.
  for (let index = 0; index < 7; index++) {
    accounts.push(
      await rpc("save_workshare_account", {
        input: {
          fullName: `${prefix} Account ${index + 1}`,
          emails: [`${prefix}-${index}@example.test`],
          athletes: [
            {
              fullName: `${prefix} Athlete ${index + 1}`,
              trainingGroup: "Prep",
              timesAthleteId: null,
              isArchived: false,
            },
          ],
          currentSeason: null,
          generalHoursRequired: null,
          starlightHoursRequired: null,
          appleCapitalHoursRequired: null,
          isArchived: false,
        },
      }),
    );
  }
  const existing = await rpc("list_workshare_seasons");
  let year = 2101;
  while (
    existing.some(
      (item) =>
        item.startsOn <= `${year + 2}-12-31` && item.endsOn >= `${year}-01-01`,
    )
  )
    year += 4;
  const id = randomUUID();
  seasonIds.add(id);
  season = await rpc("create_workshare_season", {
    input: {
      id,
      name: `${prefix} Original`,
      startsOn: `${year}-01-01`,
      endsOn: `${year}-12-31`,
      copyFromSeasonId: existing[0]?.id ?? null,
    },
  });
  for (const account of accounts)
    await rpc("save_workshare_requirements", {
      account_id: account.id,
      input: {
        seasonId: season.id,
        updatedAt: (
          await rpc("list_workshare_account_summaries", {
            season_id: season.id,
          })
        ).find((item) => item.account.id === account.id).requirements.updatedAt,
        generalHoursRequired: 16,
        starlightHoursRequired: 8,
        appleCapitalHoursRequired: null,
      },
    });
  browser = await chromium.launch({ headless: true });
  const context = await authenticatedContext(true);
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + "/login");
  await page.waitForURL(base + "/tools/admin");
  await page
    .getByRole("heading", { name: "Accounts & Roster", exact: true })
    .waitFor();
  const navigation = page.getByRole("navigation", {
    name: "Tools navigation",
    exact: true,
  });
  assert.deepEqual(await navigation.getByRole("link").allTextContents(), [
    "Account",
    "Admin",
  ]);
  for (const path of [
    "/api/times",
    "/api/collection/review",
    "/api/workshare/accounts-other",
  ]) {
    assert.equal(
      (await context.request.get(base + path)).status(),
      403,
      `Staff must not gain ${path}.`,
    );
  }
  const memberContext = await authenticatedContext(false);
  assert.equal(
    (
      await memberContext.request.get(base + "/api/workshare/accounts")
    ).status(),
    403,
  );
  assert.equal(
    (await memberContext.request.get(base + "/api/workshare/seasons")).status(),
    403,
  );
  assert.equal(
    (await memberContext.request.get(base + "/api/workshare/tickets")).status(),
    403,
  );
  const memberPage = await memberContext.newPage();
  await memberPage.goto(base + "/tools/admin");
  await memberPage.waitForURL(base + "/login");
  await memberContext.close();

  // UI workflow assertions are below; all persisted state is read back through
  // the same staff HTTP API that supplies the displayed account totals.
  await page
    .getByRole("combobox", { name: "Workshare season", exact: true })
    .selectOption(season.id);
  await page
    .getByLabel("Search accounts and athletes", { exact: true })
    .fill(prefix);
  assert.deepEqual(await page.getByRole("columnheader").allTextContents(), [
    "Account",
    "Athletes",
    "General",
    "Starlight",
    "Apple Capital",
    "Actions",
  ]);
  // Core registration autosaves must remain independent of adopted season
  // requirements, including athlete changes and server-normalized emails.
  const originalAccount = structuredClone(accounts[0]);
  const initialSeasonRequirements = (await summary(accounts[0].id))
    .requirements;
  await page
    .getByRole("row")
    .filter({ hasText: accounts[0].fullName })
    .locator("td")
    .first()
    .click();
  const accountForm = page.locator('form[aria-label^="Edit ticket-browser-"]');
  const editedName = `${prefix} Account 1 Edited`;
  const editedAthlete = `${prefix} Athlete 1 Edited`;
  await accountForm
    .getByLabel("Account full name", { exact: true })
    .fill(editedName);
  await accountForm
    .getByLabel("Account / athlete emails")
    .fill(`${prefix}-parent@example.test\n${prefix}-athlete@example.test`);
  await accountForm
    .getByLabel("Athlete full name", { exact: true })
    .fill(editedAthlete);
  await accountForm
    .getByRole("combobox", { name: "Training group", exact: true })
    .selectOption("Seniors");
  let editedSummary;
  for (let attempt = 0; attempt < 100; attempt++) {
    editedSummary = await summary(accounts[0].id);
    if (
      editedSummary.account.fullName === editedName &&
      editedSummary.account.athletes[0].fullName === editedAthlete &&
      editedSummary.account.athletes[0].trainingGroup === "Seniors" &&
      editedSummary.account.emails.length === 2
    )
      break;
    if (attempt === 99)
      assert.fail(
        "Account and athlete identity changes did not autosave after season adoption.",
      );
    await page.waitForTimeout(100);
  }
  assert.deepEqual(
    editedSummary.requirements,
    initialSeasonRequirements,
    "Identity autosave must not change season quotas or their version.",
  );
  assert.equal(
    editedSummary.account.currentSeason,
    originalAccount.currentSeason,
  );
  assert.equal(
    editedSummary.account.generalHoursRequired,
    originalAccount.generalHoursRequired,
  );
  assert.equal(
    editedSummary.account.starlightHoursRequired,
    originalAccount.starlightHoursRequired,
  );
  assert.equal(
    editedSummary.account.appleCapitalHoursRequired,
    originalAccount.appleCapitalHoursRequired,
  );
  accounts[0] = editedSummary.account;

  // A failed summary refresh must leave the requirement editor mounted,
  // including a draft typed before Retry finishes reading the latest totals.
  let failSummary = true;
  const failOneSummary = async (route) => {
    if (failSummary) {
      failSummary = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic summary outage" }),
      });
    } else await route.continue();
  };
  await page.route("**/api/workshare/accounts?seasonId=*", failOneSummary);
  const summaryFailure = page.waitForResponse(
    (response) =>
      response.url().includes("/api/workshare/accounts?seasonId=") &&
      response.status() === 503,
  );
  await accountForm
    .getByLabel("General hours required", { exact: true })
    .fill("17");
  await summaryFailure;
  await page.unroute("**/api/workshare/accounts?seasonId=*", failOneSummary);
  assert.equal(
    await accountForm
      .getByLabel("General hours required", { exact: true })
      .inputValue(),
    "17",
  );
  await page
    .getByRole("button", { name: "Retry season hours", exact: true })
    .waitFor();
  await accountForm
    .getByLabel("General hours required", { exact: true })
    .fill("17.5");
  await page
    .getByRole("button", { name: "Retry season hours", exact: true })
    .click();
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      (await summary(accounts[0].id)).requirements.generalHoursRequired === 17.5
    )
      break;
    if (attempt === 99)
      assert.fail("A summary outage lost the pending requirement edit.");
    await page.waitForTimeout(100);
  }
  assert.equal(
    await accountForm
      .getByLabel("General hours required", { exact: true })
      .inputValue(),
    "17.5",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Retry season hours", exact: true })
      .count(),
    0,
  );
  // Simulate another staff editor changing requirements after this form opened.
  // Reload must replace the stale version so subsequent autosaves and Done work.
  const requirementPath = `/api/workshare/accounts/${encodeURIComponent(accounts[0].id)}/requirements`;
  const externalChange = await request(requirementPath, "PUT", {
    seasonId: season.id,
    updatedAt: (await summary(accounts[0].id)).requirements.updatedAt,
    generalHoursRequired: 18,
    starlightHoursRequired: 8,
    appleCapitalHoursRequired: null,
  });
  assert.equal(externalChange.status, 200, JSON.stringify(externalChange.body));
  const staleResponse = page.waitForResponse(
    (response) =>
      response.url() === base + requirementPath &&
      response.request().method() === "PUT",
  );
  await accountForm
    .getByLabel("General hours required", { exact: true })
    .fill("19");
  assert.equal((await staleResponse).status(), 409);
  await accountForm
    .getByRole("button", { name: "Reload required hours", exact: true })
    .click();
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      (await accountForm
        .getByLabel("General hours required", { exact: true })
        .inputValue()) === "18"
    )
      break;
    if (attempt === 99)
      assert.fail(
        "Reload did not recover the concurrent requirements version.",
      );
    await page.waitForTimeout(100);
  }
  await accountForm
    .getByLabel("General hours required", { exact: true })
    .fill("16");
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      (await summary(accounts[0].id)).requirements.generalHoursRequired === 16
    )
      break;
    if (attempt === 99)
      assert.fail("Required-hours autosave did not recover after Reload.");
    await page.waitForTimeout(100);
  }
  await accountForm.getByRole("button", { name: "Done", exact: true }).click();
  await accountForm.waitFor({ state: "detached" });
  // A new account created after adoption receives independently editable
  // season requirements, which survive another identity autosave in that row.
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  const newAccountForm = page.locator(
    'form[aria-label="New account"], form[aria-label^="Edit ticket-browser-"]',
  );
  const newName = `${prefix} New account`;
  await newAccountForm
    .getByLabel("Account full name", { exact: true })
    .fill(newName);
  let newAccount;
  for (let attempt = 0; attempt < 100; attempt++) {
    const all = await request("/api/workshare/accounts");
    newAccount = all.body.data.find((item) => item.fullName === newName);
    if (newAccount) break;
    if (attempt === 99)
      assert.fail("New account did not autosave after season adoption.");
    await page.waitForTimeout(100);
  }
  await newAccountForm
    .getByLabel("General hours required", { exact: true })
    .fill("2.25");
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      (await summary(newAccount.id)).requirements.generalHoursRequired === 2.25
    )
      break;
    if (attempt === 99)
      assert.fail("New account season requirements did not autosave.");
    await page.waitForTimeout(100);
  }
  await newAccountForm
    .getByLabel("Account / athlete emails")
    .fill(`${prefix}-new@example.test`);
  await newAccountForm
    .getByRole("button", { name: "Add athlete", exact: true })
    .click();
  await newAccountForm
    .getByLabel("Athlete full name", { exact: true })
    .fill(`${prefix} New athlete`);
  await newAccountForm
    .getByRole("combobox", { name: "Training group", exact: true })
    .selectOption("Prep");
  await newAccountForm
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await newAccountForm.waitFor({ state: "detached" });
  const createdSummary = await summary(newAccount.id);
  assert.equal(createdSummary.account.emails[0], `${prefix}-new@example.test`);
  assert.equal(createdSummary.account.athletes.length, 1);
  assert.equal(createdSummary.requirements.generalHoursRequired, 2.25);
  const firstRow = page
    .getByRole("row")
    .filter({ hasText: accounts[0].fullName });
  await firstRow.getByRole("button", { name: /Add ticket/i }).click();
  const create = page.getByRole("dialog", {
    name: "Add ticket",
    exact: true,
  });
  assert.equal(
    await create.getByLabel("Work date", { exact: true }).inputValue(),
    "",
    "A future season must not invent a work date.",
  );
  await create.getByLabel("Work date", { exact: true }).fill(`${year}-05-15`);
  await create
    .getByLabel("Description", { exact: true })
    .fill(`${prefix} Meet setup`);
  await create
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("starlight");
  await create.getByLabel("Hours", { exact: true }).fill("2.5");
  const originalResponse = page.waitForResponse(
    (response) =>
      response.url() === base + "/api/workshare/tickets" &&
      response.request().method() === "POST",
  );
  await create.getByRole("button", { name: "Add ticket", exact: true }).click();
  const submitted = await originalResponse;
  assert.equal(submitted.status(), 201, JSON.stringify(await submitted.json()));
  const createdTickets = await waitForTickets(
    (items) => items.length === 1,
    "Original ticket was not created",
  );
  const original = createdTickets[0];
  await waitForSummary(accounts[0].id, {
    general: 0,
    starlight: 2.5,
    appleCapital: 0,
  });

  // The reusable template credits six other accounts with one click apiece.
  const reuse = page.getByRole("dialog", { name: "Add ticket", exact: true });
  await reuse.getByLabel("Find an account", { exact: true }).fill(prefix);
  // Lose one response after the server commits. Retrying the same account must
  // reuse the original creation key rather than crediting it twice.
  let loseResponse = true;
  const loseCopyResponse = async (route) => {
    const input =
      route.request().method() === "POST" ? route.request().postDataJSON() : {};
    if (
      route.request().method() === "POST" &&
      input.accountId === accounts[1].id &&
      loseResponse
    ) {
      loseResponse = false;
      const response = await route.fetch();
      assert.equal(response.status(), 201);
      await route.abort("failed");
      return;
    }
    await route.continue();
  };
  await page.route("**/api/workshare/tickets", loseCopyResponse);
  const retryTarget = reuse.getByRole("button", {
    name: `Add ticket to ${accounts[1].fullName}`,
    exact: true,
  });
  await retryTarget.click();
  await reuse.getByRole("alert").waitFor();
  await retryTarget.click();
  await page.unroute("**/api/workshare/tickets", loseCopyResponse);
  await reuse
    .getByRole("button", {
      name: `Undo ticket for ${accounts[1].fullName}`,
      exact: true,
    })
    .waitFor();
  for (const account of accounts.slice(2)) {
    const target = reuse.getByRole("button", {
      name: `Add ticket to ${account.fullName}`,
      exact: true,
    });
    if (account.id === accounts[2].id) {
      await target.evaluate((button) => {
        button.click();
        button.click();
      });
    } else await target.click();
  }
  let tickets = await waitForTickets(
    (items) => items.length === 7,
    "Six copies were not saved",
  );
  assert.deepEqual(
    new Set(tickets.map((item) => item.accountId)),
    new Set(accounts.map((item) => item.id)),
  );
  for (const item of tickets) {
    assert.equal(item.completedOn, `${year}-05-15`);
    assert.equal(item.description, `${prefix} Meet setup`);
    assert.equal(item.category, "starlight");
    assert.equal(item.hours, 2.5);
  }
  await reuse
    .getByRole("button", { name: "Done", exact: true })
    .waitFor({ state: "visible" });
  for (const account of accounts)
    await reuse
      .getByRole("button", {
        name: `Undo ticket for ${account.fullName}`,
        exact: true,
      })
      .waitFor();
  await reuse
    .getByRole("list", { name: "Ticket account targets", exact: true })
    .evaluate((list) => {
      list.scrollTop = 0;
    });
  await page.screenshot({
    path: `${evidence}/composer-desktop.png`,
    fullPage: true,
  });
  const copied = tickets.find((item) => item.accountId === accounts[1].id);
  const duplicate = await request("/api/workshare/tickets", "POST", {
    id: copied.id,
    accountId: copied.accountId,
    seasonId: copied.seasonId,
    completedOn: copied.completedOn,
    description: copied.description,
    category: copied.category,
    hours: copied.hours,
  });
  assert.equal(duplicate.status, 201);
  assert.equal(
    (await readTickets()).length,
    7,
    "A retry must not duplicate a copy.",
  );
  await reuse
    .getByRole("button", {
      name: `Undo ticket for ${accounts[6].fullName}`,
      exact: true,
    })
    .click();
  tickets = await waitForTickets(
    (items) => items.length === 6,
    "Undo did not remove exactly one copy",
  );
  assert.ok(
    tickets.some((item) => item.id === original.id),
    "Undo must preserve the original.",
  );
  await reuse
    .getByRole("button", {
      name: `Add ticket to ${accounts[6].fullName}`,
      exact: true,
    })
    .click();
  await waitForTickets(
    (items) => items.length === 7,
    "Reapplying after Undo must create one fresh ticket",
  );
  await closeDialog(reuse);

  // Editing one copy autosaves only that account's independent ticket.
  await page.getByRole("tab", { name: "Tickets", exact: true }).click();
  await page.getByLabel("Search tickets", { exact: true }).fill(prefix);
  const accountFilter = page.getByRole("combobox", {
    name: "Ticket account filter",
    exact: true,
  });
  await accountFilter.selectOption(accounts[1].id);
  await page
    .getByRole("row")
    .filter({ hasText: accounts[1].fullName })
    .waitFor();
  assert.equal(
    await page
      .getByRole("row")
      .filter({ hasText: accounts[0].fullName })
      .count(),
    0,
  );
  await accountFilter.selectOption("");
  await page
    .getByRole("row")
    .filter({ hasText: accounts[0].fullName })
    .waitFor();
  const ticketRows = page
    .getByRole("row")
    .filter({ hasText: `${prefix} Meet setup` });
  await ticketRows.filter({ hasText: accounts[1].fullName }).click();
  const editor = page.getByRole("dialog", { name: "Edit ticket", exact: true });
  await editor.getByLabel("Hours", { exact: true }).fill("3.75");
  await editor
    .getByLabel("Description", { exact: true })
    .fill(`${prefix} Edited copy`);
  await editor
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("general");
  tickets = await waitForTickets(
    (items) =>
      items.some(
        (item) =>
          item.accountId === accounts[1].id &&
          item.hours === 3.75 &&
          item.category === "general" &&
          item.description === `${prefix} Edited copy`,
      ),
    "Ticket edits did not autosave",
  );
  const untouched = tickets.find((item) => item.id === original.id);
  assert.equal(untouched.hours, 2.5);
  assert.equal(untouched.category, "starlight");
  assert.equal(untouched.description, `${prefix} Meet setup`);
  await waitForSummary(accounts[1].id, {
    general: 3.75,
    starlight: 0,
    appleCapital: 0,
  });
  await waitForSummary(accounts[0].id, {
    general: 0,
    starlight: 2.5,
    appleCapital: 0,
  });
  await closeDialog(editor);
  await page
    .getByRole("combobox", { name: "Ticket category", exact: true })
    .selectOption("general");
  await page
    .getByRole("row")
    .filter({ hasText: `${prefix} Edited copy` })
    .waitFor();
  assert.equal(
    await page
      .getByRole("row")
      .filter({ hasText: `${prefix} Meet setup` })
      .count(),
    0,
  );
  await page
    .getByRole("row")
    .filter({ hasText: `${prefix} Edited copy` })
    .click();
  await editor
    .getByRole("button", { name: "Delete ticket", exact: true })
    .click();
  await editor
    .getByRole("button", { name: "Delete ticket", exact: true })
    .click();
  await editor.waitFor({ state: "detached" });
  await waitForTickets(
    (items) =>
      items.length === 6 &&
      !items.some((item) => item.accountId === accounts[1].id),
    "Deleting a ticket did not remove its hours",
  );
  await waitForSummary(accounts[1].id, {
    general: 0,
    starlight: 0,
    appleCapital: 0,
  });
  // A delayed retry after Undo/delete must never resurrect a removed ticket.
  assert.equal(
    (
      await request("/api/workshare/tickets", "POST", {
        id: copied.id,
        accountId: copied.accountId,
        seasonId: copied.seasonId,
        completedOn: copied.completedOn,
        description: copied.description,
        category: copied.category,
        hours: copied.hours,
      })
    ).status,
    410,
  );
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await waitForTicketList();
  await page.setViewportSize({ width: 390, height: 844 });
  await closeMobileSidebar();
  await waitForTicketList();
  await page.screenshot({
    path: `${evidence}/tickets-mobile.png`,
    fullPage: true,
  });
  const mobileLayout = await page.evaluate(() => ({
    viewport: innerWidth,
    width: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll("body *")]
      .flatMap((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (
          rect.right <= innerWidth + 1 ||
          style.visibility === "hidden" ||
          style.display === "none"
        )
          return [];
        let clipped = false;
        for (
          let parent = element.parentElement;
          parent;
          parent = parent.parentElement
        ) {
          if (
            ["auto", "hidden", "scroll", "clip"].includes(
              getComputedStyle(parent).overflowX,
            )
          ) {
            clipped = true;
            break;
          }
        }
        return clipped
          ? []
          : [
              {
                tag: element.tagName,
                className:
                  typeof element.className === "string"
                    ? element.className
                    : "",
                right: rect.right,
              },
            ];
      })
      .slice(0, 15),
  }));
  assert.ok(
    mobileLayout.width <= mobileLayout.viewport,
    JSON.stringify(mobileLayout),
  );
  await page.setViewportSize({ width: 1440, height: 1050 });
  await waitForTicketList();
  await page.screenshot({
    path: `${evidence}/tickets-desktop.png`,
    fullPage: true,
  });

  // Create a later, nonadjacent season through the UI. Requirements copy;
  // completed tickets and dates in the gap do not carry into that season.
  await page.getByRole("button", { name: "New season", exact: true }).click();
  const newSeason = page.getByRole("dialog", {
    name: "Create season",
    exact: true,
  });
  await newSeason
    .getByLabel("Season name", { exact: true })
    .fill(`${prefix} Copied`);
  await newSeason
    .getByLabel("Starts on", { exact: true })
    .fill(`${year + 2}-01-01`);
  await newSeason
    .getByLabel("Ends on", { exact: true })
    .fill(`${year + 2}-12-31`);
  await newSeason
    .getByRole("combobox", { name: "Copy requirements from", exact: true })
    .selectOption(season.id);
  await newSeason
    .getByRole("button", { name: "Create season", exact: true })
    .click();
  await newSeason.waitFor({ state: "detached" });
  const listedSeasons = await request("/api/workshare/seasons");
  assert.equal(listedSeasons.status, 200);
  const copiedSeason = listedSeasons.body.data.find(
    (item) => item.name === `${prefix} Copied`,
  );
  assert.ok(copiedSeason);
  seasonIds.add(copiedSeason.id);
  const nextSummary = await summary(accounts[0].id, copiedSeason.id);
  assert.equal(nextSummary.requirements.generalHoursRequired, 16);
  assert.equal(nextSummary.requirements.starlightHoursRequired, 8);
  assert.equal(nextSummary.requirements.appleCapitalHoursRequired, null);
  assert.deepEqual(nextSummary.completed, {
    general: 0,
    starlight: 0,
    appleCapital: 0,
  });
  assert.equal((await readTickets(copiedSeason.id)).length, 0);
  const gap = await request("/api/workshare/tickets", "POST", {
    id: randomUUID(),
    accountId: accounts[0].id,
    seasonId: copiedSeason.id,
    completedOn: `${year + 1}-05-15`,
    description: `${prefix} Invalid gap`,
    category: "general",
    hours: 1,
  });
  assert.equal(gap.status, 400);
  await page.getByRole("tab", { name: "Accounts", exact: true }).click();
  await page
    .getByLabel("Search accounts and athletes", { exact: true })
    .fill(prefix);
  const nextRow = page
    .getByRole("row")
    .filter({ hasText: accounts[0].fullName });
  await nextRow
    .getByLabel("0 completed / 16 required hours", { exact: true })
    .waitFor();
  assert.match(await nextRow.innerText(), /0\/16/);
  assert.match(await nextRow.innerText(), /0\/-/);
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(
    await page.getByRole("tab", { name: "Accounts", exact: true }).isDisabled(),
    false,
  );
  const desktopAccounts = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  assert.ok(
    desktopAccounts.width <= desktopAccounts.viewport,
    JSON.stringify(desktopAccounts),
  );
  await page.evaluate(() =>
    window.scrollTo({ top: 0, left: 0, behavior: "instant" }),
  );
  await page.waitForFunction(() => {
    const sidebar = document.querySelector(
      'aside[aria-label="Navigation sidebar"]',
    );
    const rect = sidebar?.getBoundingClientRect();
    return (
      rect &&
      rect.left >= 0 &&
      rect.right <= innerWidth &&
      rect.width > 100 &&
      getComputedStyle(sidebar).visibility === "visible"
    );
  });
  await page.screenshot({
    path: `${evidence}/accounts-desktop.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await closeMobileSidebar();
  const mobileAccounts = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  assert.ok(
    mobileAccounts.width <= mobileAccounts.viewport,
    JSON.stringify(mobileAccounts),
  );
  await page.evaluate(() =>
    window.scrollTo({ top: 0, left: 0, behavior: "instant" }),
  );
  await page.screenshot({
    path: `${evidence}/accounts-mobile.png`,
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log("Completed-hours browser verification passed.");
} catch (error) {
  if (page && !page.isClosed())
    await page
      .screenshot({ path: `${evidence}/failure.png`, fullPage: true })
      .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  // Discover any committed fixture records even when the browser failed before
  // receiving a response. The random prefix never matches an existing account.
  const fixtureAccounts = await admin
    .from("workshare_accounts")
    .select("id")
    .like("full_name", `${prefix}%`);
  assert.ifError(fixtureAccounts.error);
  const accountIds = fixtureAccounts.data.map(({ id }) => id);
  if (accountIds.length) {
    const allTickets = await admin
      .from("workshare_tickets")
      .select("id")
      .in("account_id", accountIds);
    assert.ifError(allTickets.error);
    allTickets.data.forEach(({ id }) => ticketIds.add(id));
    assert.ifError(
      (await admin.from("workshare_accounts").delete().in("id", accountIds))
        .error,
    );
  }
  if (ticketIds.size)
    assert.ifError(
      (
        await admin
          .from("workshare_ticket_create_keys")
          .delete()
          .in("id", [...ticketIds])
      ).error,
    );
  const fixtureSeasons = await admin
    .from("workshare_seasons")
    .select("id")
    .like("name", `${prefix}%`);
  assert.ifError(fixtureSeasons.error);
  fixtureSeasons.data.forEach(({ id }) => seasonIds.add(id));
  if (seasonIds.size) {
    assert.ifError(
      (
        await admin
          .from("workshare_account_requirements")
          .delete()
          .in("season_id", [...seasonIds])
      ).error,
    );
    // A later fixture season may refer to the first fixture season.
    for (const id of [...seasonIds].reverse())
      assert.ifError(
        (await admin.from("workshare_seasons").delete().eq("id", id)).error,
      );
  }
  if (users.length) {
    assert.ifError(
      (await admin.from("administrators").delete().in("user_id", users)).error,
    );
    for (const id of users)
      assert.ifError((await admin.auth.admin.deleteUser(id)).error);
  }
}
