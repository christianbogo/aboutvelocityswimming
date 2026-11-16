import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.VELOCITY_TEST_URL ?? "http://127.0.0.1:3001";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/auth/v1/**", (route) => {
    assert.ok(["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname));
    return route.continue();
  });
  await page.goto(base + "/login");
  await page.getByRole("button", { name: /password/i }).click();
  await page.locator("input[type=email]").fill("christiancutter02@gmail.com");
  await page.locator("input[type=password]").fill("Velocity-local-test-2026!");
  await page.locator("button[type=submit]").click();
  await page.waitForURL(base + "/tools");

  // First exercise the real browser -> Next route -> local database path.
  const live = await page.request.get(base + "/api/times?view=records");
  assert.equal(live.status(), 200);
  const board = await live.json();
  assert.ok(board.records && board.recordsUpdatedAt);
  assert.ok(Array.isArray(board.races));

  // The stored selection deliberately differs from the fastest supplied race:
  // rendering must use backend winners instead of recalculating in the client.
  const holder = {
    id: "stored-holder", athleteId: "stored-athlete", athleteName: "Stored record holder",
    team: "velocity-swimming", teamName: "Velocity Swimming", event: "100_FR", course: "SCY",
    gender: "F", ageAtSwim: 12, time: 60000, date: "2026-10-01", status: "OK",
    official: true, relay: false, relayLeg: null, split: false,
  };
  const calls = [];
  await page.route("**/api/times?*", (route) => {
    const kind = new URL(route.request().url()).searchParams.get("view");
    calls.push(kind);
    const data = kind === "records" ? {
      records: { "SCY:11-12:100_FR:F": [holder.id] },
      races: [holder, { ...holder, id: "unused-faster", athleteId: "unused", athleteName: "Unused faster race", time: 50000 }],
      recordsUpdatedAt: "2026-11-15T18:00:00Z",
    } : { rows: [], total: 0 };
    return route.fulfill({ json: { ...data, expiresAt: Date.now() + 60_000 } });
  });
  await page.goto(base + "/tools/times?view=records");
  const records = page.getByRole("region", { name: "Team records", exact: true });
  await records.getByText("Stored record holder", { exact: true }).waitFor();
  assert.equal(await records.getByText("Unused faster race", { exact: true }).count(), 0);
  assert.deepEqual([...new Set(calls)].sort(), ["records"]);
  assert.ok(await records.getByText("Updated Nov 15, 2026", { exact: true }).count());
  const link = records.getByRole("button", { name: "View girls 11–12 SCY 100 FR rankings" });
  await link.click();
  assert.equal(new URL(page.url()).searchParams.get("view") ?? "rankings", "rankings");
  await page.goto(base + "/tools/times?view=records");
  await page.setViewportSize({ width: 390, height: 844 });
  await records.getByText("Stored record holder", { exact: true }).waitFor();
  await records.getByRole("button", { name: "Boys", exact: true }).click();
  assert.equal(await records.getAttribute("data-mobile-gender"), "M");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log("Team records: live API, stored selections, Velocity-only results, ranking links, and mobile display passed.");
} finally {
  await browser.close();
}
