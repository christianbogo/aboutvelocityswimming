import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright";

const base = process.env.GOALS_TEST_URL ?? "http://127.0.0.1:3002";
const local = (value) =>
  ["localhost", "127.0.0.1"].includes(new URL(value).hostname);
assert.ok(local(base), "Goals browser checks require a local frontend.");
const config = JSON.parse(
  execFileSync(
    "supabase",
    [
      "status",
      "--output",
      "json",
      ...(process.env.VELOCITY_SUPABASE_WORKDIR
        ? ["--workdir", process.env.VELOCITY_SUPABASE_WORKDIR]
        : []),
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ),
);
assert.ok(
  local(config.API_URL),
  "Goals browser fixtures require local Supabase.",
);
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const email = "christiancutter02@gmail.com";
const users = await admin.auth.admin.listUsers();
assert.ifError(users.error);
const user = users.data.users.find((candidate) => candidate.email === email);
assert.ok(user, "Run seed:local before checking Goals.");
const original = await admin
  .from("account_followed_athletes")
  .select("*")
  .eq("user_id", user.id)
  .order("athlete_id");
assert.ifError(original.error);

const prefix = `goals-browser-${randomUUID()}-`;
const day = new Date().toLocaleDateString("en-CA", {
  timeZone: "America/Los_Angeles",
});
const year = Number(day.slice(0, 4));
const athletes = [
  "Avery",
  "Blake",
  "Casey",
  ...Array.from({ length: 32 }, (_, index) => `Peer${index}`),
].map((first, index) => ({
  id: `${prefix}${index}`,
  first,
  name: `${first} Goalscheck`,
}));
const meetId = `${prefix}meet`;
const writes = [
  {
    path: `meets/${meetId}`,
    after: { name: "Goals isolated browser fixture" },
  },
  ...athletes.map((athlete) => ({
    path: `athletes/${athlete.id}`,
    after: {
      id: athlete.id,
      name: { first: athlete.first, last: "Goalscheck" },
      gender: "F",
      teamId: "velocity-swimming",
      status: "active",
    },
  })),
];
function swim(id, athleteIndex, eventCode, timeMs, ageAtSwim = 13, date = day) {
  const data = {
    id: prefix + id,
    athleteId: athletes[athleteIndex].id,
    raceIdentity: {
      occurrence: prefix + id,
      reviewed: true,
      basis: "Independent synthetic Goals browser fixture",
      sourceUrl: "https://example.test/goals-browser",
    },
    eventCode,
    course: eventCode.split("_").at(-1),
    timeMs,
    status: "OK",
    round: "F",
    isOfficial: true,
    isRelay: false,
    gender: "F",
    ageAtSwim,
    teamId: "velocity-swimming",
    meet: { id: meetId, name: "Goals isolated browser fixture", date },
  };
  writes.push({ path: `swims/${data.id}`, after: data });
}
swim("primary-freestyle", 0, "100_FR_SCY", 14000);
swim("primary-old-freestyle", 0, "100_FR_SCY", 12000, 11, `${year - 2}-06-15`);
swim("primary-back", 0, "100_BK_SCY", 20000);
swim("primary-breast", 0, "100_BR_SCY", 30000);
swim("primary-lcm", 0, "50_FR_LCM", 15000);
swim("favorite-back", 1, "100_BK_SCY", 21000);
swim("peer-back", 3, "100_BK_SCY", 19500);
for (let index = 0; index < 32; index++)
  swim(
    `peer-fr-${index}`,
    index + 3,
    "100_FR_SCY",
    10000 + Math.min(index, 29) * 100,
  );
const cuts = (times) => ({
  cutsByTier: ["B", "BB", "A", "AA", "AAA", "AAAA"].map((tierName, index) => ({
    tierName,
    timeMs: times[index],
    timeDisplay: (times[index] / 1000).toFixed(2),
  })),
});
const standardBase = {
  governingBody: "USA_Swimming",
  standardType: "age-group",
  seasonYears: String(year),
  effectiveDate: day,
  expirationDate: `${year + 1}-12-31`,
  sourceUrl: "https://example.test/goals-browser-standard",
};
writes.push({
  path: `standards/${prefix}motivational`,
  after: {
    ...standardBase,
    id: `${prefix}motivational`,
    name: "Goals Browser Motivational",
    category: "motivational",
    cuts: {
      SCY: {
        F: {
          "15-16": {
            "100_FR_SCY": cuts([18000, 16000, 15000, 13000, 11000, 10000]),
          },
          "13-14": {
            "100_FR_SCY": cuts([18000, 16000, 15000, 13000, 11000, 10000]),
            "100_BK_SCY": cuts([40000, 35000, 30000, 25000, 18000, 10000]),
            "100_BR_SCY": cuts([60000, 50000, 40000, 29000, 20000, 10000]),
          },
        },
      },
    },
  },
});
writes.push({
  path: `standards/${prefix}championship`,
  after: {
    ...standardBase,
    id: `${prefix}championship`,
    name: "Goals Browser Championship",
    category: "championship",
    cuts: {
      SCY: {
        F: {
          "13-14": {
            "100_FR_SCY": {
              cutsByTier: [
                { tierName: "Qualifying", timeMs: 13500, timeDisplay: "13.50" },
              ],
            },
          },
        },
      },
    },
  },
});

let browser;
let page;
let seeded = false;
const errors = [];
const requests = [];
const paramsFor = (url) =>
  new URL(url).pathname === "/api/times" ? new URL(url).searchParams : null;
try {
  assert.ifError(
    (await admin.rpc("test_write_records", { reads: [], writes })).error,
  );
  seeded = true;
  console.log(
    "Seeded isolated local Goals fixtures; account preferences will be intercepted read-only.",
  );
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  await context.route("**/*.supabase.co/**", (route) => {
    errors.push("Refused a hosted backend request");
    return route.abort();
  });
  await context.route("**/rest/v1/rpc/get_account_athletes", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        athletes
          .slice(0, 3)
          .map((athlete, index) => ({
            id: athlete.id,
            name: athlete.name,
            team_name: "Velocity Swimming",
            is_primary: index === 0,
          })),
      ),
    }),
  );
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const params = paramsFor(request.url());
    if (params) requests.push(params);
  });
  const link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  assert.ifError(link.error);
  const jar = new Map();
  const auth = createServerClient(config.API_URL, config.PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [...jar.values()],
      setAll: (cookies) =>
        cookies.forEach((cookie) => jar.set(cookie.name, cookie)),
    },
  });
  assert.ifError(
    (
      await auth.auth.verifyOtp({
        token_hash: link.data.properties.hashed_token,
        type: "magiclink",
      })
    ).error,
  );
  await context.addCookies(
    [...jar.values()]
      .filter((cookie) => cookie.value)
      .map(({ name, value }) => ({ name, value, url: base, sameSite: "Lax" })),
  );

  await page.goto(base + "/tools/goals");
  const main = page.getByRole("main");
  await main.getByRole("heading", { name: "Goals.", exact: true }).waitFor();
  const filterPanel = main.getByRole("region", {
    name: "Goals filters",
    exact: true,
  });
  const athleteSelect = filterPanel.locator("select").nth(0);
  const courseSelect = filterPanel.locator("select").nth(1);
  const ageInput = filterPanel.locator('input[type="number"]');
  const section = (id) => main.locator(`#${id}`);
  const card = (name) =>
    section("next-goals")
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
  const waitBoards = async () => {
    await main
      .getByText("Comparing all event boards…", { exact: true })
      .waitFor({ state: "hidden" });
  };
  await card("100 Freestyle").waitFor();
  await waitBoards();
  console.log(
    "Authenticated Goals page loaded with local cohort and ranking data.",
  );
  assert.equal(await athleteSelect.inputValue(), athletes[0].id);
  assert.ok(
    await page
      .getByRole("link", { name: "Goals", exact: true })
      .first()
      .isVisible(),
    "Goals appears in the Tools sidebar",
  );
  assert.match(await main.innerText(), /Using age 13, the last recorded age/);
  assert.ok(
    requests.some(
      (params) =>
        params.get("view") === "my_times" && params.get("ageGroup") === "13-14",
    ),
  );
  assert.ok(
    requests.some(
      (params) =>
        params.get("view") === "rankings" &&
        params.get("event") === "100_FR" &&
        params.get("offset") === "31" &&
        params.get("limit") === "1",
    ),
    "Large cohorts fetch the exact immediately preceding row",
  );
  const freeCard = card("100 Freestyle");
  assert.match(await freeCard.innerText(), /14\.00/);
  const standard = freeCard
    .getByRole("listitem")
    .filter({ hasText: "USA Swimming AA" });
  assert.match(await standard.innerText(), /13\.00[\s\S]*1\.00[\s\S]*7\.14%/);
  const championship = freeCard
    .getByRole("listitem")
    .filter({ hasText: "Goals Browser Championship" });
  assert.match(
    await championship.innerText(),
    /13\.50[\s\S]*0\.50[\s\S]*3\.57%/,
  );
  assert.equal(
    await championship
      .getByRole("link", { name: "Official standard" })
      .getAttribute("href"),
    standardBase.sourceUrl,
  );
  const board = freeCard
    .getByRole("listitem")
    .filter({ hasText: "All-time top 25" });
  assert.match(await board.innerText(), /12\.40[\s\S]*1\.60/);
  const freeMove = section("rank-moves")
    .getByRole("row")
    .filter({ hasText: "100 Freestyle" });
  assert.match(
    await freeMove.innerText(),
    /#33[\s\S]*tie #30[\s\S]*14\.00[\s\S]*12\.90[\s\S]*1\.10[\s\S]*7\.86%/,
  );
  const rankingHref = await freeCard
    .getByRole("link", { name: "Explore event rankings" })
    .getAttribute("href");
  const filters = JSON.parse(
    new URL(rankingHref, base).searchParams.get("filters"),
  );
  assert.equal(filters.event, "100_FR");
  assert.deepEqual(filters.ageGroups, ["13-14"]);
  assert.deepEqual(filters.genders, ["F"]);
  assert.equal(filters.course, "SCY");

  const goalKind = (name) =>
    section("next-goals").getByRole("button", { name, exact: true });
  await goalKind("Record board").click();
  assert.equal(await freeCard.getByRole("listitem").count(), 4);
  assert.match(
    await freeCard.innerText(),
    /All-time top 25[\s\S]*All-time top 10[\s\S]*All-time top 5[\s\S]*Tie the team record/,
  );
  await goalKind("Championships").click();
  assert.equal(await freeCard.getByRole("listitem").count(), 1);
  assert.match(await freeCard.innerText(), /Goals Browser Championship/);
  await goalKind("USA standards").click();
  assert.equal(await freeCard.getByRole("listitem").count(), 1);
  assert.match(await freeCard.innerText(), /USA Swimming AA/);
  await goalKind("All goals").click();

  await section("new-events")
    .getByRole("button", { name: /Explore all/ })
    .click();
  const suggestedNames = await section("new-events")
    .getByRole("heading", { level: 3 })
    .allTextContents();
  assert.ok(
    suggestedNames.includes("50 Freestyle") &&
      suggestedNames.includes("200 Freestyle"),
  );
  assert.ok(
    !suggestedNames.includes("100 Freestyle") &&
      !suggestedNames.includes("100 Backstroke") &&
      !suggestedNames.includes("100 Breaststroke"),
  );
  assert.ok(
    !suggestedNames.some((name) => name.startsWith("25 ")),
    "Older athletes do not get 25-yard suggestions",
  );
  assert.match(
    await section("new-events").innerText(),
    /Build on 100 Freestyle/,
  );
  await section("new-events")
    .getByRole("button", { name: "Show first six" })
    .click();

  await ageInput.fill("11");
  await main.getByText(/Goals use 11–12 SCY bests/).waitFor();
  await card("100 Freestyle").getByText("12.00", { exact: true }).waitFor();
  assert.ok(requests.some((params) => params.get("ageGroup") === "11-12"));
  await ageInput.fill("13");
  await freeCard.getByText("14.00", { exact: true }).waitFor();
  await waitBoards();
  await ageInput.fill("15");
  await freeCard.getByText("12.00", { exact: true }).waitFor();
  assert.match(
    await freeCard.innerText(),
    /All-time reference · swum at age 11/,
  );
  assert.equal(
    await section("rank-moves").getByRole("row").count(),
    0,
    "Age-ups never project an older swim into a new age-group rank",
  );
  await goalKind("Record board").click();
  assert.match(
    await freeCard.innerText(),
    /A recorded time in this age group is needed for a board goal/,
  );
  assert.equal(await freeCard.getByRole("listitem").count(), 0);
  await goalKind("All goals").click();
  await ageInput.fill("121");
  await main
    .getByRole("alert")
    .filter({ hasText: "Enter a whole-number age from 0 to 120." })
    .waitFor();
  assert.equal(await ageInput.getAttribute("aria-invalid"), "true");
  assert.equal(
    await section("next-goals").getByRole("article").count(),
    0,
    "Invalid ages suppress computed targets",
  );
  await ageInput.fill("13");
  await freeCard.getByText("14.00", { exact: true }).waitFor();
  await waitBoards();

  await athleteSelect.selectOption(athletes[1].id);
  await card("100 Backstroke").getByText("21.00", { exact: true }).waitFor();
  assert.equal(await section("next-goals").getByRole("article").count(), 1);
  await athleteSelect.selectOption(athletes[0].id);
  await freeCard.getByText("14.00", { exact: true }).waitFor();
  await courseSelect.selectOption("LCM");
  await card("50 Freestyle").getByText("15.00", { exact: true }).waitFor();
  assert.equal(
    await section("new-events")
      .getByRole("heading", { name: "50 Freestyle", exact: true })
      .count(),
    0,
  );
  await courseSelect.selectOption("SCM");
  await section("next-goals")
    .getByText("No published SCM times yet.", { exact: false })
    .waitFor();
  assert.ok(
    (await section("new-events").getByRole("heading", { level: 3 }).count()) >
      0,
  );
  await courseSelect.selectOption("SCY");
  await freeCard.waitFor();
  await athleteSelect.selectOption(athletes[2].id);
  await ageInput.fill("13");
  await section("next-goals")
    .getByText("No published SCY times yet.", { exact: false })
    .waitFor();
  assert.ok(
    (await section("new-events").getByRole("heading", { level: 3 }).count()) >
      0,
  );
  await athleteSelect.selectOption(athletes[0].id);
  await freeCard.waitFor();
  await waitBoards();

  const failRanking = async (route) => {
    const params = paramsFor(route.request().url());
    if (params?.get("view") === "rankings" && params.get("event") === "100_FR")
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic local board outage" }),
      });
    return route.continue();
  };
  await page.route("**/api/times?**", failRanking);
  await page.reload();
  await section("rank-moves")
    .getByText(/1 event board is unavailable; this list is incomplete/)
    .waitFor();
  assert.equal(
    await section("rank-moves")
      .getByRole("row")
      .filter({ hasText: "100 Freestyle" })
      .count(),
    0,
    "An unavailable board does not fabricate a rank move",
  );
  await page.unroute("**/api/times?**", failRanking);
  await section("rank-moves")
    .getByRole("button", { name: "Retry rankings", exact: true })
    .click();
  await freeMove.waitFor();
  await waitBoards();
  assert.equal(
    await section("rank-moves")
      .getByRole("button", { name: "Retry rankings", exact: true })
      .count(),
    0,
  );

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "/private/tmp/velocity-goals-desktop.png",
    fullPage: true,
  });
  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => {
      const sidebar = document.querySelector(
        'aside[aria-label="Navigation sidebar"]',
      );
      return sidebar && getComputedStyle(sidebar).visibility === "hidden";
    });
    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    assert.ok(
      dimensions.document <= width + 1 && dimensions.body <= width + 1,
      `No page-level horizontal overflow at ${width}px: ${JSON.stringify(dimensions)}`,
    );
    assert.ok(
      (await athleteSelect.isVisible()) && (await courseSelect.isVisible()),
    );
    if (width === 375)
      await page.screenshot({
        path: "/private/tmp/velocity-goals-mobile.png",
        fullPage: true,
      });
  }
  assert.deepEqual(
    errors,
    [],
    "No browser runtime errors or hosted backend requests",
  );
  const current = await admin
    .from("account_followed_athletes")
    .select("*")
    .eq("user_id", user.id)
    .order("athlete_id");
  assert.ifError(current.error);
  assert.deepEqual(
    current.data,
    original.data,
    "Account primary and favorite preferences remain exactly unchanged",
  );
  console.log(
    "Goals browser verification passed: live local APIs, exact target math, ties, athlete/course/age selection, suggestions, failure/retry, mobile overflow, and account preservation.",
  );
} catch (error) {
  if (page) {
    console.error((await page.locator("body").innerText()).slice(0, 15000));
    await page
      .screenshot({
        path: "/private/tmp/velocity-goals-failure.png",
        fullPage: true,
      })
      .catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  if (seeded) {
    const people = await admin
      .from("athletes")
      .select("person_id")
      .in(
        "id",
        athletes.map(({ id }) => id),
      );
    assert.ifError(people.error);
    const cleanup = await admin.rpc("test_write_records", {
      reads: [],
      writes: [
        ...writes
          .toReversed()
          .map((write) => ({ path: write.path, after: null })),
        ...people.data
          .filter(({ person_id }) => person_id)
          .map(({ person_id }) => ({
            path: `people/${person_id}`,
            after: null,
          })),
      ],
    });
    assert.ifError(cleanup.error);
    console.log("Removed all synthetic Goals browser fixture records.");
  }
}
