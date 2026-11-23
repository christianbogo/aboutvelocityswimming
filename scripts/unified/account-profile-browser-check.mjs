import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const base = process.env.ACCOUNT_PROFILE_TEST_URL ?? "http://127.0.0.1:3001";
// Use the same seeded local configuration as dev:local. The active stack can
// outlive a project rename, so its Docker container name is not authoritative.
const localEnv = Object.fromEntries(readFileSync(process.env.VELOCITY_LOCAL_ENV_FILE ?? "supabase/.env.local", "utf8")
  .split("\n").filter(line => line.includes("="))
  .map(line => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1)]; }));
const config = { API_URL: localEnv.NEXT_PUBLIC_SUPABASE_URL, SERVICE_ROLE_KEY: localEnv.SUPABASE_SERVICE_ROLE_KEY };
for (const url of [config.API_URL, base])
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname), "Browser checks require local services.");
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
  const following = account.getByRole("region", { name: "Athlete Tracking", exact: true });
  const family = account.getByRole("region", { name: "Velocity Family", exact: true });
  const primaryAdd = following.getByRole("button", { name: "Add primary athlete", exact: true });
  const favoritesAdd = following.getByRole("button", { name: "Add favorite athlete", exact: true });
  const primarySearch = following.getByLabel("Search for a primary athlete", { exact: true });
  const favoritesSearch = following.getByLabel("Search for favorite athletes", { exact: true });
  const openSearch = async (add, search) => {
    if (!(await search.isVisible())) {
      await add.click();
      await search.waitFor();
      assert.ok(await search.evaluate(element => element === document.activeElement), "Opening athlete search focuses the input");
    } else {
      await search.focus();
    }
  };
  await primaryAdd.waitFor();
  await favoritesAdd.waitFor();
  assert.equal(await primarySearch.count(), 0, "Search inputs are hidden until Add Athlete is activated");
  assert.equal(await favoritesSearch.count(), 0);
  const primaryHeading = following.getByRole("heading", { name: "Primary", exact: true });
  const favoritesHeading = following.getByRole("heading", { name: "Favorites", exact: true });
  const primaryColumn = await primaryHeading.boundingBox();
  const favoritesColumn = await favoritesHeading.boundingBox();
  assert.ok(primaryColumn && favoritesColumn);
  assert.ok(Math.abs(primaryColumn.y - favoritesColumn.y) < 1 && favoritesColumn.x > primaryColumn.x, "Primary and Favorites appear side by side on desktop");
  assert.equal(await following.getByText("Choose the athlete you follow most closely.", { exact: true }).count(), 0);
  assert.equal(await following.getByText("Add more athletes you want to keep up with.", { exact: true }).count(), 0);
  const addDimensions = await primaryAdd.boundingBox();
  await openSearch(primaryAdd, primarySearch);
  const searchDimensions = await primarySearch.boundingBox();
  assert.ok(addDimensions && searchDimensions);
  for (const dimension of ["x", "y", "width", "height"]) {
    assert.ok(Math.abs(addDimensions[dimension] - searchDimensions[dimension]) < 1, `Add Athlete and search have the same ${dimension}`);
  }
  await primarySearch.fill("Avery");
  await primarySearch.press("Escape");
  await primaryAdd.waitFor();
  assert.equal(await primarySearch.count(), 0, "Escape closes the search");
  const restoredFocus = await primaryAdd.evaluate(element => new Promise(resolve => requestAnimationFrame(() => resolve(element === document.activeElement))));
  assert.ok(restoredFocus, "Escape restores focus to Add Athlete");
  await openSearch(primaryAdd, primarySearch);
  assert.equal(await primarySearch.inputValue(), "", "Reopening search starts with an empty query");
  await favoritesAdd.click();
  await favoritesSearch.waitFor();
  assert.equal(await primarySearch.count(), 0, "Leaving a search closes it");
  await favoritesSearch.press("Escape");
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
  const signInSettings = account.getByRole("button", { name: "Manage Account", exact: true });
  assert.equal(await signInSettings.getAttribute("aria-expanded"), "false");
  await signInSettings.click();
  await account.getByRole("button", { name: "Link Google", exact: true }).waitFor();
  for (const provider of ["Apple", "Microsoft"]) {
    assert.equal(await account.getByRole("button", { name: `Link ${provider}`, exact: true }).count(), 0);
  }
  await account.getByRole("button", { name: "Create passkey", exact: true }).waitFor();

  const main = page.getByRole("main");
  const about = main.getByRole("region", { name: "About the tools", exact: true });
  assert.equal(await about.count(), 0, "The Account page no longer displays About the tools");

  assert.ifError((await admin.from("families").insert({ id: familyId, data: { accountName: "Account check family" } })).error);
  assert.ifError((await admin.from("family_emails").insert({ family_id: familyId, email })).error);
  await page.reload();
  await family.waitFor();
  assert.match(await family.innerText(), /sample/i, "Placeholder family content is clearly labeled");
  await primaryAdd.waitFor();

  const save = following.getByRole("button", { name: "Save athletes", exact: true });
  const saved = following.getByRole("status").filter({ hasText: "Athletes saved" });
  const choosePrimary = async (athlete) => {
    await openSearch(primaryAdd, primarySearch);
    await primarySearch.fill(athlete.name);
    await following.getByRole("button", { name: `Select ${athlete.name} as primary athlete`, exact: true }).click();
    await primaryAdd.waitFor();
    assert.equal(await primarySearch.count(), 0, "Selecting a primary athlete closes the search");
  };
  const addFavorite = async (athlete) => {
    await openSearch(favoritesAdd, favoritesSearch);
    await favoritesSearch.fill(athlete.name);
    await following.getByRole("button", { name: `Add ${athlete.name} to favorite athletes`, exact: true }).click();
    await favoritesAdd.waitFor();
    assert.equal(await favoritesSearch.count(), 0, "Selecting a favorite closes the search");
  };
  const primaryRemove = (athlete) => following.getByRole("button", { name: `Remove ${athlete.name} as primary athlete`, exact: true });
  const favoriteRemove = (athlete) => following.getByRole("button", { name: `Remove ${athlete.name} from favorite athletes`, exact: true });
  assert.equal(await save.count(), 0);
  await openSearch(primaryAdd, primarySearch);
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
  const primaryList = following.getByRole("list", { name: "Selected primary athlete", exact: true });
  const favoriteList = following.getByRole("list", { name: "Selected favorite athletes", exact: true });
  assert.equal(await primaryList.getByText("0 swims", { exact: true }).count(), 1, "Selected primary shows its database swim count");
  assert.equal(await favoriteList.getByText("0 swims", { exact: true }).count(), 2, "Selected favorites show database swim counts");
  assert.equal(await following.getByText("Team unavailable", { exact: true }).count(), 0, "Athlete rows omit team subtitles");
  for (const athlete of athletes) {
    const chip = following.getByRole("link", { name: `View ${athlete.name} times`, exact: true });
    const href = new URL(await chip.getAttribute("href"), base);
    assert.equal(href.pathname, "/tools/my-times");
    assert.equal(href.searchParams.get("myAthlete"), athlete.id, "Each chip links to its own athlete selection");
    assert.equal(await chip.getByRole("button").count(), 0, "Removal is separate from the athlete navigation link");
  }
  for (const [index, athlete] of athletes.slice(0, 2).entries()) {
    const chip = following.getByRole("link", { name: `View ${athlete.name} times`, exact: true });
    if (index === 0) await chip.click();
    else { await chip.focus(); await chip.press("Enter"); }
    await page.waitForURL(url => url.pathname === "/tools/my-times" && url.searchParams.get("myAthlete") === athlete.id);
    await page.getByRole("button", { name: `Athlete: ${athlete.name}`, exact: true }).waitFor();
    await accountLink.click();
    await page.waitForURL(base + "/tools");
    await primaryRemove(athletes[0]).waitFor();
  }
  const removePrimary = primaryRemove(athletes[0]);
  await primaryHeading.hover();
  await page.waitForFunction(element => getComputedStyle(element).opacity === "0", await removePrimary.elementHandle());
  await primaryList.hover();
  await page.waitForFunction(element => getComputedStyle(element).opacity === "1", await removePrimary.elementHandle());
  await primaryHeading.hover();
  await removePrimary.focus();
  await page.waitForFunction(element => getComputedStyle(element).opacity === "1", await removePrimary.elementHandle());
  await openSearch(favoritesAdd, favoritesSearch);
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
  assert.equal(new URL(page.url()).pathname, "/tools", "The remove control does not navigate to Times");
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
  await primaryAdd.waitFor();
  assert.equal(await primaryRemove(athletes[0]).count(), 0);
  assert.equal(await favoriteRemove(athletes[1]).count(), 0);
  assert.deepEqual((await admin.from("account_profiles").select("*").eq("user_id", user.id).maybeSingle()).data, originalProfile.data, "Tracking athletes preserves the existing profile");
  await page.goto(base + "/account");
  await page.waitForURL(base + "/tools");
  await account.getByRole("group", { name: "Signed-in account" }).getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("heading", { name: "Access restricted", exact: true }).waitFor();
  assert.equal(await account.count(), 0);
  assert.deepEqual(errors, []);
  console.log("Verified athlete tracking columns, click-to-search dimensions/focus/reset, swim counts, hover and keyboard removal controls, account sign-in controls, conditional sample family, primary and multiple favorites, autosave/reload, failed-save retry, responsive/dark layouts, navigation, and sign-out.");
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
