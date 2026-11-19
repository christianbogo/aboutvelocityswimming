import { artifactPath } from "../verification-artifacts.mjs";
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
const evidence = artifactPath("workshare/ticket-quantity-browser");
mkdirSync(evidence, { recursive: true });

async function rpc(name, input) {
  const result = await admin.rpc(name, input);
  assert.ifError(result.error);
  return result.data;
}
async function authenticatedContext(staff) {
  const email = `${prefix}-${staff ? "staff@velocity-swimming.com" : "member@example.test"}`;
  const password = `Aa1!${randomUUID()}`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.ifError(created.error);
  users.push(created.data.user.id);
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
  const role = await client.rpc("is_workshare_staff");
  assert.ifError(role.error);
  assert.equal(
    role.data,
    staff,
    "Verified domain staff authority must control Admin access.",
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
  await page.goto(base + "/tools/admin");
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
    "Times",
    "Rankings",
    "Records",
    "Standards",
    "Admin",
  ]);
  for (const path of [
    "/api/times/manage?kind=swim",
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
  assert.equal(
    await create.getByLabel("Quantity", { exact: true }).inputValue(),
    "1",
  );
  await create.getByLabel("Quantity", { exact: true }).fill("3");
  let initialPosts = 0;
  const loseInitialResponse = async (route) => {
    if (route.request().method() === "POST" && ++initialPosts === 2) {
      const response = await route.fetch();
      assert.equal(response.status(), 201);
      await route.abort("failed");
    } else await route.continue();
  };
  await page.route("**/api/workshare/tickets", loseInitialResponse);
  const originalResponse = page.waitForResponse(
    (response) =>
      response.url() === base + "/api/workshare/tickets" &&
      response.request().method() === "POST",
  );
  await create.getByRole("button", { name: "Add ticket", exact: true }).click();
  const submitted = await originalResponse;
  assert.equal(submitted.status(), 201, JSON.stringify(await submitted.json()));
  await create.getByRole("alert").waitFor();
  await create.getByRole("button", { name: "Add ticket", exact: true }).click();
  await create.getByLabel("Find an account", { exact: true }).waitFor();
  await page.unroute("**/api/workshare/tickets", loseInitialResponse);
  await waitForTickets(
    (items) => items.length === 3,
    "Quantity retry must save exactly three tickets",
  );
  await waitForSummary(accounts[0].id, {
    general: 0,
    starlight: 7.5,
    appleCapital: 0,
  });
  const initialUndo = create.getByRole("button", {
    name: `Undo ticket for ${accounts[0].fullName}`,
    exact: true,
  });
  await initialUndo.click();
  await waitForTickets(
    (items) => items.length === 2,
    "Undo must remove one of the quantity tickets",
  );
  await initialUndo.click();
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
  // Each completed Add click creates another independent ticket for the same account.
  await retryTarget.click();
  await waitForTickets(
    (items) => items.length === 8,
    "Second Add must create another copy",
  );
  await retryTarget.click();
  await waitForTickets(
    (items) => items.length === 9,
    "Third Add must create another copy",
  );
  await waitForSummary(accounts[1].id, {
    general: 0,
    starlight: 7.5,
    appleCapital: 0,
  });
  const repeatedUndo = reuse.getByRole("button", {
    name: `Undo ticket for ${accounts[1].fullName}`,
    exact: true,
  });
  await repeatedUndo.click();
  await waitForTickets(
    (items) => items.length === 8,
    "Undo must remove only the latest copy",
  );
  await repeatedUndo.click();
  await waitForTickets(
    (items) => items.length === 7,
    "Earlier copies must remain after Undo",
  );
  await waitForSummary(accounts[1].id, {
    general: 0,
    starlight: 2.5,
    appleCapital: 0,
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

  await page.setViewportSize({ width: 390, height: 844 });
  await firstRow.getByRole("button", { name: /Add ticket/i }).click();
  assert.equal(
    await page
      .getByRole("dialog")
      .getByLabel("Quantity", { exact: true })
      .inputValue(),
    "1",
  );
  await page.screenshot({
    path: `${evidence}/quantity-mobile.png`,
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "Ticket quantity, repeat Add, Undo, totals, and lost-response retries passed.",
  );
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
