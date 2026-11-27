import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { localSupabase, assertLocalBackend } from "../local-supabase.mjs";

const config = localSupabase();
const base = process.env.WORKSHARE_BROWSER_URL || "http://127.0.0.1:3011";
assertLocalBackend(base);
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const prefix = `roster-${randomUUID().slice(0, 8)}`;
const email = `${prefix}@velocity-swimming.com`,
  password = `Aa1!${randomUUID()}`;
const created = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
assert.ifError(created.error);
const cookies = [];
const client = createServerClient(
  config.API_URL,
  config.PUBLISHABLE_KEY || config.ANON_KEY,
  {
    cookies: { getAll: () => [], setAll: (values) => cookies.push(...values) },
  },
);
const browser = await chromium.launch();
let accountId;
try {
  assert.ifError(
    (await client.auth.signInWithPassword({ email, password })).error,
  );
  const saved = await client.rpc("save_workshare_account", {
    input: {
      fullName: `${prefix} Family`,
      emails: [email],
      isArchived: false,
      athletes: [
        {
          fullName: `${prefix} Alex`,
          trainingGroup: `${prefix} Prep`,
          timesAthleteId: null,
          isArchived: false,
        },
        {
          fullName: `${prefix} Blake`,
          trainingGroup: `${prefix} Prep`,
          timesAthleteId: null,
          isArchived: true,
        },
      ],
    },
  });
  assert.ifError(saved.error);
  accountId = saved.data.id;
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
  await page.goto(base + "/tools/admin?tab=athletes");
  await page.getByRole("heading", { name: "Athletes", exact: true }).waitFor();
  const themes = page.getByRole("group", { name: "Theme preference" });
  assert.equal(await themes.getByRole("button").count(), 3);
  await page.getByRole("separator", { name: "Resize navigation sidebar" }).press("Escape");
  assert.equal(await themes.getByRole("button").count(), 1);
  for (const [current, next] of [["system", "light"], ["light", "dark"], ["dark", "system"]]) {
    await themes.getByRole("button", { name: `Theme: ${current}. Switch to ${next} theme` }).click();
    assert.equal(await page.locator("html").getAttribute("data-theme-preference"), next);
  }
  await page.getByRole("button", { name: "Open navigation sidebar", exact: true }).press("Enter");
  assert.equal(await themes.getByRole("button").count(), 3);
  await page.getByRole("button", { name: "Add group", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Group name" })
    .fill(`${prefix} Seniors`);
  await page.getByRole("textbox", { name: "Coach name" }).fill("Coach Avery");
  await page.getByRole("button", { name: "Save group" }).click();
  await page.getByText("Group created.", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Reorder groups", exact: true })
    .click();
  const moveUp = page.getByRole("button", {
    name: `Move ${prefix} Seniors up`,
    exact: true,
  });
  await moveUp.focus();
  await page.keyboard.press("Enter");
  const order = page.getByRole("list", { name: "Group order", exact: true });
  const labels = await order.getByRole("listitem").allTextContents();
  assert.ok(labels.at(-2).includes(`${prefix} Seniors`));
  assert.ok(labels.at(-1).includes(`${prefix} Prep`));
  await page.setViewportSize({ width: 390, height: 844 });
  const closeOrderNavigation = page.getByRole("button", {
    name: "Close navigation sidebar",
    exact: true,
  });
  if (await closeOrderNavigation.isVisible())
    await closeOrderNavigation.click();
  mkdirSync("/tmp/velocity-athletes-check", { recursive: true });
  await page.screenshot({
    path: "/tmp/velocity-athletes-check/group-order-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    "Group ordering must fit mobile width",
  );
  await page.getByRole("button", { name: "Save order", exact: true }).click();
  await page.getByText("Group order saved.", { exact: true }).waitFor();
  await page.reload();
  const orderedResponse = await page.request.get(
    base + "/api/workshare/athletes?groupsOnly=1",
  );
  assert.equal(orderedResponse.status(), 200);
  const persistedGroups = (await orderedResponse.json()).data;
  assert.deepEqual(
    persistedGroups.slice(-2).map((group) => group.name),
    [`${prefix} Seniors`, `${prefix} Prep`],
  );
  assert.ok(
    persistedGroups.every(
      (group, index) =>
        !index || group.sort_order > persistedGroups[index - 1].sort_order,
    ),
  );
  await page.setViewportSize({ width: 1440, height: 1050 });

  await page.getByRole("searchbox", { name: "Search athletes" }).fill(prefix);
  await page
    .getByRole("checkbox", { name: `Select ${prefix} Alex`, exact: true })
    .check();
  await page
    .getByRole("combobox", { name: "Move selected athletes to" })
    .selectOption({ label: `${prefix} Seniors` });
  await page
    .getByRole("button", { name: "Move athletes", exact: true })
    .click();
  await page.getByText("1 athlete moved.", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: new RegExp(`^${prefix} Seniors,`) })
    .click();
  await page
    .getByRole("button", { name: "Group settings", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Group name" })
    .fill(`${prefix} Performance`);
  await page.getByRole("textbox", { name: "Coach name" }).fill("Coach Blake");
  await page.getByRole("button", { name: "Save group", exact: true }).click();
  await page.getByText("Group saved.", { exact: true }).waitFor();
  await page.reload();
  await page
    .getByRole("button", {
      name: new RegExp(`^${prefix} Performance,.*Coach Blake`),
    })
    .waitFor();
  await page
    .getByRole("button", { name: new RegExp(`^${prefix} Prep,`) })
    .click();
  await page
    .getByRole("button", { name: "Group settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Remove group", exact: true }).click();
  assert.match(
    await page.getByText(/Move all 0 athletes/).textContent(),
    /including archived/,
  );
  await page
    .getByRole("combobox", { name: "Move athletes to", exact: true })
    .selectOption({ label: `${prefix} Performance` });
  await page
    .getByRole("button", { name: "Remove group and move athletes" })
    .click();
  await page
    .getByText("Group removed and athletes reassigned.", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: /^Archived,/ }).click();
  await page
    .getByRole("checkbox", { name: `Select ${prefix} Blake`, exact: true })
    .waitFor();
  mkdirSync("/tmp/velocity-athletes-check", { recursive: true });
  await page.screenshot({
    path: "/tmp/velocity-athletes-check/desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const closeNavigation = page.getByRole("button", {
    name: "Close navigation sidebar",
    exact: true,
  });
  if (await closeNavigation.isVisible()) await closeNavigation.click();
  await page.screenshot({
    path: "/tmp/velocity-athletes-check/mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    "Page must fit mobile width",
  );
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole("tab", { name: "Accounts", exact: true }).click();
  await page
    .getByRole("searchbox", { name: "Search accounts and athletes" })
    .fill(prefix);
  await page.getByText(`${prefix} Family`, { exact: true }).click();
  await page
    .getByRole("button", { name: `Athlete settings: ${prefix} Alex` })
    .click();
  const groupSelect = page.getByRole("radio", { name: "None", exact: true }).first();
  assert.equal(await page.getByRole("radio", { name: `${prefix} Performance`, exact: true }).isChecked(), true);
  assert.equal(
    await page
      .getByRole("radio", { name: `${prefix} Prep`, exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("button", {
      name: `Archive athlete: ${prefix} Alex`,
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: `Unarchive athlete: ${prefix} Alex`,
      exact: true,
    })
    .waitFor();
  assert.equal(await groupSelect.isChecked(), true);
  assert.equal(await groupSelect.isDisabled(), true);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("form", { name: `Edit ${prefix} Family`, exact: true })
    .waitFor({ state: "hidden" });
  const archived = await client
    .from("workshare_athletes")
    .select("is_archived,training_group")
    .eq("account_id", accountId)
    .eq("full_name", `${prefix} Alex`)
    .single();
  assert.ifError(archived.error);
  assert.deepEqual(archived.data, { is_archived: true, training_group: "" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: shared group ordering, keyboard/mobile controls, persistence, create, coach assignment, bulk move, rename, archived reassignment, Accounts sync.",
  );
} finally {
  await browser.close();
  if (accountId)
    assert.ifError(
      (await admin.from("workshare_accounts").delete().eq("id", accountId))
        .error,
    );
  assert.ifError(
    (await admin.from("workshare_groups").delete().like("name", `${prefix}%`))
      .error,
  );
  assert.ifError(
    (await admin.auth.admin.deleteUser(created.data.user.id)).error,
  );
}
