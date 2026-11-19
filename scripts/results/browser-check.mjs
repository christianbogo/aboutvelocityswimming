import assert from "node:assert/strict";
import { chromium } from "playwright";
import { individual } from "../../tests/fixtures/results/files.ts";
import { artifactPath } from "../verification-artifacts.mjs";
const base = process.env.VELOCITY_TEST_URL ?? "http://127.0.0.1:3001";
assert.ok(
  ["127.0.0.1", "localhost"].includes(new URL(base).hostname),
  "Synthetic browser checks refuse hosted applications.",
);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage(),
  errors = [];
page.setDefaultTimeout(30000);
page.setDefaultNavigationTimeout(60000);
await context.route("**/auth/v1/**", (route) =>
  ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
    ? route.continue()
    : route.abort(),
);
page.on("pageerror", (e) => errors.push(e.message));
const save = async () => {
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/times/manage") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const r = await response;
  assert.equal(r.status(), 200, await r.text());
  await page.getByText("Changes saved.", { exact: true }).waitFor();
  return r.json();
};
const post = (path, data) =>
  page.request.post(base + path, { headers: { Origin: base }, data });
const section = (name) =>
  page
    .getByRole("navigation", { name: "Data sections" })
    .getByRole("button", { name, exact: true })
    .click();
const suffix = Date.now().toString(36);
try {
  assert.equal(
    (await page.request.get(base + "/api/times/manage?kind=swim")).status(),
    401,
  );
  await page.goto(base + "/login");
  await page.getByRole("button", { name: /password/i }).click();
  await page.locator("input[type=email]").fill("christiancutter02@gmail.com");
  await page.locator("input[type=password]").fill("Velocity-local-test-2026!");
  await page.locator("button[type=submit]").click();
  await page.waitForURL(base + "/tools");
  await page.goto(base + "/tools/review");
  await page.waitForURL(base + "/tools/data");
  await page.getByRole("heading", { name: "Data", exact: true }).waitFor();
  await section("Swimmers");
  await page.getByRole("button", { name: "Add swimmer", exact: true }).click();
  await page.getByLabel("First name", { exact: true }).fill("Browser");
  await page.getByLabel("Last name", { exact: true }).fill(suffix);
  await page.getByLabel("Birthday", { exact: true }).fill("2010-01-02");
  const athlete = await save();
  await section("Meets");
  await page.getByRole("button", { name: "Add meet", exact: true }).click();
  await page
    .getByLabel("Meet name", { exact: true })
    .fill("Browser Meet " + suffix);
  await page.getByLabel("Start date", { exact: true }).fill("2026-11-01");
  await page.getByLabel("End date", { exact: true }).fill("2026-11-02");
  const meet = await save();
  await section("Results");
  await page.getByRole("button", { name: "Add result", exact: true }).click();
  await page.getByLabel("Search swimmer", { exact: true }).fill(suffix);
  await page
    .getByLabel("Choose swimmer", { exact: true })
    .selectOption(athlete.id);
  await page.getByLabel("Search meet", { exact: true }).fill(suffix);
  await page.getByLabel("Choose meet", { exact: true }).selectOption(meet.id);
  await page.getByLabel("Race date", { exact: true }).fill("2026-11-01");
  await page.getByLabel("Time", { exact: true }).fill("1:05.00");
  await page.getByLabel("Age at race (optional)", { exact: true }).fill("16");
  const swim = await save();
  const list = await page.request.get(
    base + "/api/times/manage?kind=swim&id=" + swim.id,
  );
  assert.equal((await list.json()).data.timeMs, 65000);
  const newer = await post("/api/times/manage", {
    kind: "swim",
    data: { ...swim.data, timeMs: 64000, timeDisplay: "1:04.00" },
    version: swim.version,
  });
  assert.equal(newer.status(), 200, await newer.text());
  const stale = await post("/api/times/manage", {
    kind: "swim",
    data: swim.data,
    version: swim.version,
  });
  assert.equal(stale.status(), 409);
  const ranking = await page.request.get(
    base +
      "/api/times?view=rankings&search=" +
      suffix +
      "&course=SCY&event=100_FR&genders=F",
  );
  assert.equal((await ranking.json()).rows[0].race.time, 64000);
  await page.getByRole("searchbox").fill(suffix);
  await page
    .getByRole("row")
    .filter({ hasText: suffix })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await page.getByText("Flag or restore this result", { exact: true }).click();
  await page
    .getByRole("button", { name: "Flag and exclude result", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Restore result", exact: true })
    .waitFor();
  const flagged = await page.request.get(
    base +
      "/api/times?view=rankings&search=" +
      suffix +
      "&course=SCY&event=100_FR&genders=F",
  );
  assert.equal((await flagged.json()).rows.length, 0);
  await page
    .getByLabel("Restoration explanation", { exact: true })
    .fill("Verified synthetic source");
  await page
    .getByRole("button", { name: "Restore result", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Flag and exclude result", exact: true })
    .waitFor();
  await section("Standards");
  await page.getByRole("button", { name: "Add standard", exact: true }).click();
  for (const [label, value] of [
    ["Standard name", "Browser " + suffix],
    ["Governing body", "Team"],
    ["Season years", "2026"],
    ["Official source URL", "https://example.test/standards"],
    ["Effective date", "2026-01-01"],
    ["Expiration date", "2026-12-31"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "Add cut", exact: true }).click();
  await page.getByLabel("Cut 1 event").fill("100_FR_SCY");
  await page.getByLabel("Cut 1 tier").fill("A");
  await page.getByLabel("Cut 1 time").fill("1:05.00");
  await save();
  await section("Import File");
  const fixture = individual();
  await page.getByLabel("Result files", { exact: true }).setInputFiles({
    name: fixture.name,
    mimeType: "application/octet-stream",
    buffer: Buffer.from(fixture.bytes),
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/times/import") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Import files", exact: true })
      .click();
    const imported = await response;
    assert.equal(imported.status(), 200, await imported.text());
    const receipt = await imported.json();
    assert.equal(receipt.outcomes.length, 1, JSON.stringify(receipt));
    assert.ok(
      ["saved", "duplicate"].includes(receipt.outcomes[0].status),
      JSON.stringify(receipt),
    );
    await page.getByText(/Import complete\./).waitFor();
    await page.getByLabel("Show rows", { exact: true }).waitFor();
  }
  await page.getByLabel("Show rows", { exact: true }).selectOption("all");
  await page
    .getByRole("cell", { name: "Already recorded.", exact: true })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  const closeNavigation = page.getByRole("button", {
    name: "Close navigation sidebar",
    exact: true,
  });
  if (await closeNavigation.isVisible()) await closeNavigation.click();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Data overflows on mobile",
  );
  await page.screenshot({
    path: artifactPath("data-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  assert.deepEqual(errors, []);
  console.log(
    "Verified manual swimmer/meet/result/standard saves, stale conflicts, immediate rankings, flag/restoration, worker imports, duplicate retries, redirects, and mobile layout.",
  );
} finally {
  await browser.close();
}
