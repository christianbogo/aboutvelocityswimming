import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
const name = `admin-polish-${randomUUID()}`;
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
  await page
    .getByRole("button", { name: "Add account", exact: true })
    .waitFor({ state: "visible" });
  assert.equal(
    await page
      .getByRole("button", { name: "Export JSON", exact: true })
      .count(),
    0,
  );
  const season = page.getByRole("combobox", { name: "Workshare season" });
  await page.waitForFunction(
    () =>
      document.querySelector('select[aria-label="Account archive filter"]') &&
      !document.querySelector('button[role="tab"]').disabled,
  );
  await season.selectOption(seasonId);
  const positions = await season.evaluate((select) => {
    const archive = document.querySelector(
      '[aria-label="Account archive filter"]',
    );
    return {
      season: select.getBoundingClientRect().right,
      archive: archive.getBoundingClientRect().left,
    };
  });
  assert.ok(
    positions.season <= positions.archive,
    "Season selector is left of account filter.",
  );
  assert.equal(
    await page.getByRole("button", { name: "New season", exact: true }).count(),
    0,
  );
  // Search-only tab changes must not request another server-rendered page.
  let navigations = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/tools/admin") navigations++;
  });
  await page.getByRole("tab", { name: "Tickets", exact: true }).click();
  await page
    .getByRole("heading", { name: "Workshare Tickets", exact: true })
    .waitFor();
  await page.getByRole("region", { name: "Season tickets" }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("tab"), "tickets");
  assert.equal(new URL(page.url()).searchParams.get("season"), seasonId);
  await page.getByRole("tab", { name: "Accounts", exact: true }).click();
  await search.waitFor();
  assert.equal(navigations, 0, "Tab changes stay client-side.");
  await search.fill(name);
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  const form = page.locator('form[aria-label="New account"]');
  await form.getByLabel("Account full name", { exact: true }).fill(name);
  assert.equal(await search.isEnabled(), true);
  // Clicking a label must still focus its input without dismissing the editor.
  await form.getByText("Account full name", { exact: true }).click();
  assert.equal(await form.isVisible(), true);
  // A click on the editor's empty left padding closes after flushing changes.
  await form.locator("..").click({ position: { x: 3, y: 3 } });
  await form.waitFor({ state: "detached" });
  let response = await context.request.get(base + "/api/workshare/accounts");
  let accounts = (await response.json()).data;
  accountId = accounts.find((account) => account.fullName === name)?.id;
  assert.ok(accountId, "Closing blank space persists pending account changes.");
  const edit = page.locator(`form[aria-label="Edit ${name}"]`);
  await page.getByRole("button", { name: `Edit ${name}`, exact: true }).click();
  await edit.getByLabel("Account / athlete emails").fill("saved@example.test");
  await search.click();
  await edit.waitFor({ state: "detached" });
  await search.fill(name);
  assert.equal(await search.inputValue(), name);
  response = await context.request.get(base + "/api/workshare/accounts");
  accounts = (await response.json()).data;
  assert.deepEqual(
    accounts.find((account) => account.id === accountId).emails,
    ["saved@example.test"],
  );
  // Clicking outside the form also flushes pending edits before dismissal.
  await page.getByRole("button", { name: `Edit ${name}`, exact: true }).click();
  await edit
    .getByLabel("Account / athlete emails")
    .fill("outside@example.test");
  await page
    .getByRole("heading", { name: "Accounts & Roster", exact: true })
    .click();
  await edit.waitFor({ state: "detached" });
  response = await context.request.get(base + "/api/workshare/accounts");
  accounts = (await response.json()).data;
  assert.deepEqual(
    accounts.find((account) => account.id === accountId).emails,
    ["outside@example.test"],
  );
  // Invalid drafts remain open, protecting unsaved input.
  await page.getByRole("button", { name: `Edit ${name}`, exact: true }).click();
  await edit.getByLabel("Account / athlete emails").fill("invalid-email");
  await page
    .getByRole("heading", { name: "Accounts & Roster", exact: true })
    .click();
  await edit.getByRole("alert").waitFor();
  assert.equal(await edit.isVisible(), true);
  await edit.getByLabel("Account / athlete emails").fill("saved@example.test");
  // Keyboard focus on search dismisses too.
  await search.focus();
  await edit.waitFor({ state: "detached" });
  await page.getByRole("tab", { name: "Tickets", exact: true }).click();
  await page
    .getByRole("heading", { name: "Workshare Tickets", exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByRole("heading", { name: "Workshare Tickets", exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Admin polish browser checks passed: layout, labels, blank-space close, search close, persistence, invalid drafts, Tickets navigation and reload.",
  );
} finally {
  await browser.close();
  // Also catches an account created just before an assertion failed.
  const { data } = await admin
    .from("workshare_accounts")
    .select("id")
    .eq("full_name", name);

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
