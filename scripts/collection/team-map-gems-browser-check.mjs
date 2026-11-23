import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright";

// Use an isolated local frontend with NEXT_PUBLIC_SUPABASE_URL pointing at
// this test's otherwise-unused auth port. No database or hosted service is used.
const base = process.env.VELOCITY_GEMS_URL ?? "http://127.0.0.1:3001";
const authPort = Number(process.env.VELOCITY_GEMS_AUTH_PORT ?? 54321);
const screenshotStyle =
  "[data-tool-sidebar] > header, nextjs-portal { visibility: hidden !important; }";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const tiers = ["B", "BB", "A", "AA", "AAA", "AAAA"];
const counts = (values = []) =>
  Object.fromEntries(tiers.map((tier, index) => [tier, values[index] ?? 0]));
const roster = [
  ["avery", "Avery Swimmer", "Senior", [2, 1, 4, 3, 2, 1]],
  ["blake", "Blake Swimmer", "Gold", [1, 2, 3, 2, 1, 0]],
  ["casey", "Casey Swimmer", "Senior", [5, 4, 3, 2, 1, 1]],
  ["dana", "Dana Swimmer", "Gold", [4, 4, 4, 3, 2, 1]],
  ["elliot", "Elliot Newcomer", "Novice", []],
  [null, "Finley Unlinked", "Novice", []],
].map(([athleteId, name, group, values], index) => ({
  id: athleteId ?? `unlinked:${index}`,
  athleteId,
  name,
  trainingGroups: [group],
  total: values.reduce((sum, value) => sum + value, 0),
  counts: counts(values),
}));
const rankCounts = counts([12, 11, 14, 10, 6, 3]);
const snapshot = {
  asOf: "2026-11-22",
  year: 2026,
  course: "",
  coverage: {
    rosterEntries: 6,
    linkedAthletes: 5,
    unlinkedEntries: 1,
    duplicateLinks: 0,
    athletesWithSwims: 4,
    validSwims: 90,
    ungradedSwims: 3,
    missingAgeSwims: 0,
  },
  rankCounts,
  totalContributions: 56,
  contributorCount: 4,
  leaders: roster.filter((person) => person.total > 0),
  ageGroups: [],
  roster,
  familyCounts: { IM: 5, FL: 7, BK: 11, BR: 6, FR: 18, DST: 9 },
  gemHistory: [
    { date: "2023-01-01", total: 0, counts: counts() },
    { date: "2023-06-15", total: 9, counts: counts([5, 2, 2]) },
    { date: "2024-03-01", total: 22, counts: counts([8, 4, 5, 3, 2]) },
    { date: "2025-07-01", total: 40, counts: counts([10, 9, 10, 7, 3, 1]) },
    { date: "2026-11-22", total: 56, counts: rankCounts },
  ],
  activity: {
    swims: 20,
    swimmers: 4,
    meets: 3,
    improvedEvents: 7,
    newRankedEvents: 16,
    rankUpgrades: 4,
    months: Array.from({ length: 12 }, (_, index) => ({
      month: `2026-${String(index + 1).padStart(2, "0")}`,
      swims: index === 10 ? 20 : 0,
      swimmers: index === 10 ? 4 : 0,
    })),
    recent: [],
  },
};
const events = [
  "200_IM",
  "100_FL",
  "100_BK",
  "100_BR",
  "50_FR",
  "100_FR",
  "200_FR",
  "500_FR",
  "1000_FR",
  "200_BK",
];
const standard = {
  id: "gems-current",
  name: "2024–2028 USA Swimming Age Group Motivational Standards",
  governingBody: "USA_Swimming",
  category: "motivational",
  standardType: "age-group",
  seasonYears: "2024–2028",
  effectiveDate: "2024-01-01",
  expirationDate: "2028-12-31",
  cuts: {
    SCY: {
      F: {
        "13-14": Object.fromEntries(
          events.map((event) => [
            `${event}_SCY`,
            {
              cutsByTier: tiers.map((tierName, index) => ({
                tierName,
                timeMs: 80000 - index * 10000,
              })),
            },
          ]),
        ),
      },
    },
  },
};
const bests = events.map((event, index) => {
  const race = {
    id: `avery-${event}`,
    athleteId: "avery",
    athleteName: "Avery Swimmer",
    date: "2026-11-18",
    event,
    course: "SCY",
    time: event === "200_BK" ? 90000 : 39000 + index * 1000,
    status: "OK",
    round: "F",
    team: "velocity-swimming",
    gender: "F",
    ageAtSwim: 13,
    official: true,
    relay: false,
    meetId: "gems-meet",
    meet: "Gem profile fixture meet",
  };
  return {
    event,
    race,
    rankRace: race,
    allTimeRank: index + 1,
    allTimeCount: 20,
    rankAgeGroup: "13-14",
    rankGender: "F",
  };
});
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
  refresh_token: "gems-fixture-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: expires,
  user,
};
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
const page = await context.newPage();
const errors = [];
page.setDefaultTimeout(30000);
page.on("pageerror", (error) => errors.push(error.message));
for (const name of ["sb-127-auth-token", "sb-localhost-auth-token"])
  await context.addCookies([
    {
      name,
      value:
        "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"),
      url: base,
      sameSite: "Lax",
    },
  ]);
