import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright";
// Start the frontend with npm run dev:local. This test owns the otherwise empty
// local backend and serves synthetic data only; no database is used.
// VELOCITY_LAYOUT_AUTH_PORT must match the frontend's local backend port.
const base = process.env.VELOCITY_LAYOUT_URL ?? "http://127.0.0.1:3001";
const authPort = Number(process.env.VELOCITY_LAYOUT_AUTH_PORT ?? 54321);
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const cuts = {
  cutsByTier: ["B", "BB", "A", "AA", "AAA", "AAAA"].map((tierName, index) => ({
    tierName,
    timeMs: 80000 - index * 10000,
  })),
};
const standard = {
  id: "layout-current",
  name: "2024–2028 USA Swimming Age Group Motivational Standards",
  governingBody: "USA_Swimming",
  category: "motivational",
  standardType: "age-group",
  seasonYears: "2024–2028",
  effectiveDate: "2024-09-01",
  expirationDate: "2028-12-31",
  sourceUrl: "https://example.test/standard",
  cuts: {
    SCY: {
      F: { "13-14": { "100_FR_SCY": cuts, "200_FR_SCY": cuts } },
      M: { "13-14": { "100_FR_SCY": cuts } },
    },
    LCM: { F: { "13-14": { "100_FR_LCM": cuts } } },
  },
};
const expired = {
  ...standard,
  id: "layout-expired",
  name: "2020–2024 Motivational Standards",
  seasonYears: "2020–2024",
  effectiveDate: "2020-01-01",
  expirationDate: "2024-08-31",
  cuts: {
    SCY: {
      F: {
        "13-14": {
          "100_FR_SCY": {
            cutsByTier: cuts.cutsByTier.map((cut) => ({
              ...cut,
              timeMs: cut.timeMs + 10000,
            })),
          },
        },
      },
    },
  },
};
const race = (id, time, extra = {}) => ({
  id,
  athleteId: id,
  athleteName: id === "avery" ? "Avery Swimmer" : `Athlete ${id}`,
  date: "2026-11-18",
  event: "100_FR",
  course: "SCY",
  time,
  status: "OK",
  round: "F",
  team: "velocity-swimming",
  gender: "F",
  ageAtSwim: 13,
  official: true,
  relay: false,
  meetId: "layout-meet",
  meet: "Layout test meet",
  ...extra,
});
const races = [
  race("avery", 39000),
  race("tie", 40000),
  race("slower", 41000),
  race("no-cut", 90000),
];
const filters = {
  course: "SCY",
  event: "100_FR",
  year: "",
  startDate: "",
  endDate: "",
  round: "",
  official: "",
  genders: ["F"],
  ageGroups: ["13-14"],
  mode: "bests",
  relay: false,
};
const user = {
  id: "00000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "christiancutter02@gmail.com",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
const expires = Math.floor(Date.now() / 1000) + 3600;
const jwt = [
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  ),
  Buffer.from(
    JSON.stringify({
      sub: user.id,
      aud: "authenticated",
      role: "authenticated",
      exp: expires,
      iat: expires - 3600,
    }),
  ).toString("base64url"),
  "fixture",
].join(".");
const session = {
  access_token: jwt,
  refresh_token: "layout-fixture-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: expires,
  user,
};
const bookmarks = [
  { id: "layout-bookmark", name: "Saved 100 Free", filters, search: "" },
];
// The Next proxy confirms tools access on the server. This isolated local fake
// supplies that identity; a real Supabase stack must not use this port.
const authServer = createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(
    JSON.stringify(request.url.startsWith("/auth/v1/user") ? user : session),
  );
});
await new Promise((resolve, reject) => {
  authServer.once("error", reject);
  authServer.listen(authPort, "127.0.0.1", resolve);
});
authServer.unref();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
for (const key of ["sb-127-auth-token", "sb-localhost-auth-token"]) {
  await context.addCookies([
    {
      name: key,
      value:
        "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"),
      url: base,
      sameSite: "Lax",
    },
  ]);
}
const page = await context.newPage();
const errors = [];
const queries = [];
page.on("pageerror", (error) => errors.push(error.message));
page.setDefaultTimeout(15000);
await context.route("**/*", (route) =>
  ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
    ? route.continue()
    : route.abort(),
);
await context.route("**/auth/v1/**", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(
      new URL(route.request().url()).pathname.endsWith("/user")
        ? user
        : session,
    ),
  }),
);
await context.route("**/rest/v1/**", async (route) => {
  const url = new URL(route.request().url());
  let body = [];
  if (url.pathname.endsWith("/standards"))
    body = [standard, expired].map((data) => ({ id: data.id, data }));
  if (url.pathname.endsWith("/is_staff")) body = true;
  if (url.pathname.endsWith("/get_account_athletes"))
    body = [
      {
        id: "avery",
        name: "Avery Swimmer",
        team_name: "Velocity Swimming",
        is_primary: true,
      },
      {
        id: "blake",
        name: "Blake Favorite",
        team_name: "Velocity Swimming",
        is_primary: false,
      },
      {
        id: "finley",
        name: "Finley Young",
        team_name: "Velocity Swimming",
        is_primary: false,
      },
    ];
  if (url.pathname.endsWith("/times_ranking_bookmarks")) {
    body = bookmarks;
    if (route.request().method() === "POST") {
      const data = route.request().postDataJSON();
      body = { id: "layout-saved", ...data };
      bookmarks.push(body);
    }
  }
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
});
await context.route("**/api/times?**", async (route) => {
  const params = new URL(route.request().url()).searchParams;
  const kind = params.get("view");
  queries.push(Object.fromEntries(params));
  let body = { expiresAt: Date.now() + 60000 };
  if (kind === "ranking_years" || kind === "facets")
    Object.assign(body, {
      years: ["2019", "2023", "2024", "2025", "2026"],
      events: ["100_FR", "200_FR"],
      relayAges: [],
      relayEvents: [],
    });
  if (kind === "rankings")
    Object.assign(body, {
      rows: races.map((race, index) => ({
        race: {
          ...race,
          date: params.get("year") ? `${params.get("year")}-11-18` : race.date,
          time: race.time + (params.get("year") === "2023" ? 10000 : 0),
          ...(index === 0
            ? {
                resultOrigin: "relay_leadoff",
                parentRelayResultId: "layout-parent-relay",
              }
            : {}),
        },
        rank: index + 1,
      })),
      total: races.length,
    });
  if (kind === "records_board")
    Object.assign(body, {
      races: [races[0]],
      records: { "SCY:13-14:100_FR:F": ["avery"] },
      recordsUpdatedAt: "2026-11-18T12:00:00Z",
    });
  if (kind === "my_times")
    Object.assign(body, {
      myTimes: {
        period: "all",
        athleteId: params.get("athleteId"),
        ages: [11, 12, 13],
        years: ["2025", "2026"],
        latestAge: 13,
        latestAgeGroup: "13-14",
        events: [
          {
            event: "100_FR",
            race: races[0],
            rankRace: races[0],
            allTimeRank: 2,
            allTimeCount: 10,
            rankAgeGroup: "13-14",
            rankGender: "F",
          },
          {
            event: "200_FR",
            race: race("slow", 90000, { event: "200_FR" }),
            rankRace: null,
            allTimeRank: null,
            allTimeCount: 0,
            rankAgeGroup: "13-14",
            rankGender: "F",
          },
        ],
      },
    });
  if (kind === "my_times") {
    const historical25 = race("avery-25", 18000, {
      athleteId: "avery",
      date: "2025-01-15",
      event: "25_FR",
      ageAtSwim: 9,
    });
    const event25 = {
      event: "25_FR",
      race: historical25,
      rankRace: historical25,
      allTimeRank: 2,
      allTimeCount: 3,
      rankAgeGroup: "9-10",
      rankGender: "F",
    };
    body.myTimes.ages = [9, 11, 12, 13];
    body.myTimes.events.push(event25);
    if (params.get("ageGroup") === "9-10") body.myTimes.events = [event25];
    if (params.get("athleteId") === "finley") {
      const young25 = race("finley-25", 15000, {
        athleteId: "finley",
        athleteName: "Finley Young",
        event: "25_FR",
        ageAtSwim: 10,
      });
      body.myTimes = {
        ...body.myTimes,
        ages: [9, 10],
        latestAge: 10,
        latestAgeGroup: "9-10",
        events: [{ ...event25, race: young25, rankRace: young25 }],
      };
    }
  }
  if (kind === "my_times_bests")
    Object.assign(body, {
      personalBests: [{ event: "100_FR", race: races[0] }],
      myTimes: {
        period: "all",
        athleteId: params.get("athleteId"),
        ages: [11, 12, 13],
        years: ["2025", "2026"],
        latestAge: 13,
        latestAgeGroup: "13-14",
        events: [
          {
            event: "100_FR",
            race: races[0],
            rankRace: races[0],
            allTimeRank: 2,
            allTimeCount: 10,
            rankAgeGroup: "13-14",
            rankGender: "F",
          },
        ],
      },
    });
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
});
const mobileViewport = async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  const close = page.getByRole("button", {
    name: "Close navigation sidebar",
    exact: true,
  });
  if (await close.isVisible()) await close.click();
  await page.waitForFunction(
    () =>
      getComputedStyle(
        document.querySelector('aside[aria-label="Navigation sidebar"]'),
      ).visibility === "hidden",
  );
};
const gotoView = async (view, extra = {}) => {
  const params = new URLSearchParams(extra);
  const path = view === "my-times" ? "my-times" : view;
  await page.goto(`${base}/tools/${path}?${params}`);
};
try {
  // Every tool is a direct destination on both desktop and mobile.
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await gotoView("rankings");
    for (const [label, path] of [
      ["Times", "my-times"],
      ["Records", "records"],
      ["Standards", "standards"],
      ["Rankings", "rankings"],
    ]) {
      if (width < 768) {
        await page
          .getByRole("button", { name: "Open navigation sidebar", exact: true })
          .click();
      }
      const nav = page.getByRole("navigation", {
        name: "Tools navigation",
        exact: true,
      });
      const link = nav.getByRole("link", { name: label, exact: true });
      assert.equal(await link.getAttribute("href"), `/tools/${path}`);
      assert.equal(await link.getAttribute("aria-expanded"), null);
      assert.equal(
        await nav
          .getByRole("link", { name: "Velocity Times", exact: true })
          .count(),
        0,
      );
      await link.click();
      await page.waitForURL(`${base}/tools/${path}`);
      if (width < 768) {
        await nav.waitFor({ state: "hidden" });
        await page
          .getByRole("button", { name: "Open navigation sidebar", exact: true })
          .click();
      }
      assert.equal(await link.getAttribute("aria-current"), "page");
      if (width < 768) {
        await page
          .getByRole("button", {
            name: "Close navigation sidebar",
            exact: true,
          })
          .click();
      }
    }
    await page.goBack();
    await page.waitForURL(`${base}/tools/standards`);
    await page.reload();
    await page
      .getByRole("region", { name: "Standards", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  }
  await page.goto(
    `${base}/tools/times?view=records&recordCourse=LCM&source=shared#results`,
  );
  await page.waitForURL((url) => url.pathname === "/tools/records");
  assert.equal(new URL(page.url()).searchParams.get("recordCourse"), "LCM");
  assert.equal(new URL(page.url()).searchParams.get("source"), "shared");
  assert.equal(new URL(page.url()).searchParams.has("view"), false);
  await page.goto(`${base}/tools/times/overview`);
  await page.waitForURL(`${base}/tools/my-times`);
  await page.setViewportSize({ width: 1440, height: 1000 });
  console.log(
    "Independent tool pages passed direct desktop/mobile navigation, active links, Back, reload and legacy redirects.",
  );
  await gotoView("standards");
  const standards = page.getByRole("region", {
    name: "Standards",
    exact: true,
  });
  await standards
    .getByRole("button", { name: "Standard", exact: true })
    .waitFor();
  assert.equal(
    await standards
      .getByRole("heading", { name: "Standards", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await standards
      .getByRole("button", { name: "Standard filters", exact: true })
      .count(),
    0,
  );
  await standards
    .getByRole("button", { name: "Standard", exact: true })
    .click();
  await page.screenshot({
    path: "/tmp/velocity-standards-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  const picker = standards.getByRole("dialog", {
    name: "Standard",
    exact: true,
  });
  const bounds = await picker.boundingBox();
  assert.ok(bounds.width >= 1440 * 0.9 && bounds.height >= 1000 * 0.9);
  const selected = picker.getByRole("button", {
    name: standard.name + " · Current",
    exact: true,
  });
  assert.equal(await selected.getAttribute("aria-pressed"), "true");
  assert.ok(
    await selected
      .getByText("USA Swimming age group motivational", { exact: true })
      .isVisible(),
  );
  const expiredRegion = picker.getByRole("region", {
    name: "Expired standards",
    exact: true,
  });
  assert.equal(
    await expiredRegion.evaluate((el) => getComputedStyle(el).borderTopWidth),
    "2px",
  );
  await page.screenshot({
    path: "/tmp/velocity-standards-picker-desktop.png",
    animations: "disabled",
  });
  await picker
    .getByRole("button", { name: "Close standard picker", exact: true })
    .click();
  await standards
    .getByRole("group", { name: "Course", exact: true })
    .getByRole("button", { name: "LCM", exact: true })
    .click();
  assert.ok(
    await standards
      .getByRole("slider", { name: "Age group", exact: true })
      .isVisible(),
  );
  await mobileViewport();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await standards
    .getByRole("button", { name: "Standard", exact: true })
    .click();
  const mobileBounds = await picker.boundingBox();
  assert.ok(
    mobileBounds.width >= 390 * 0.9 && mobileBounds.height >= 844 * 0.9,
  );
  await page.screenshot({
    path: "/tmp/velocity-standards-picker-mobile.png",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  assert.equal(await picker.isVisible(), false);
  await page.screenshot({
    path: "/tmp/velocity-standards-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  console.log(
    "Standards UI passed desktop/mobile popup, expiry divider, highlight, always-open filters and no overflow.",
  );
  {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoView("records");
    const records = page.getByRole("region", { name: "Records", exact: true });
    await records
      .getByRole("navigation", { name: "Record sections", exact: true })
      .waitFor();
    assert.equal(
      await records
        .getByRole("navigation", { name: "Record sections", exact: true })
        .evaluate((nav) => getComputedStyle(nav).display),
      "grid",
    );
    assert.ok(
      (
        await records
          .getByRole("button", { name: "SCY 13–14 records", exact: true })
          .boundingBox()
      ).height >= 38,
    );
    assert.equal(await records.getByRole("combobox").count(), 0);
    assert.equal(
      await records
        .getByRole("heading", {
          name: "Select Course and Age Group",
          exact: true,
        })
        .count(),
      0,
    );
    await records.getByRole("table").first().waitFor();
    assert.equal(await records.getByRole("table").count(), 1);
    assert.equal(
      await records
        .getByRole("heading", {
          name: /^(Short course yards|Long course meters)/i,
        })
        .count(),
      0,
    );
    assert.equal(
      await records.getByRole("link", { name: /Back to selection/i }).count(),
      0,
    );
    assert.equal(await records.getAttribute("data-mobile-gender"), "F");
    assert.equal(
      await records
        .getByRole("button", { name: "SCY 13–14 records", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.ok(
      await records
        .getByRole("region", { name: "SCY 13–14 record table", exact: true })
        .isVisible(),
    );
    await page.screenshot({
      path: "/tmp/velocity-records-desktop.png",
      fullPage: true,
      animations: "disabled",
    });
    await mobileViewport();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    const holder = records.getByRole("button", {
      name: /View girls 13–14 SCY 100 FR rankings/,
    });
    await holder.waitFor();
    assert.ok(await holder.getByText("Avery S.", { exact: true }).isVisible());
    const recordLayout = await holder.evaluate((button) => {
      const row = button.closest("tr");
      const eventCell = Array.from(row.querySelectorAll("th")).find(
        (cell) => cell.getBoundingClientRect().width > 0,
      );
      const event = eventCell.querySelector("span").getBoundingClientRect();
      const result = button.getBoundingClientRect();
      const time = Array.from(button.querySelectorAll("span"))
        .find((span) => span.textContent === "39.00")
        .getBoundingClientRect();
      const name = Array.from(button.querySelectorAll("span"))
        .find((span) => span.textContent === "Avery S.")
        .getBoundingClientRect();
      const year = Array.from(button.querySelectorAll("span"))
        .find((span) => span.textContent === "2026")
        .getBoundingClientRect();
      const board = button.closest('section[aria-label="Records"]');
      return {
        eventHeight: event.height,
        eventPadding: parseFloat(
          getComputedStyle(eventCell.querySelector("span")).paddingLeft,
        ),
        resultHeight: result.height,
        timeLeft: time.left,
        resultLeft: result.left,
        nameMiddle: name.top + name.height / 2,
        yearMiddle: year.top + year.height / 2,
        nameRight: name.right,
        yearLeft: year.left,
        boardLeft: board.getBoundingClientRect().left,
        boardRight: innerWidth - board.getBoundingClientRect().right,
        label: eventCell.textContent.trim(),
      };
    });
    assert.ok(
      Math.abs(recordLayout.eventHeight - recordLayout.resultHeight) <= 1,
    );
    assert.ok(recordLayout.timeLeft > recordLayout.resultLeft + 80);
    assert.ok(Math.abs(recordLayout.nameMiddle - recordLayout.yearMiddle) <= 2);
    assert.ok(recordLayout.nameRight <= recordLayout.yearLeft);
    assert.ok(recordLayout.eventPadding >= 12);
    assert.ok(recordLayout.boardLeft <= 8 && recordLayout.boardRight <= 8);
    assert.equal(recordLayout.label, "100 Free");
    await page.screenshot({
      path: "/tmp/velocity-records-mobile.png",
      fullPage: true,
      animations: "disabled",
    });
    const recordSourceUrl = page.url();
    await holder.click();
    await page.waitForURL((url) => url.pathname === "/tools/rankings");
    const recordFilters = JSON.parse(
      new URL(page.url()).searchParams.get("filters"),
    );
    assert.equal(recordFilters.course, "SCY");
    assert.equal(recordFilters.event, "100_FR");
    assert.equal(recordFilters.mode, "bests");
    assert.deepEqual(recordFilters.ageGroups, ["13-14"]);
    const eventFilters = page.getByRole("button", {
      name: "Event filters",
      exact: true,
    });
    await eventFilters.waitFor();
    assert.equal(await eventFilters.getAttribute("aria-expanded"), "false");
    assert.ok(
      queries.some(
        (query) => query.view === "rankings" && query.mode === "bests",
      ),
    );
    await eventFilters.click();
    assert.equal(await eventFilters.getAttribute("aria-expanded"), "true");
    await page.goBack();
    await records.getByRole("table").first().waitFor();
    assert.equal(page.url(), recordSourceUrl);
    await records
      .getByRole("button", { name: "LCM 15–16 records", exact: true })
      .click();
    await records
      .getByRole("group", { name: "Record gender", exact: true })
      .getByRole("button", { name: "Boys", exact: true })
      .click();
    await gotoView("standards");
    await gotoView("records");
    await records
      .getByRole("region", { name: "LCM 15–16 record table", exact: true })
      .waitFor();
    assert.equal(await records.getByRole("table").count(), 1);
    assert.equal(await records.getAttribute("data-mobile-gender"), "M");
    await page.reload();
    await records
      .getByRole("region", { name: "LCM 15–16 record table", exact: true })
      .waitFor();
    assert.equal(await records.getAttribute("data-mobile-gender"), "M");
    assert.equal(
      await records
        .getByRole("button", { name: "LCM 15–16 records", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await records
      .getByRole("button", { name: "Render all records", exact: true })
      .click();
    assert.equal(await records.getByRole("table").count(), 14);
    await page.reload();
    await records.getByRole("table").first().waitFor();
    assert.equal(await records.getByRole("table").count(), 14);
    assert.equal(
      await records
        .getByRole("button", { name: "Render all records", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(await records.getAttribute("data-mobile-gender"), "M");
    await records
      .getByRole("button", { name: "SCY 13–14 records", exact: true })
      .click();
    assert.equal(await records.getByRole("table").count(), 1);
    console.log(
      "Records UI passed default Girls 13–14 SCY, original course/age controls, remembered selection/gender/render-all, equal mobile card heights and no overflow.",
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoView("rankings", { filters: JSON.stringify(filters) });
    const bookmark = page.getByRole("button", {
      name: "Bookmark Selection",
      exact: true,
    });
    await bookmark.waitFor();
    await page
      .getByRole("button", { name: "Event filters", exact: true })
      .click();
    assert.ok(await bookmark.isVisible());
    await bookmark.click();
    const name = page.getByRole("textbox", {
      name: "Bookmark name",
      exact: true,
    });
    assert.ok((await name.inputValue()).length > 0);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(
      await page
        .getByRole("table")
        .getByText("Verified lead-off", { exact: true })
        .count(),
      0,
    );
    const cutoff = page
      .locator('td:visible div[aria-hidden="true"] > span')
      .filter({ hasText: "40.00 DIAMOND CUTOFF · 2024–2028" })
      .first();
    await cutoff.waitFor();
    const cutoffColors = await cutoff.evaluate((span) => {
      const style = getComputedStyle(span.parentElement);
      return {
        background: style.backgroundColor,
        text: getComputedStyle(span).color,
      };
    });
    assert.equal(cutoffColors.background, "rgb(75, 116, 210)");
    assert.equal(cutoffColors.text, "rgb(255, 255, 255)");
    const allCutoffs = await page
      .locator('td:visible div[aria-hidden="true"]')
      .filter({ hasText: "CUTOFF" })
      .evaluateAll((lines) =>
        lines.map((line) => ({
          background: getComputedStyle(line).backgroundColor,
          text: getComputedStyle(line).color,
          label: line.textContent,
        })),
      );
    assert.ok(allCutoffs.length >= 5);
    for (const colors of allCutoffs) {
      assert.equal(colors.text, "rgb(255, 255, 255)");
      assert.ok(colors.label.includes("2024–2028"));
    }
    const divider = cutoff.locator("xpath=ancestor::tr");
    assert.ok(
      (
        await divider.locator("xpath=preceding-sibling::tr[1]").innerText()
      ).includes("40.00"),
    );
    assert.ok(
      (
        await divider.locator("xpath=following-sibling::tr[1]").innerText()
      ).includes("41.00"),
    );
    await page.screenshot({
      path: "/tmp/velocity-rankings-desktop.png",
      fullPage: true,
      animations: "disabled",
    });
    await mobileViewport();
    await page.screenshot({
      path: "/tmp/velocity-rankings-mobile.png",
      fullPage: true,
      animations: "disabled",
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .getByRole("button", { name: "Event filters", exact: true })
      .click();
    const agePicker = page.getByRole("dialog", {
      name: "Age group",
      exact: true,
    });
    for (const choice of ["11–12", "All ages", "13–14"]) {
      await page
        .getByRole("button", { name: "Age group", exact: true })
        .click();
      await agePicker
        .getByRole("button", { name: choice, exact: true })
        .click();
      await agePicker.waitFor({ state: "hidden" });
    }
    const yearPicker = page.getByRole("dialog", { name: "Year", exact: true });
    const chooseYear = async (year) => {
      await page.getByRole("button", { name: "Year", exact: true }).click();
      await yearPicker.getByRole("button", { name: year, exact: true }).click();
      await yearPicker.waitFor({ state: "hidden" });
    };
    await chooseYear("2023");
    const oldCutoff = page
      .locator('td:visible div[aria-hidden="true"] > span')
      .filter({ hasText: "50.00 DIAMOND CUTOFF · 2020–2024" })
      .first();
    await oldCutoff.waitFor();
    assert.equal(await cutoff.count(), 0);
    await page.screenshot({
      path: "/tmp/velocity-rankings-historical-desktop.png",
      fullPage: true,
      animations: "disabled",
    });
    await chooseYear("2024");
    await cutoff.waitFor();
    assert.equal(await oldCutoff.count(), 0);
    await chooseYear("2019");
    await page
      .getByRole("table")
      .getByText("Nov 18, 2019", { exact: true })
      .first()
      .waitFor();
    assert.equal(
      await page
        .locator('td:visible div[aria-hidden="true"]')
        .filter({ hasText: "CUTOFF" })
        .count(),
      0,
    );
    console.log(
      "Rankings UI passed collapsed bookmarks, age picker auto-close, historical/year-boundary cutoffs, no fallback for missing editions, white cutoff text, and no lead-off row label.",
    );
    await gotoView("my-times");
    const timeFilters = page.getByRole("region", {
      name: "Times filters",
      exact: true,
    });
    await timeFilters.waitFor();
    await page.setViewportSize({ width: 1440, height: 1000 });
    const card25 = page.getByRole("button", {
      name: "View 25 Freestyle rankings",
      exact: true,
    });
    await page
      .getByRole("button", { name: "View 100 Freestyle rankings", exact: true })
      .waitFor();
    assert.equal(
      await card25.count(),
      0,
      "An athlete older than 10 hides their historical 25-yard best",
    );
    const athleteTrigger = timeFilters.getByRole("button", {
      name: "Athlete: Avery Swimmer",
      exact: true,
    });
    await athleteTrigger.hover();
    assert.ok(
      await timeFilters
        .getByRole("button", { name: "Blake Favorite", exact: true })
        .isVisible(),
    );
    await timeFilters
      .getByRole("button", { name: "Finley Young", exact: true })
      .click();
    await card25.waitFor();
    assert.match(await card25.innerText(), /15\.00/);
    await page.screenshot({
      path: "/tmp/velocity-times-young-25-desktop.png",
      fullPage: true,
      animations: "disabled",
    });
    await timeFilters
      .getByRole("button", { name: "Athlete: Finley Young", exact: true })
      .hover();
    await timeFilters
      .getByRole("button", { name: "Avery Swimmer", exact: true })
      .click();
    await page
      .getByRole("button", { name: "View 100 Freestyle rankings", exact: true })
      .waitFor();
    assert.equal(await card25.count(), 0);
    const courseTrigger = timeFilters.getByRole("button", {
      name: "Course: Short Course Yards",
      exact: true,
    });
    await courseTrigger.focus();
    await courseTrigger.press("ArrowDown");
    assert.ok(
      await timeFilters
        .getByRole("button", { name: "Long Course Meters", exact: true })
        .isVisible(),
    );
    await courseTrigger.press("Escape");
    const modeTrigger = () =>
      timeFilters.getByRole("button", { name: /^Best times from:/ });
    await modeTrigger().click();
    await timeFilters
      .getByRole("button", { name: "Age Range", exact: true })
      .click();
    await timeFilters.getByRole("button", { name: /^Age Range:/ }).click();
    await timeFilters
      .getByRole("button", { name: "9–10", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "No eligible individual times" })
      .waitFor();
    assert.ok(
      queries.some(
        (query) => query.view === "my_times" && query.ageGroup === "9-10",
      ),
    );
    assert.equal(
      await card25.count(),
      0,
      "Historical 25-yard swims stay hidden when filtering an older athlete to their younger age group",
    );
    await timeFilters.getByRole("button", { name: /^Age Range:/ }).click();
    await timeFilters
      .getByRole("button", { name: "11–12", exact: true })
      .click();
    await page.waitForFunction(() =>
      new URL(location.href).searchParams.get("myFilters")?.includes("11-12"),
    );
    await page
      .getByRole("button", { name: "View 100 Freestyle rankings", exact: true })
      .waitFor();
    assert.ok(
      queries.some(
        (query) => query.view === "my_times" && query.ageGroup === "11-12",
      ),
    );
    await modeTrigger().click();
    await timeFilters
      .getByRole("button", { name: "Year Range", exact: true })
      .click();
    await timeFilters.getByRole("button", { name: /^Year Range:/ }).click();
    const yearQuery = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname === "/api/times" &&
        url.searchParams.get("startYear") === "2026" &&
        url.searchParams.get("endYear") === "2026"
      );
    });
    await timeFilters
      .getByLabel("Start year", { exact: true })
      .selectOption("2026");
    await timeFilters
      .getByLabel("End year", { exact: true })
      .selectOption("2026");
    await yearQuery;
    await page
      .getByRole("button", { name: "View 100 Freestyle rankings", exact: true })
      .waitFor();
    assert.ok(
      queries.some(
        (query) =>
          query.view === "my_times" &&
          query.startYear === "2026" &&
          query.endYear === "2026",
      ),
    );
    await modeTrigger().click();
    await timeFilters
      .getByRole("button", { name: "All-Time", exact: true })
      .click();
    const timedCard = page.getByRole("button", {
      name: "View 100 Freestyle rankings",
      exact: true,
    });
    const noRankCard = page.getByRole("button", {
      name: "View 200 Freestyle rankings",
      exact: true,
    });
    await timedCard.waitFor();
    const iconGap = await timedCard
      .locator(":scope > span")
      .nth(2)
      .boundingBox();
    const emptyGap = await noRankCard
      .locator(":scope > span")
      .nth(2)
      .boundingBox();
    assert.ok(
      iconGap.height >= 28 &&
        iconGap.height <= 31 &&
        Math.abs(iconGap.height - emptyGap.height) <= 1,
    );
    const compactCard = async () => {
      const heading = await timedCard
        .locator(":scope > span")
        .nth(0)
        .boundingBox();
      const date = await timedCard
        .locator(":scope > span")
        .nth(1)
        .boundingBox();
      const icon = await timedCard
        .locator('img[src^="/assets/ranks/"]')
        .boundingBox();
      assert.ok(date.y - (heading.y + heading.height) <= 3);
      assert.equal(icon.width, 28);
      assert.equal(icon.height, 28);
    };
    await compactCard();
    const timeBounds = await timedCard
      .locator('strong[id$="-time"]')
      .boundingBox();
    assert.ok(iconGap.y + iconGap.height <= timeBounds.y);
    await page.screenshot({
      path: "/tmp/velocity-times-desktop.png",
      fullPage: true,
      animations: "disabled",
    });
    await mobileViewport();
    await compactCard();
    await timeFilters
      .getByRole("button", { name: "Course: Short Course Yards", exact: true })
      .dispatchEvent("pointerdown", { pointerType: "touch" });
    await timeFilters
      .getByRole("button", { name: "Course: Short Course Yards", exact: true })
      .click();
    assert.ok(
      await timeFilters
        .getByRole("button", { name: "Long Course Meters", exact: true })
        .isVisible(),
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: "/tmp/velocity-times-mobile.png",
      fullPage: true,
      animations: "disabled",
    });
    console.log(
      "Times UI passed hover, keyboard and touch menus, age/year queries, equal card spacing and mobile no overflow.",
    );
    const sourceUrl = page.url();
    await timedCard.click();
    await page.waitForURL((url) => url.pathname === "/tools/rankings");
    const linkedFilters = JSON.parse(
      new URL(page.url()).searchParams.get("filters"),
    );
    assert.equal(linkedFilters.event, "100_FR");
    assert.equal(linkedFilters.course, "SCY");
    assert.equal(
      await page.getByRole("button", { name: /Back to (my )?times/i }).count(),
      0,
    );
    await page.goBack();
    await timeFilters.waitFor();
    assert.equal(page.url(), sourceUrl);
    await page.goForward();
    await page.waitForURL((url) => url.pathname === "/tools/rankings");
    console.log(
      "Browser Back/Forward preserves the source Times selection without a backlink.",
    );
  }
  assert.deepEqual(errors, []);
  console.log("No browser runtime errors.");
} catch (error) {
  console.error("URL", page.url());
  console.error(
    "PAGE",
    (await page.locator("body").innerText()).slice(0, 5000),
  );
  console.error("ERRORS", errors);
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => authServer.close(resolve));
}
