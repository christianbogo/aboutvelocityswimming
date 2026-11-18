import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const base = "http://127.0.0.1:3001";
const config = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], {
  encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
}));
assert.equal(config.API_URL, "http://127.0.0.1:54321", "Browser checks require the local backend.");
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
// The tools currently permit this account only. Preserve every existing selection
// and family membership, and keep test athlete/family records isolated.
const email = "christiancutter02@gmail.com";
const listed = await admin.auth.admin.listUsers();
assert.ifError(listed.error);
const user = listed.data.users.find((candidate) => candidate.email === email);
assert.ok(user, "Run seed:local before the browser check.");
const originalPreferences = await admin.from("account_followed_athletes").select("*").eq("user_id", user.id);
assert.ifError(originalPreferences.error);
const originalMemberships = await admin.from("family_emails").select("*").eq("email", email);
assert.ifError(originalMemberships.error);
const originalProfile = await admin.from("account_profiles").select("*").eq("user_id", user.id).maybeSingle();
assert.ifError(originalProfile.error);
const prefix = `account-browser-${randomUUID()}`;
const familyId = `${prefix}-family`;
const athletes = ["Avery", "Blake", "Casey"].map((first, index) => ({
  id: `${prefix}-${index}`,
  name: `${first} Accountcheck`,
  data: { id: `${prefix}-${index}`, name: { first, last: "Accountcheck" }, aliases: [`${first} Accountcheck`] },
}));
const browser = await chromium.launch({ headless: true });
const errors = [];
const readSelections = async () => {
  const result = await admin.from("account_followed_athletes").select("athlete_id, is_primary").eq("user_id", user.id).order("athlete_id");
  assert.ifError(result.error);
  return result.data;
};
try {
  assert.ifError((await admin.from("account_followed_athletes").delete().eq("user_id", user.id)).error);
  assert.ifError((await admin.from("family_emails").delete().eq("email", email)).error);
  assert.ifError((await admin.from("people").insert(athletes.map(({ id, name }) => ({ id: `person_${id}`, data: { name } })))).error);
  assert.ifError((await admin.from("athletes").insert(athletes.map(({ id }) => ({ id, person_id: `person_${id}`, data: {} })))).error);
  assert.ifError((await admin.from("public_athletes").insert(athletes.map(({ id, data }) => ({ id, data })))).error);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.route("**/*.supabase.co/**", (route) => { errors.push("Refused hosted backend"); return route.abort(); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + "/login");
  await page.getByRole("button", { name: /password instead/i }).click();
  await page.locator("input[type=email]").fill(email);
  await page.locator("input[type=password]").fill("Velocity-local-test-2026!");
  await page.locator("button[type=submit]").click();
  await page.waitForURL(base + "/tools");
  await page.getByRole("heading", { name: "Account", level: 1, exact: true }).waitFor();
  const account = page.getByRole("region", { name: "Account management", exact: true });
  const following = account.getByRole("region", { name: "Athlete following", exact: true });
  const family = account.getByRole("region", { name: "Velocity Family", exact: true });
  await following.getByLabel("Search for a primary athlete", { exact: true }).waitFor();
  assert.equal(await family.count(), 0, "Accounts without a family do not show the family section");
  const sidebar = page.getByRole("complementary", { name: "Navigation sidebar", exact: true });
  const navigation = sidebar.getByRole("navigation", { name: "Tools navigation", exact: true });
  const accountLink = navigation.getByRole("link", { name: "Account", exact: true });
  assert.equal(await accountLink.getAttribute("aria-current"), "page");
  assert.ok(await account.getByRole("group", { name: "Signed-in account" }).getByText(email, { exact: true }).isVisible());
  assert.equal(await sidebar.getByText("Logged in as", { exact: true }).count(), 0);
  assert.equal(await sidebar.getByText(email, { exact: true }).count(), 0);
  assert.equal(await navigation.locator(":scope > ul").evaluate(element => getComputedStyle(element).borderTopWidth), "0px");
  assert.equal(await account.getByLabel("Username", { exact: true }).count(), 0);
  assert.equal(await account.getByLabel("Choose profile picture", { exact: true }).count(), 0);
  const signInSettings = account.getByRole("button", { name: "Account Sign-in Settings", exact: true });
  assert.equal(await signInSettings.getAttribute("aria-expanded"), "false");
  await signInSettings.click();
  await account.getByRole("button", { name: "Link Google", exact: true }).waitFor();
  for (const provider of ["Apple", "Microsoft"]) {
    assert.equal(await account.getByRole("button", { name: `Link ${provider}`, exact: true }).count(), 0);
  }
  await account.getByRole("button", { name: "Create passkey", exact: true }).waitFor();

  const main = page.getByRole("main");
  const about = main.getByRole("region", { name: "About the tools", exact: true });
  for (const [name, description] of [
    ["Times", /primary and favorite athletes/],
    ["Rankings", /Compare swimmers by event/],
    ["Records", /Browse team records/],
    ["Standards", /Look up qualifying times/],
    ["Velocity Workshare", /volunteer opportunities/],
    ["Velocity Imports", /review proposed changes/],
  ]) {
    assert.ok(await about.getByText(name, { exact: true }).isVisible());
    assert.ok(await about.getByText(description).isVisible());
  }

  assert.ifError((await admin.from("families").insert({ id: familyId, data: { accountName: "Account check family" } })).error);
  assert.ifError((await admin.from("family_emails").insert({ family_id: familyId, email })).error);
  await page.reload();
  await family.waitFor();
  assert.match(await family.innerText(), /sample/i, "Placeholder family content is clearly labeled");
  await following.getByLabel("Search for a primary athlete", { exact: true }).waitFor();

  const primarySearch = following.getByLabel("Search for a primary athlete", { exact: true });
  const favoritesSearch = following.getByLabel("Search for favorite athletes", { exact: true });
  const save = following.getByRole("button", { name: "Save athletes", exact: true });
  const saved = following.getByRole("status").filter({ hasText: "Athletes saved" });
  const choosePrimary = async (athlete) => {
    await primarySearch.fill(athlete.name);
    await following.getByRole("button", { name: `Select ${athlete.name} as primary athlete`, exact: true }).click();
  };
  const addFavorite = async (athlete) => {
    await favoritesSearch.fill(athlete.name);
    await following.getByRole("button", { name: `Add ${athlete.name} to favorite athletes`, exact: true }).click();
  };
  const primaryRemove = (athlete) => following.getByRole("button", { name: `Remove ${athlete.name} as primary athlete`, exact: true });
  const favoriteRemove = (athlete) => following.getByRole("button", { name: `Remove ${athlete.name} from favorite athletes`, exact: true });
  assert.equal(await save.count(), 0);
  await primarySearch.fill("NoSuchAccountcheckAthlete");
  await following.getByRole("status").filter({ hasText: "No athletes found" }).waitFor();
  const searchRequests = "**/rest/v1/rpc/search_account_athletes";
  await page.route(searchRequests, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Synthetic search failure" }) }));
  await primarySearch.fill(athletes[0].name);
  await following.getByRole("alert").filter({ hasText: "Athlete search is unavailable" }).waitFor();
  await page.unroute(searchRequests);
  await following.getByRole("button", { name: "Retry search", exact: true }).click();
  await following.getByRole("button", { name: `Select ${athletes[0].name} as primary athlete`, exact: true }).waitFor();
  await choosePrimary(athletes[0]);
  await saved.waitFor();
  assert.equal(await save.count(), 0, "Athlete changes save automatically");
  await addFavorite(athletes[1]);
  await addFavorite(athletes[2]);
  await saved.waitFor();
  assert.deepEqual(await readSelections(), athletes.map((athlete, index) => ({ athlete_id: athlete.id, is_primary: index === 0 })));
  await page.reload();
  await primaryRemove(athletes[0]).waitFor();
  await favoriteRemove(athletes[1]).waitFor();
  await favoriteRemove(athletes[2]).waitFor();
  assert.equal(await save.count(), 0, "Saved selections persist after reload");
  await favoritesSearch.fill(athletes[1].name);
  await following.getByRole("status").filter({ hasText: "These athletes are already selected" }).waitFor();
  assert.equal(await following.getByRole("button", { name: `Add ${athletes[1].name} to favorite athletes`, exact: true }).count(), 0, "A favorite cannot be selected twice");
  await favoritesSearch.fill("");
  await choosePrimary(athletes[1]);
  assert.equal(await favoriteRemove(athletes[1]).count(), 0, "Promoting a favorite keeps primary and favorites distinct");
  assert.equal(await primaryRemove(athletes[0]).count(), 0, "Only one primary athlete can be selected");
  await saved.waitFor();
  await choosePrimary(athletes[0]);
  await addFavorite(athletes[1]);
  await saved.waitFor();

  const saveRequests = "**/rest/v1/rpc/save_account_athletes";
  await page.route(saveRequests, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Synthetic save failure" }) }));
  await favoriteRemove(athletes[2]).click();
  await following.getByRole("alert").filter({ hasText: /couldn.t save/i }).waitFor();
  assert.equal(await favoriteRemove(athletes[2]).count(), 0, "Failed saves preserve the draft");
  assert.equal((await readSelections()).length, 3, "Failed saves preserve stored selections");
  await page.unroute(saveRequests);
  await following.getByRole("button", { name: "Retry saving athletes", exact: true }).click();
  await saved.waitFor();
  assert.equal((await readSelections()).length, 2);
  await addFavorite(athletes[2]);
  await saved.waitFor();

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "/tmp/velocity-account-desktop.png", fullPage: true, animations: "disabled" });
  await navigation.getByRole("link", { name: "Times", exact: true }).click();
  await page.waitForURL(base + "/tools/my-times");
  await accountLink.click();
  await page.waitForURL(base + "/tools");
  await primaryRemove(athletes[0]).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[aria-label="Navigation sidebar"]')).visibility === "hidden");
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Mobile account layout does not overflow");
  await page.screenshot({ path: "/tmp/velocity-account-mobile.png", fullPage: true, animations: "disabled" });
  await page.evaluate(() => document.documentElement.dataset.theme = "dark");
  await page.screenshot({ path: "/tmp/velocity-account-dark.png", fullPage: true, animations: "disabled" });

  await primaryRemove(athletes[0]).click();
  await favoriteRemove(athletes[1]).click();
  await favoriteRemove(athletes[2]).click();
  await saved.waitFor();
  assert.deepEqual(await readSelections(), [], "Primary and favorites can all be cleared");
  await page.reload();
  await primarySearch.waitFor();
  assert.equal(await primaryRemove(athletes[0]).count(), 0);
  assert.equal(await favoriteRemove(athletes[1]).count(), 0);
  assert.deepEqual((await admin.from("account_profiles").select("*").eq("user_id", user.id).maybeSingle()).data, originalProfile.data, "Following athletes preserves the existing profile");
  await page.goto(base + "/account");
  await page.waitForURL(base + "/tools");
  await account.getByRole("group", { name: "Signed-in account" }).getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByText("Tools are temporarily locked", { exact: true }).waitFor();
  assert.equal(await account.count(), 0);
  assert.deepEqual(errors, []);
  console.log("Verified account sign-in controls, conditional sample family, primary and multiple favorite athletes, autosave/reload, failed-save retry, removal, responsive/dark layouts, navigation, and sign-out.");
} finally {
  await browser.close();
  assert.ifError((await admin.from("account_followed_athletes").delete().eq("user_id", user.id)).error);
  if (originalPreferences.data.length) assert.ifError((await admin.from("account_followed_athletes").insert(originalPreferences.data)).error);
  assert.ifError((await admin.from("family_emails").delete().eq("email", email)).error);
  if (originalMemberships.data.length) assert.ifError((await admin.from("family_emails").insert(originalMemberships.data)).error);
  assert.ifError((await admin.from("families").delete().eq("id", familyId)).error);
  assert.ifError((await admin.from("public_athletes").delete().in("id", athletes.map(({ id }) => id))).error);
  assert.ifError((await admin.from("athletes").delete().in("id", athletes.map(({ id }) => id))).error);
  assert.ifError((await admin.from("people").delete().in("id", athletes.map(({ id }) => `person_${id}`))).error);
}