await context.route("**/*", (route) =>
  ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
    ? route.continue()
    : route.abort(),
);
const fulfill = (route, data) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
await context.route("**/auth/v1/**", (route) =>
  fulfill(
    route,
    new URL(route.request().url()).pathname.endsWith("/user") ? user : session,
  ),
);
await context.route("**/rest/v1/**", (route) => {
  const path = new URL(route.request().url()).pathname;
  let data = [];
  if (path.endsWith("/standards")) data = [{ id: standard.id, data: standard }];
  if (path.endsWith("/is_staff") || path.endsWith("/is_workshare_staff"))
    data = true;
  if (path.endsWith("/get_account_athletes"))
    data = [
      {
        id: "avery",
        name: "Avery Swimmer",
        team_name: "Velocity Swimming",
        is_primary: true,
      },
    ];
  return fulfill(route, data);
});
await context.route("**/api/times/team-map?**", (route) => {
  const params = new URL(route.request().url()).searchParams;
  const empty = params.get("course") === "SCM";
  const data = {
    ...snapshot,
    year: Number(params.get("year")),
    course: params.get("course") ?? "",
    ...(empty
      ? {
          totalContributions: 0,
          contributorCount: 0,
          rankCounts: counts(),
          leaders: [],
          roster: roster.map((person) => ({
            ...person,
            total: 0,
            counts: counts(),
          })),
          familyCounts: { IM: 0, FL: 0, BK: 0, BR: 0, FR: 0, DST: 0 },
          gemHistory: [{ date: snapshot.asOf, total: 0, counts: counts() }],
        }
      : {}),
  };
  return fulfill(route, { data });
});
await context.route("**/api/times?**", (route) =>
  fulfill(route, {
    expiresAt: Date.now() + 60000,
    myTimes: {
      period: "all",
      athleteId: "avery",
      ages: [13],
      years: ["2026"],
      latestAge: 13,
      latestAgeGroup: "13-14",
      events: bests,
    },
  }),
);
const noOverflow = async (width) => {
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  assert.ok(
    layout.document <= layout.viewport + 1,
    `No page overflow at ${width}px: ${JSON.stringify(layout)}`,
  );
};
const setViewport = async (width) => {
  await page.setViewportSize({ width, height: 1000 });
  if (width < 768) {
    const close = page.getByRole("button", {
      name: "Close navigation sidebar",
      exact: true,
    });
    if (await close.isVisible()) await close.click();
    await page.waitForFunction(() => {
      const sidebar = document.querySelector(
        'aside[aria-label="Navigation sidebar"]',
      );
      return sidebar && getComputedStyle(sidebar).visibility === "hidden";
    });
  }
};
try {
  await page.goto(`${base}/tools/team-map`);
  const main = page.getByRole("main");
  const activeRoster = main.getByRole("region", {
    name: "Active roster",
    exact: true,
  });
  await activeRoster.waitFor();
  const members = activeRoster.getByRole("list", {
    name: "Active roster gems",
    exact: true,
  });
  assert.equal(await members.locator(":scope > li").count(), 6);
  assert.equal(await activeRoster.locator("[data-gem-tier]").count(), 56);
  await activeRoster.getByText("No gems yet", { exact: true }).waitFor();
  await activeRoster
    .getByText("Times profile not linked", { exact: true })
    .waitFor();
  const firstRow = members.locator(":scope > li").first();
  assert.deepEqual(
    await firstRow
      .locator("[data-gem-tier]")
      .evaluateAll((squares) =>
        squares.map((square) => square.dataset.gemTier),
      ),
    [
      "B",
      "B",
      "BB",
      "A",
      "A",
      "A",
      "A",
      "AA",
      "AA",
      "AA",
      "AAA",
      "AAA",
      "AAAA",
    ],
  );
  const family = main.getByRole("region", {
    name: "Gems by event family",
    exact: true,
  });
  assert.equal(await family.locator("[data-gem-family]").count(), 6);
  for (const [key, count] of Object.entries(snapshot.familyCounts))
    assert.match(
      await family.locator(`[data-gem-family="${key}"]`).textContent(),
      new RegExp(`${count}$`),
    );
  const history = main.getByRole("region", {
    name: "Gems over time",
    exact: true,
  });
  const slider = history.getByRole("slider", {
    name: "Gem history date",
    exact: true,
  });
  assert.match(await slider.getAttribute("aria-valuetext"), /56 gems$/);
  await slider.focus();
  await slider.press("Home");
  assert.match(await slider.getAttribute("aria-valuetext"), /0 gems$/);
  await slider.press("ArrowRight");
  assert.match(await slider.getAttribute("aria-valuetext"), /9 gems$/);
  await slider.press("End");
  for (const width of [1440, 390, 320]) {
    await setViewport(width);
    await noOverflow(width);
    const [nameBox, gemBox] = await Promise.all([
      firstRow.locator("strong").first().boundingBox(),
      firstRow.getByRole("img").boundingBox(),
    ]);
    assert.ok(
      nameBox && gemBox && gemBox.x > nameBox.x,
      "Gem squares remain to the right of the swimmer's name",
    );
    await page.screenshot({
      path: `/tmp/velocity-team-gems-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await family.locator("..").screenshot({
      path: `/tmp/velocity-team-gem-charts-${width}.png`,
      animations: "disabled",
      style: screenshotStyle,
    });
    await activeRoster.screenshot({
      path: `/tmp/velocity-team-gem-roster-${width}.png`,
      animations: "disabled",
      style: screenshotStyle,
    });
  }
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await noOverflow(320);
  assert.notEqual(
    await family
      .locator('[data-gem-family="FR"]')
      .evaluate((text) => getComputedStyle(text).fill),
    "rgb(0, 0, 0)",
    "Family labels use the dark theme text color instead of SVG's default black",
  );
  await family.locator("..").screenshot({
    path: "/tmp/velocity-team-gem-charts-dark.png",
    animations: "disabled",
    style: screenshotStyle,
  });
  await activeRoster.screenshot({
    path: "/tmp/velocity-team-gem-roster-dark.png",
    animations: "disabled",
    style: screenshotStyle,
  });
  await page.evaluate(() => {
    delete document.documentElement.dataset.theme;
  });
  await main.getByLabel("Course", { exact: true }).selectOption("SCM");
  await history
    .getByText("No gems have been earned in this course selection yet.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await members.locator(":scope > li").count(), 6);
  assert.equal(await activeRoster.locator("[data-gem-tier]").count(), 0);
  for (const key of Object.keys(snapshot.familyCounts))
    assert.match(
      await family.locator(`[data-gem-family="${key}"]`).textContent(),
      /0$/,
    );
  await noOverflow(320);

  await setViewport(1440);
  await page.goto(`${base}/tools/my-times?myView=highlights`);
  const highlights = page.getByRole("region", {
    name: "Highlights",
    exact: true,
  });
  const personalChart = highlights.getByRole("img", {
    name: "Your gems by event family",
    exact: true,
  });
  await personalChart.waitFor();
  assert.equal(await personalChart.locator("[data-gem-family]").count(), 6);
  for (const [key, count] of Object.entries({
    IM: 1,
    FL: 1,
    BK: 1,
    BR: 1,
    FR: 3,
    DST: 2,
  }))
    assert.match(
      await personalChart.locator(`[data-gem-family="${key}"]`).textContent(),
      new RegExp(`${count}$`),
    );
  for (const width of [1440, 390, 320]) {
    await setViewport(width);
    await noOverflow(width);
    const [chartBox, cardsBox] = await Promise.all([
      personalChart.boundingBox(),
      highlights
        .getByRole("list", { name: "Top highlights", exact: true })
        .boundingBox(),
    ]);
    assert.ok(
      chartBox && cardsBox && chartBox.y + chartBox.height <= cardsBox.y,
      "The personal hexagon appears above highlight cards",
    );
    await page.screenshot({
      path: `/tmp/velocity-my-times-gems-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await personalChart.locator("..").screenshot({
      path: `/tmp/velocity-my-times-gem-chart-${width}.png`,
      animations: "disabled",
      style: screenshotStyle,
    });
  }
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await noOverflow(320);
  await personalChart.locator("..").screenshot({
    path: "/tmp/velocity-my-times-gem-chart-dark.png",
    animations: "disabled",
    style: screenshotStyle,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Gem UI checks passed: full roster, sorted color squares, six-family counts, history slider, zero state, My Times hexagon, and no overflow at 1440/390/320px. Synthetic local network fixtures only; no database used.",
  );
} catch (error) {
  console.error("URL", page.url());
  console.error(
    "PAGE",
    (await page.locator("body").innerText()).slice(0, 6000),
  );
  console.error("ERRORS", errors);
  await page
    .screenshot({
      path: "/tmp/velocity-gems-failure.png",
      fullPage: true,
      animations: "disabled",
    })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => authServer.close(resolve));
}
