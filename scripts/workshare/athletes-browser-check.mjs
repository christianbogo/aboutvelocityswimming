import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
          trainingGroup: "Prep",
          timesAthleteId: null,
          isArchived: false,
        },
        {
          fullName: `${prefix} Blake`,
          trainingGroup: "Prep",
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
  assert.equal(await page.getByRole("button", {name: "Add group", exact: true}).count(), 0);
  const response = await page.request.get(base + "/api/workshare/athletes?groupsOnly=1");
  assert.equal(response.status(), 200);
  assert.deepEqual((await response.json()).data.map(group => group.name),
    ["Seniors", "Juniors", "Age Groupers", "Prep", "Other"]);
  await page.getByRole("searchbox", { name: "Search athletes" }).fill(prefix);
  await page
    .getByRole("checkbox", { name: `Select ${prefix} Alex`, exact: true })
    .check();
  await page
    .getByRole("combobox", { name: "Move selected athletes to" })
    .selectOption({ label: "Seniors" });
  await page
    .getByRole("button", { name: "Move athletes", exact: true })
    .click();
  await page.getByText("1 athlete moved.", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Accounts", exact: true }).click();
  await page
    .getByRole("searchbox", { name: "Search accounts and athletes" })
    .fill(prefix);
  await page.getByText(`${prefix} Family`, { exact: true }).click();
  await page
    .getByRole("button", { name: `Athlete settings: ${prefix} Alex` })
    .click();
  const groupSelect = page.getByRole("radio", { name: "None", exact: true }).first();
  assert.equal(await page.getByRole("radio", { name: "Seniors", exact: true }).isChecked(), true);
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
    "PASS: fixed group order, theme controls, bulk move, archiving, Accounts sync.",
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
