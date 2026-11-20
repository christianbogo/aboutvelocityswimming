import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

// Runs against the production-mode local frontend and an isolated local session.
// The results are synthetic; only the normal page authorization reaches Supabase.
const base = process.env.VELOCITY_TEST_URL ?? "http://127.0.0.1:3017";
const cookieFile = process.env.VELOCITY_TEST_COOKIES;
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
assert.ok(
  cookieFile,
  "Set VELOCITY_TEST_COOKIES to a local Playwright cookies JSON file",
);
const cookies = JSON.parse(await readFile(cookieFile, "utf8"));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
await context.addCookies(cookies);
const page = await context.newPage();
await page.clock.install();
await page.addInitScript(() => {
  window.__timesVisibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => window.__timesVisibility,
  });
  Math.random = () => 0;
});
let requests = 0;
let version = 1;
let mode = "success";
let release;
let arrived;
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const json = (route, body, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
await page.route("**/api/times?**", async (route) => {
  const kind = new URL(route.request().url()).searchParams.get("view");
  if (kind === "ranking_years") {
    return json(route, {
      years: ["2026"],
      expiresAt: await page.evaluate(() => Date.now() + 60000),
    });
  }
  assert.equal(kind, "rankings");
  requests++;
  arrived?.();
  if (mode === "hold")
    await new Promise((resolve) => {
      release = resolve;
    });
  if (mode === "fail")
    return json(route, { error: "Temporary fixture failure" }, 503);
  const expiresAt = await page.evaluate(() => Date.now() + 60000);
  return json(route, {
    expiresAt,
    total: 1,
    rows: [
      {
        rank: 1,
        race: {
          id: "refresh-race",
          athleteId: "refresh-athlete",
          athleteName: `Refresh fixture swimmer ${version}`,
          date: "2026-11-19",
          event: "100_FR",
          course: "SCY",
          time: 50000,
          status: "OK",
          round: "F",
          team: "velocity-swimming",
          gender: "F",
          ageAtSwim: 13,
          official: true,
          relay: false,
          meetId: "refresh-meet",
          meet: "Refresh fixture meet",
        },
      },
    ],
  });
});
async function requestCount(expected) {
  if (requests >= expected) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Expected ${expected} reads; saw ${requests}`)),
      10000,
    );
    arrived = () => {
      if (requests < expected) return;
      arrived = undefined;
      clearTimeout(timer);
      resolve();
    };
  });
}
const visibleName = (n) =>
  page.getByRole("link", {
    name: `View Times profile for Refresh fixture swimmer ${n}`,
    exact: true,
  });
async function visibility(value) {
  await page.evaluate((state) => {
    window.__timesVisibility = state;
    document.dispatchEvent(new Event("visibilitychange"));
  }, value);
}
try {
  await page.goto(`${base}/tools/rankings`);
  await visibleName(1).waitFor();
  assert.equal(requests, 1, "initial mount must issue one ranking read");
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 10));

  await visibility("hidden");
  await page.clock.runFor(600000);
  assert.equal(requests, 1, "a hidden view must not poll for ten minutes");

  mode = "hold";
  version = 2;
  await visibility("visible");
  await visibility("visible");
  await page.clock.runFor(250);
  await requestCount(2);
  await visibility("visible");
  await page.clock.runFor(5000);
  assert.equal(
    requests,
    2,
    "foreground events must not duplicate an in-flight read",
  );
  assert.ok(
    await visibleName(1).isVisible(),
    "refresh keeps the displayed results",
  );
  mode = "success";
  release();
  await visibleName(2).waitFor();

  mode = "fail";
  const firstFailure = page.waitForResponse(
    (response) =>
      response.url().includes("view=rankings") && response.status() === 503,
  );
  await page.clock.runFor(62000);
  await requestCount(3);
  await firstFailure;
  await page.clock.runFor(0);
  const secondFailure = page.waitForResponse(
    (response) =>
      response.url().includes("view=rankings") && response.status() === 503,
  );
  await page.clock.runFor(1000);
  await requestCount(4);
  await secondFailure;
  await page.clock.runFor(0);
  assert.ok(
    await visibleName(2).isVisible(),
    "failed background refresh must retain results",
  );
  assert.equal(
    await page.locator('[data-loading-skeleton="rankings"]').count(),
    0,
  );

  mode = "success";
  version = 3;
  await page.clock.runFor(5000);
  await requestCount(5);
  await visibleName(3).waitFor();
  assert.equal(requests, 5, "bounded retry should make one recovery request");
  mode = "fail";
  const interruptedFailure = page.waitForResponse(
    (response) =>
      response.url().includes("view=rankings") && response.status() === 503,
  );
  await page.clock.runFor(62000);
  await requestCount(6);
  await interruptedFailure;
  await visibility("hidden");
  await page.clock.runFor(600000);
  assert.equal(requests, 6, "hiding must cancel even a short pending retry");
  mode = "success";
  version = 4;
  await visibility("visible");
  await page.clock.runFor(250);
  await requestCount(7);
  await visibleName(4).waitFor();
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: "/tmp/velocity-times-refresh-browser.png",
    fullPage: true,
  });
  console.log(
    JSON.stringify({
      initialRankingReads: 1,
      hiddenForMinutes: 10,
      hiddenRankingReads: 0,
      foregroundRankingReads: 1,
      duplicatePendingReads: 0,
      retainedResultsOnFailure: true,
      recovered: true,
      cancelledHiddenRetry: true,
      screenshot: "/tmp/velocity-times-refresh-browser.png",
    }),
  );
} finally {
  release?.();
  await context.close();
  await browser.close();
}
