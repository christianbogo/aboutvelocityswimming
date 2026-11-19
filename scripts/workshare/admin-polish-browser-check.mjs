import { artifactPath } from "../verification-artifacts.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const configPath = process.argv[2];
if (!configPath) throw new Error("Pass a local Supabase status JSON file.");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const env = {
  NEXT_PUBLIC_SUPABASE_URL: config.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    config.PUBLISHABLE_KEY || config.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: config.SERVICE_ROLE_KEY,
};
const base = process.env.WORKSHARE_BROWSER_URL || "http://127.0.0.1:3011";
for (const url of [base, env.NEXT_PUBLIC_SUPABASE_URL]) {
  assert.ok(
    ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
    "Local services only.",
  );
}
const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
  },
);
const password = `Aa1!${randomUUID()}`;
const email = `admin-polish-${randomUUID()}@example.test`;
const created = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
assert.ifError(created.error);
assert.ifError(
  (await admin.from("administrators").insert({ user_id: created.data.user.id }))
    .error,
);
const cookies = [];
const client = createServerClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  {
    cookies: { getAll: () => [], setAll: (values) => cookies.push(...values) },
  },
);
assert.ifError(
  (await client.auth.signInWithPassword({ email, password })).error,
);
const browser = await chromium.launch();
const name = `admin-polish-${randomUUID().slice(0, 8)}`;
let accountId;
const seasonId = randomUUID();
try {
  const existing = await client.rpc("list_workshare_seasons");
  assert.ifError(existing.error);
  let year = 2200;
  while (
    existing.data.some(
      (season) =>
        season.startsOn <= `${year}-12-31` && season.endsOn >= `${year}-01-01`,
    )
  )
    year++;
  const createdSeason = await client.rpc("create_workshare_season", {
    input: {
      id: seasonId,
      name,
      startsOn: `${year}-01-01`,
      endsOn: `${year}-12-31`,
      copyFromSeasonId: existing.data[0]?.id ?? null,
    },
  });
  assert.ifError(createdSeason.error);
  const firstName = `${name} Avery Morgan`;
  const secondName = `${name} Jordan Rivera`;
  for (const fullName of [firstName, secondName]) {
    const result = await client.rpc("save_workshare_account", {
      input: {
        fullName,
        emails: [email],
        athletes: [
          {
            fullName: "Sample Swimmer",
            trainingGroup: "Juniors",
            timesAthleteId: null,
            isArchived: false,
          },
        ],
        isArchived: false,
      },
    });
    assert.ifError(result.error);
    if (fullName === firstName) accountId = result.data.id;
  }
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
  await context.route("**/*.supabase.co/**", (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + "/tools/admin");
  const search = page.getByRole("searchbox", {
    name: "Search accounts and athletes",
  });
  await search.waitFor();
  assert.equal(
    await page
      .getByRole("heading", { name: "Accounts & Roster", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByText(
        "Manage accounts, seasonal requirements, and completed Workshare hours.",
        { exact: true },
      )
      .count(),
    0,
  );
  const addAccount = page.getByRole("button", {
    name: "Add account",
    exact: true,
  });
  const ticketsTab = page.getByRole("tab", { name: "Tickets", exact: true });
  const tabBounds = await ticketsTab.boundingBox();
  const addBounds = await addAccount.boundingBox();
  assert.equal(
    addBounds.y,
    tabBounds.y,
    "Add account is aligned beside the tabs.",
  );
  assert.equal(
    await addAccount.getAttribute("class"),
    await ticketsTab.getAttribute("class"),
    "Tab and Add account styling match.",
  );
  await ticketsTab.click();
  assert.equal(
    await addAccount.isVisible(),
    true,
    "Add account is always available on Tickets.",
  );
  await addAccount.click();
  await page
    .getByRole("form", { name: "New account", exact: true })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await search.waitFor();
  const season = page.getByRole("combobox", { name: "Workshare season" });
  await page.waitForFunction(
    () =>
      !document.querySelector('select[aria-label="Account archive filter"]')
        ?.disabled && !document.querySelector('button[role="tab"]')?.disabled,
  );
  await season.selectOption(seasonId);
  await search.fill(name);
  const table = page.locator("[data-accounts-table]");
  await page
    .getByRole("button", { name: `Select ${firstName}`, exact: true })
    .waitFor();
  await page.getByText("Columns", { exact: true }).click();
  for (const column of [
    "Athletes",
    "General hours",
    "Starlight hours",
    "Apple Capital hours",
  ])
    await page.getByRole("checkbox", { name: column, exact: true }).uncheck();
  assert.equal(await table.getByRole("columnheader").count(), 2);
  await page.reload();
  await search.waitFor();
  await search.fill(name);
  await page
    .getByRole("button", { name: `Select ${firstName}`, exact: true })
    .waitFor();
  assert.equal(
    await table.getByRole("columnheader").count(),
    2,
    "Column preferences survive reload.",
  );
  await page.getByText("Columns", { exact: true }).click();
  for (const column of [
    "Athletes",
    "General hours",
    "Starlight hours",
    "Apple Capital hours",
  ])
    await page.getByRole("checkbox", { name: column, exact: true }).check();
  await page.getByText("Columns", { exact: true }).click();
  assert.equal(await table.getByRole("columnheader").count(), 6);
  const actions = await table
    .getByRole("button", { name: /^(Edit |Add ticket for )/ })
    .evaluateAll((buttons) =>
      buttons.map((button) => ({
        height: button.getBoundingClientRect().height,
        wrap: getComputedStyle(button).whiteSpace,
      })),
    );
  assert.ok(
    actions.length === 4 &&
      actions.every(
        (action) => action.height >= 44 && action.wrap === "nowrap",
      ),
    "Both row actions are large and never wrap.",
  );
  mkdirSync(artifactPath("workshare/browser"), { recursive: true });
  await page.screenshot({
    path: artifactPath("workshare/browser/admin-table-polish.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: `Select ${firstName}`, exact: true })
    .click();
  let form = page.getByRole("form", { name: `Edit ${firstName}`, exact: true });
  await form.waitFor();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="Navigation sidebar"]')
        ?.getAttribute("data-collapsed") === "true",
  );
  assert.equal(await table.getByRole("columnheader").count(), 1);
  const pane = page.getByRole("complementary", {
    name: "Account editor",
    exact: true,
  });
  await page
    .locator('[aria-label="Navigation sidebar"]')
    .evaluate(async (sidebar) => {
      sidebar.getBoundingClientRect();
      await Promise.all(
        sidebar.getAnimations().map((animation) => animation.finished),
      );
    });
  let initialPosition = await pane.boundingBox();
  const listPosition = await page
    .getByRole("region", { name: "Account list", exact: true })
    .boundingBox();
  assert.ok(
    initialPosition.x > listPosition.x + listPosition.width,
    "Editor occupies the right half.",
  );
  assert.ok(
    initialPosition.width / (listPosition.width + initialPosition.width) > 0.45,
  );
  assert.equal(initialPosition.y, 0, "Editor starts at the top of the screen.");
  assert.equal(
    initialPosition.height,
    1050,
    "Editor fills the viewport height.",
  );
  for (const filter of [
    "Workshare season",
    "Account archive filter",
    "Training group filter",
  ])
    assert.equal(
      await page.getByRole("combobox", { name: filter, exact: true }).count(),
      0,
    );
  assert.equal(
    await table.getByRole("button", { name: /^Edit / }).count(),
    0,
    "Picker has no separate selection action.",
  );
  const ticketRegion = form.getByRole("region", {
    name: "Account tickets",
    exact: true,
  });
  assert.ok(
    (await ticketRegion.boundingBox()).y <
      (
        await form
          .getByLabel("Account full name", { exact: true })
          .boundingBox()
      ).y,
    "Tickets are first.",
  );
  for (const filter of ["Ticket category", "From date", "To date"])
    assert.equal(
      await ticketRegion.getByLabel(filter, { exact: true }).count(),
      0,
    );
  const divider = page.getByRole("separator", {
    name: "Resize account editor",
    exact: true,
  });
  const dividerBounds = await divider.boundingBox();
  await page.mouse.move(dividerBounds.x + dividerBounds.width / 2, 350);
  await page.mouse.down();
  await page.mouse.move(dividerBounds.x + 100, 350, { steps: 10 });
  await page.mouse.up();
  const draggedPosition = await pane.boundingBox();
  assert.ok(
    draggedPosition.width < initialPosition.width - 70,
    "Dragging the divider resizes the editor.",
  );
  await divider.focus();
  await divider.press("ArrowLeft");
  assert.ok(
    (await pane.boundingBox()).width > draggedPosition.width,
    "Divider also supports keyboard resizing.",
  );
  initialPosition = await pane.boundingBox();
  await pane.evaluate((el) => {
    el.scrollTop = 250;
  });
  assert.equal(
    (await search.boundingBox()).y < 100,
    true,
    "Editor scrolling leaves the account search in place.",
  );
  assert.equal(
    await page.evaluate(() => scrollY),
    0,
    "Editor scroll is independent of the page.",
  );
  await pane.evaluate((el) => {
    el.scrollTop = 0;
  });
  assert.equal(
    await form
      .getByRole("switch", { name: "Require Workshare" })
      .getAttribute("aria-checked"),
    "true",
  );
  await form.getByRole("switch", { name: "Require Workshare" }).click();
  await form
    .getByLabel("Note to Account", { exact: true })
    .fill(
      "Your workshare requirement has been waived.\nThank you for helping our team.",
    );
  // A pending save must finish before selecting a different account.
  await page
    .getByRole("button", { name: `Select ${secondName}`, exact: true })
    .click();
  form = page.getByRole("form", { name: `Edit ${secondName}`, exact: true });
  await form.waitFor();
  const switchedPosition = await pane.boundingBox();
  assert.equal(switchedPosition.x, initialPosition.x);
  assert.equal(switchedPosition.width, initialPosition.width);
  assert.equal(
    switchedPosition.y,
    initialPosition.y,
    "Account changes preserve the panel position.",
  );
  let accounts = (
    await (await context.request.get(base + "/api/workshare/accounts")).json()
  ).data;
  assert.equal(
    accounts.find((account) => account.id === accountId).requireWorkshare,
    false,
  );
  assert.match(
    accounts.find((account) => account.id === accountId).workshareNote,
    /waived/,
  );
  assert.equal(
    await form
      .getByRole("switch", { name: "Require Workshare" })
      .getAttribute("aria-checked"),
    "true",
    "Next account has its own toggle.",
  );
  assert.equal(
    await form.getByLabel("Note to Account", { exact: true }).inputValue(),
    "",
  );
  await search.fill("no matching account");
  assert.equal(await form.isVisible(), true, "Search keeps the editor open.");
  await search.fill(name);
  await table
    .getByRole("columnheader", { name: "Account", exact: true })
    .click();
  assert.equal(
    await form.isVisible(),
    true,
    "Outside clicks keep the editor open.",
  );
  await form.getByLabel("Account / athlete emails").fill("invalid-email");
  await page
    .getByRole("button", { name: `Select ${firstName}`, exact: true })
    .click();
  await form.getByRole("alert").waitFor();
  assert.equal(
    await form.isVisible(),
    true,
    "Invalid drafts block account switching.",
  );
  await form.getByLabel("Account / athlete emails").fill(email);
  await form.getByLabel("General hours required", { exact: true }).fill("7");
  await page
    .getByRole("button", { name: `Select ${firstName}`, exact: true })
    .click();
  form = page.getByRole("form", { name: `Edit ${firstName}`, exact: true });
  await form.waitFor();
  assert.match(
    await form.getByLabel("Note to Account", { exact: true }).inputValue(),
    /waived/,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: artifactPath("workshare/browser/admin-editor-polish.png"),
    fullPage: false,
    animations: "disabled",
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "Desktop has no page overflow.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () =>
      getComputedStyle(
        document.querySelector('[aria-label="Navigation sidebar"]'),
      ).visibility === "hidden",
  );
  await page.screenshot({
    path: artifactPath("workshare/browser/admin-mobile-polish.png"),
    fullPage: true,
    animations: "disabled",
  });

  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "Mobile layout stays within viewport.",
  );
  await form.getByRole("button", { name: "Done", exact: true }).click();
  await form.waitFor({ state: "detached" });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="Navigation sidebar"]')
        ?.getAttribute("data-collapsed") === "false",
  );
  assert.equal(
    await table.getByRole("columnheader").count(),
    6,
    "Closing restores full table.",
  );
  // The editor keeps ticket creation and correction available in its narrow pane.
  await page
    .getByRole("button", { name: `Select ${firstName}`, exact: true })
    .click();
  form = page.getByRole("form", { name: `Edit ${firstName}`, exact: true });
  await form.getByRole("button", { name: "Add ticket", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Add ticket", exact: true });
  await dialog.getByLabel("Work date", { exact: true }).fill(`${year}-06-01`);
  await dialog
    .getByLabel("Description", { exact: true })
    .fill("Admin editor ticket check");
  await dialog.getByLabel("Hours", { exact: true }).fill("2");
  await dialog.getByRole("button", { name: "Add ticket", exact: true }).click();
  await dialog.getByText("Added 1 ticket", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await form
    .getByRole("cell", { name: "Admin editor ticket check", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Edit ticket", exact: true });
  await dialog.getByLabel("Hours", { exact: true }).fill("3");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  const summaryResponse = await context.request.get(
    base + `/api/workshare/accounts?seasonId=${seasonId}`,
  );
  const summaries = (await summaryResponse.json()).data;
  assert.equal(
    summaries.find((item) => item.account.id === accountId).completed.general,
    3,
    "Ticket edits update the selected account's total.",
  );
  assert.equal(
    summaries.find((item) => item.account.fullName === secondName).requirements
      .generalHoursRequired,
    7,
    "Account switching flushes seasonal quotas too.",
  );
  await form.getByRole("button", { name: "Done", exact: true }).click();
  // New accounts share the side editor and default to Yes.
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  form = page.getByRole("form", { name: "New account", exact: true });
  assert.equal(
    await form
      .getByRole("switch", { name: "Require Workshare" })
      .getAttribute("aria-checked"),
    "true",
  );
  await form
    .getByLabel("Account full name", { exact: true })
    .fill(`${name} New Account`);
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  form = page.getByRole("form", { name: "New account", exact: true });
  await page.waitForFunction(() => {
    const input = document.querySelector(
      'form[aria-label="New account"] input',
    );
    return input && input.value === "" && !input.closest("fieldset").disabled;
  });
  assert.equal(
    await form.getByLabel("Account full name", { exact: true }).inputValue(),
    "",
    "Repeated Add account starts a fresh editor after saving the previous account.",
  );
  await form
    .getByLabel("Account full name", { exact: true })
    .fill(`${name} Another Account`);
  await form.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("complementary", { name: "Account editor", exact: true })
    .waitFor({ state: "detached" });
  accounts = (
    await (await context.request.get(base + "/api/workshare/accounts")).json()
  ).data;
  assert.equal(
    accounts.find((account) => account.fullName === `${name} New Account`)
      .requireWorkshare,
    true,
  );
  // Notes are delivered to the associated account page through the self-scoped API.
  await page.goto(base + "/tools");
  await page
    .getByRole("heading", { name: "Workshare Tracking", exact: true })
    .waitFor();
  await page
    .getByText("Workshare is not required for this account.", { exact: true })
    .waitFor();
  await page
    .getByText("Your workshare requirement has been waived.", { exact: false })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Admin polish checks passed: saved column choices, large actions, right-side editor, stable switching, validation guards, independent preferences, seasonal saves, mobile layout, and account-page note.",
  );
} finally {
  await browser.close();
  // Also catches an account created just before an assertion failed.
  const { data } = await admin
    .from("workshare_accounts")
    .select("id")
    .like("full_name", `${name}%`);

  const ticketRows = await admin
    .from("workshare_tickets")
    .select("id")
    .eq("season_id", seasonId);
  assert.ifError(ticketRows.error);
  assert.ifError(
    (await admin.from("workshare_tickets").delete().eq("season_id", seasonId))
      .error,
  );
  for (const ticket of ticketRows.data)
    assert.ifError(
      (
        await admin
          .from("workshare_ticket_create_keys")
          .delete()
          .eq("id", ticket.id)
      ).error,
    );
  assert.ifError(
    (
      await admin
        .from("workshare_account_requirements")
        .delete()
        .eq("season_id", seasonId)
    ).error,
  );
  assert.ifError(
    (await admin.from("workshare_seasons").delete().eq("id", seasonId)).error,
  );
  assert.ifError(
    (
      await admin
        .from("administrators")
        .delete()
        .eq("user_id", created.data.user.id)
    ).error,
  );
  assert.ifError(
    (await admin.auth.admin.deleteUser(created.data.user.id)).error,
  );
  for (const account of data ?? (accountId ? [{ id: accountId }] : [])) {
    assert.ifError(
      (await admin.from("workshare_accounts").delete().eq("id", account.id))
        .error,
    );
  }
}
