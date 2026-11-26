import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.VELOCITY_TEST_URL ?? "http://127.0.0.1:3001";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/auth/v1/**", (route) => {
    assert.ok(
      ["127.0.0.1", "localhost"].includes(
        new URL(route.request().url()).hostname,
      ),
    );
    return route.continue();
  });
  await page.goto(base + "/login");
  await page.getByRole("button", { name: /password/i }).click();
  await page.locator("input[type=email]").fill("christiancutter02@gmail.com");
  await page.locator("input[type=password]").fill("Velocity-local-test-2026!");
  await page.locator("button[type=submit]").click();
  await page.waitForURL(base + "/tools");

  // First exercise the real browser -> Next route -> local database path.
  const live = await page.request.get(base + "/api/times?view=records_board");
  assert.equal(live.status(), 200);
  const board = await live.json();
  assert.ok(board.records && board.recordsUpdatedAt);
  assert.ok(Array.isArray(board.races));

  // The stored selection deliberately differs from the fastest supplied race:
  // rendering must use backend winners instead of recalculating in the client.
  const holder = {
    id: "stored-holder",
    athleteId: "stored-athlete",
    athleteName: "Stored record holder",
    team: "velocity-swimming",
    teamName: "Velocity Swimming",
    event: "100_FR",
    course: "SCY",
    gender: "F",
    ageAtSwim: 12,
    time: 60000,
    date: "2026-10-01",
    status: "OK",
    official: true,
    relay: false,
    relayLeg: null,
    split: false,
    resultOrigin: "relay_leadoff",
  };
  const relay = {
    ...holder,
    id: "stored-relay",
    event: "200_FR-R",
    relay: true,
    resultOrigin: undefined,
    members: [{ leg: 1, name: "First Fixture" }],
  };
  const calls = [];
  await page.route("**/api/times?*", (route) => {
    const kind = new URL(route.request().url()).searchParams.get("view");
    calls.push(kind);
    const data =
      kind === "records_board"
        ? {
            records: {
              "SCY:11-12:100_FR:F": [holder.id],
              "SCY:11-12:200_FR-R:F": [relay.id],
            },
            races: [
              holder,
              relay,
              {
                ...holder,
                id: "unused-faster",
                athleteId: "unused",
                athleteName: "Unused faster race",
                time: 50000,
              },
            ],
            recordsUpdatedAt: "2026-11-15T18:00:00Z",
          }
        : { rows: [], total: 0 };
    return route.fulfill({ json: { ...data, expiresAt: Date.now() + 60_000 } });
  });
  await page.goto(base + "/tools/times?view=records");
  const records = page.getByRole("region", { name: "Records", exact: true });
  await records
    .getByRole("region", { name: "SCY 13–14 record table", exact: true })
    .waitFor();
  assert.equal(await records.getAttribute("data-mobile-gender"), "F");
  assert.equal(
    await records
      .getByRole("button", { name: "SCY 13–14 records", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    await records.getByRole("region", { name: /record table$/ }).count(),
    1,
  );
  await records
    .getByRole("button", { name: "SCY 11–12 records", exact: true })
    .click();
  await records.getByText("Stored record holder").waitFor();
  await records
    .getByRole("button", { name: "Long course meters records", exact: true })
    .click();
  assert.equal(
    await records
      .getByRole("region", { name: "LCM 11–12 record table", exact: true })
      .count(),
    1,
  );
  await records
    .getByRole("button", { name: "Short course yards records", exact: true })
    .click();
  await records.getByText("Stored record holder").waitFor();
  assert.equal(
    await records.getByRole("region", { name: /record table$/ }).count(),
    1,
  );
  assert.equal(
    await records.getByText("Verified relay lead-off", { exact: true }).count(),
    0,
  );
  assert.ok(
    await records
      .getByRole("list", { name: "Relay swimmers" })
      .getByTitle("First Fixture")
      .count(),
  );
  assert.equal(
    await records.getByText("Unused faster race", { exact: true }).count(),
    0,
  );
  assert.deepEqual([...new Set(calls)].sort(), ["records_board"]);
  assert.ok(
    await records.getByText("Updated Nov 15, 2026", { exact: true }).count(),
  );
  await records
    .getByRole("button", { name: "Render all records", exact: true })
    .click();
  assert.equal(
    await records.getByRole("region", { name: /record table$/ }).count(),
    14,
  );
  const link = records.getByRole("button", {
    name: "View girls 11–12 SCY 100 FR rankings",
  });
  await link.click();
  await page.waitForURL((url) => url.pathname === "/tools/rankings");
  assert.equal(
    JSON.parse(new URL(page.url()).searchParams.get("filters")).mode,
    "bests",
  );
  const courseFilter = page.getByRole("button", {
    name: "Course: SCY",
    exact: true,
  });
  await courseFilter.waitFor();
  assert.equal(await courseFilter.getAttribute("aria-expanded"), "false");
  await courseFilter.click();
  assert.equal(await courseFilter.getAttribute("aria-expanded"), "true");
  await page.goto(base + "/tools/times?view=records");
  await records
    .getByRole("button", {
      name: "Render all records",
      exact: true,
      pressed: true,
    })
    .waitFor();
  assert.equal(
    await records.getByRole("region", { name: /record table$/ }).count(),
    14,
  );
  await page.reload();
  await records
    .getByRole("button", {
      name: "Render all records",
      exact: true,
      pressed: true,
    })
    .waitFor();
  assert.equal(
    await records.getByRole("region", { name: /record table$/ }).count(),
    14,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await records
    .getByRole("button", { name: "SCY 11–12 records", exact: true })
    .click();
  await records.getByText("Stored h.", { exact: true }).waitFor();
  const mobileRecord = records.getByRole("button", {
    name: "View girls 11–12 SCY 100 FR rankings",
  });
  const mobileRow = mobileRecord.locator("xpath=ancestor::tr");
  const eventCard = mobileRow
    .getByRole("rowheader", { name: "100 Free", exact: true })
    .locator("span");
  const cardBox = await mobileRecord.boundingBox();
  const eventBox = await eventCard.boundingBox();
  assert.ok(cardBox && eventBox);
  assert.ok(Math.abs(eventBox.height - cardBox.height) <= 1);
  const nameBox = await mobileRecord
    .getByText("Stored h.", { exact: true })
    .boundingBox();
  const yearBox = await mobileRecord
    .getByText("2026", { exact: true })
    .boundingBox();
  const timeBox = await mobileRecord
    .getByText("1:00.00", { exact: true })
    .boundingBox();
  assert.ok(nameBox && yearBox && timeBox);
  assert.ok(nameBox.x < timeBox.x && yearBox.x < timeBox.x);
  assert.ok(
    Math.abs(nameBox.y + nameBox.height / 2 - yearBox.y - yearBox.height / 2) <=
      2,
  );
  assert.ok(nameBox.x + nameBox.width <= yearBox.x);
  assert.ok(
    (await eventCard.evaluate((card) =>
      parseFloat(getComputedStyle(card).paddingLeft),
    )) >= 12,
  );
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const recordBounds = await records.boundingBox();
    assert.ok(
      recordBounds.x <= 8 && width - recordBounds.x - recordBounds.width <= 8,
    );
    const name = await mobileRecord
      .getByText("Stored h.", { exact: true })
      .boundingBox();
    const year = await mobileRecord
      .getByText("2026", { exact: true })
      .boundingBox();
    assert.ok(
      Math.abs(name.y + name.height / 2 - year.y - year.height / 2) <= 2,
    );
    assert.ok(name.x + name.width <= year.x);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  }
  await page.screenshot({
    path: "/tmp/velocity-records-mobile.png",
    fullPage: true,
  });
  await records.getByRole("button", { name: "Boys", exact: true }).click();
  assert.equal(await records.getAttribute("data-mobile-gender"), "M");
  await records
    .getByRole("group", { name: "Record course", exact: true })
    .getByRole("button", { name: "LCM", exact: true })
    .click();
  await records
    .getByRole("button", { name: "LCM 13–14 records", exact: true })
    .click();
  await page.reload();
  await records
    .getByRole("button", {
      name: "LCM 13–14 records",
      exact: true,
      pressed: true,
    })
    .waitFor();
  assert.equal(await records.getAttribute("data-mobile-gender"), "M");
  assert.equal(
    await records.getByRole("region", { name: /record table$/ }).count(),
    1,
  );
  const reopened = await page.context().newPage();
  await reopened.goto(base + "/tools/times?view=records");
  const reopenedRecords = reopened.getByRole("region", {
    name: "Records",
    exact: true,
  });
  await reopenedRecords
    .getByRole("button", {
      name: "LCM 13–14 records",
      exact: true,
      pressed: true,
    })
    .waitFor();
  assert.equal(await reopenedRecords.getAttribute("data-mobile-gender"), "M");
  await reopened.close();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Team records: live API, default and remembered board/gender, course/age rows, render-all, stored selections, ranking links, and mobile card layout passed.",
  );
} finally {
  await browser.close();
}
