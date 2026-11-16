import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const base = process.env.MY_TIMES_TEST_URL ?? "http://127.0.0.1:3001";
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(base).hostname),
  "My Times browser checks only run against a local frontend.",
);
const config = JSON.parse(
  execFileSync("supabase", ["status", "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
);
assert.equal(config.API_URL, "http://127.0.0.1:54321");
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
// This seeded account is the only tools account currently enabled. Restore its
// selections in finally, and never alter any existing athletes or public swims.
const email = "christiancutter02@gmail.com";
const listed = await admin.auth.admin.listUsers();
assert.ifError(listed.error);
const user = listed.data.users.find((candidate) => candidate.email === email);
assert.ok(user, "Run seed:local before this browser check.");
const original = await admin
  .from("account_followed_athletes")
  .select("*")
  .eq("user_id", user.id);
assert.ifError(original.error);

const prefix = `my-times-browser-${randomUUID()}-`;
const today = new Date().toLocaleDateString("en-CA", {
  timeZone: "America/Los_Angeles",
});
const year = Number(today.slice(0, 4));
const seasonYear = Number(today.slice(5, 7)) >= 9 ? year : year - 1;
const previousYear = `${seasonYear - 1}`;
const recentYear = `${seasonYear}`;
const athletes = ["Avery", "Blake", "Casey", "Dana", "Elliot"].map(
  (first, index) => ({
    id: `${prefix}${index}`,
    name: `${first} Mytimescheck`,
    first,
  }),
);
const meet = `${prefix}meet`;
const writes = [
  { path: `meets/${meet}`, after: { name: "My Times browser fixture" } },
  ...athletes.map((athlete) => ({
    path: `athletes/${athlete.id}`,
    after: {
      id: athlete.id,
      name: { first: athlete.first, last: "Mytimescheck" },
      gender: "F",
      teamId: "velocity-swimming",
      status: "active",
    },
  })),
];
function swim(id, athlete, timeMs, date, ageAtSwim, extra = {}) {
  const data = {
    id: prefix + id,
    athleteId: athletes[athlete].id,
    raceIdentity: {
      occurrence: prefix + id,
      reviewed: true,
      basis: "Independent synthetic browser-check swim",
      sourceUrl: "https://example.test/my-times-browser",
    },
    eventCode: "100_FR_SCY",
    course: "SCY",
    timeMs,
    status: "OK",
    round: "F",
    isOfficial: true,
    isRelay: false,
    gender: "F",
    ageAtSwim,
    teamId: "velocity-swimming",
    meet: { id: meet, name: "My Times browser fixture", date },
    ...extra,
  };
  writes.push({ path: `swims/${data.id}`, after: data });
}
swim("primary-old", 0, 35200, `${previousYear}-06-15`, 11);
swim("primary-recent", 0, 39400, `${recentYear}-06-15`, 12);
swim("primary-preseason", 0, 45000, `${recentYear}-08-31`, 13);
swim("primary-season", 0, 45600, today, 13);
swim("primary-back", 0, 200000, today, 13, { eventCode: "100_BK_SCY" });
swim("primary-lcm", 0, 32500, today, 13, {
  eventCode: "50_FR_LCM",
  course: "LCM",
});
swim("favorite", 1, 47800, today, 13);
swim("faster-teammate", 3, 44100, today, 13);
swim("historic-teammate", 4, 44400, `${recentYear}-08-30`, 13);
const cut = {
  cutsByTier: ["B", "BB", "A", "AA", "AAA", "AAAA"].map((tierName, index) => ({
    tierName,
    timeMs: 80000 - index * 10000,
    timeDisplay: `${80 - index * 10}.00`,
  })),
};
writes.push({
  path: `standards/${prefix}standard`,
  after: {
    id: `${prefix}standard`,
    name: "My Times browser motivational fixture",
    governingBody: "USA_Swimming",
    category: "motivational",
    standardType: "age-group",
    seasonYears: `${previousYear}–${seasonYear + 1}`,
    effectiveDate: `${previousYear}-01-01`,
    expirationDate: `${seasonYear + 1}-12-31`,
    sourceUrl: "https://example.test/my-times-browser-standard",
    cuts: {
      SCY: {
        F: {
          "11-12": { "100_FR_SCY": cut },
          "13-14": { "100_FR_SCY": cut },
        },
      },
    },
  },
});

let browser;
let page;
const errors = [];
const myTimesRequests = [];
const timesParams = (url) => {
  const { pathname, searchParams } = new URL(url);
  return pathname === "/api/times" ? searchParams : null;
};
try {
  const seeded = await admin.rpc("collect_records", { reads: [], writes });
  assert.ifError(seeded.error);
  console.log("Seeded isolated My Times browser fixtures.");
  assert.ifError(
    (
      await admin
        .from("account_followed_athletes")
        .delete()
        .eq("user_id", user.id)
    ).error,
  );
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.route("**/*.supabase.co/**", (route) => {
    errors.push("Refused a hosted Supabase request");
    return route.abort();
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const params = timesParams(request.url());
    if (["my_times", "my_times_bests"].includes(params?.get("view"))) {
      myTimesRequests.push({ params, sentAt: Date.now() });
    }
  });
  await page.goto(base + "/login");
  await page.getByRole("button", { name: /password instead/i }).click();
  await page.locator("input[type=email]").fill(email);
  await page.locator("input[type=password]").fill("Velocity-local-test-2026!");
  await page.locator("button[type=submit]").click();
  await page.waitForURL(base + "/tools");

  const myTimesUrl = base + "/tools/times?view=my-times";
  const myTimes = page.getByRole("region", { name: "Times", exact: true });
  const card = (event) =>
    myTimes.getByRole("button", {
      name: `View ${event} rankings`,
      exact: true,
    });
  const freestyle = () => card("100 Freestyle");
  const showTime = async (time) => {
    await freestyle().locator("strong").filter({ hasText: time }).waitFor();
  };
  const athleteChips = myTimes.getByRole("group", {
    name: "Athlete",
    exact: true,
  });
  const legend = myTimes.getByRole("complementary", {
    name: "USA Swimming motivational ranks",
  });
  const checkCollectedRanks = async (tier) => {
    for (const item of await legend.locator("li").all()) {
      const rankTier = await item.locator("strong").innerText();
      const metric = item.locator(":scope > span").first();
      assert.equal(await metric.innerText(), rankTier === tier ? "1" : "0");
      const metricBox = await metric.boundingBox();
      const iconBox = await item.locator("img").boundingBox();
      assert.ok(metricBox && iconBox);
      assert.ok(
        metricBox.x + metricBox.width <= iconBox.x,
        `${rankTier} count appears to the left of its icon`,
      );
    }
  };
  const checkLayout = async () => {
    const overflowingCards = await myTimes
      .getByRole("button", { name: / rankings$/ })
      .evaluateAll((cards) =>
        cards.flatMap((card) => {
          const bounds = card.getBoundingClientRect();
          return [...card.querySelectorAll("*:not(.sr-only)")]
            .filter((child) => {
              const box = child.getBoundingClientRect();
              return (
                box.left < bounds.left - 1 ||
                box.right > bounds.right + 1 ||
                box.top < bounds.top - 1 ||
                box.bottom > bounds.bottom + 1
              );
            })
            .map(
              (child) => `${card.getAttribute("aria-label")}: ${child.tagName}`,
            );
        }),
      );
    assert.deepEqual(
      overflowingCards,
      [],
      "Card labels, times, dates, icons, and season ranks stay inside each card",
    );
    const overlappingRanks = await myTimes
      .getByRole("complementary", { name: "USA Swimming motivational ranks" })
      .locator("li")
      .evaluateAll((items) =>
        items.flatMap((item, index) => {
          const box = item.getBoundingClientRect();
          return items
            .slice(index + 1)
            .filter((other) => {
              const next = other.getBoundingClientRect();
              return (
                Math.min(box.right, next.right) -
                  Math.max(box.left, next.left) >
                  1 &&
                Math.min(box.bottom, next.bottom) -
                  Math.max(box.top, next.top) >
                  1
              );
            })
            .map((other) => `${item.textContent} / ${other.textContent}`);
        }),
      );
    assert.deepEqual(
      overlappingRanks,
      [],
      "Rank legend entries remain separate at each viewport size",
    );
  };
  const chooseAthlete = async (athlete) => {
    const chip = athleteChips.getByRole("button", {
      name: new RegExp(athlete.name),
    });
    await chip.click();
    assert.equal(await chip.getAttribute("aria-pressed"), "true");
  };
  const chooseAge = async (age) => {
    const slider = myTimes.getByRole("slider", {
      name: "Age at swim",
      exact: true,
    });
    await slider.focus();
    await slider.press("Home");
    const max = Number(await slider.getAttribute("max"));
    for (let index = 0; index <= max; index++) {
      if ((await slider.getAttribute("aria-valuetext")) === `${age}`) return;
      await slider.press("ArrowRight");
    }
    assert.fail(`Age ${age} is missing from the age-at-swim slider`);
  };
  const selected = async () => {
    const result = await admin
      .from("account_followed_athletes")
      .select("athlete_id, is_primary")
      .eq("user_id", user.id)
      .order("athlete_id");
    assert.ifError(result.error);
    return result.data;
  };
  await page.goto(myTimesUrl);
  await myTimes.waitFor();
  await myTimes.locator('a[href="/tools"]').waitFor();
  assert.match(await myTimes.innerText(), /primary|favorite/i);
  assert.equal(
    await myTimes.getByRole("button", { name: / rankings$/ }).count(),
    0,
  );

  // Save through Account, then consume the same persisted choices in My Times.
  await page.goto(base + "/tools");
  const following = page.getByRole("region", {
    name: "Athlete following",
    exact: true,
  });
  await following
    .getByLabel("Search for a primary athlete", { exact: true })
    .fill(athletes[0].name);
  await following
    .getByRole("button", {
      name: `Select ${athletes[0].name} as primary athlete`,
      exact: true,
    })
    .click();
  for (const athlete of athletes.slice(1, 3)) {
    await following
      .getByLabel("Search for favorite athletes", { exact: true })
      .fill(athlete.name);
    await following
      .getByRole("button", {
        name: `Add ${athlete.name} to favorite athletes`,
        exact: true,
      })
      .click();
  }
  await following
    .getByRole("button", { name: "Save athletes", exact: true })
    .click();
  await following
    .getByRole("status")
    .filter({ hasText: "Athletes saved" })
    .waitFor();
  const saved = await selected();
  assert.equal(saved.length, 3);
  assert.equal(saved.find((row) => row.is_primary)?.athlete_id, athletes[0].id);

  await page.goto(myTimesUrl);
  await showTime("35.20");
  assert.match(await myTimes.innerText(), new RegExp(athletes[0].name));
  assert.equal(
    await myTimes.getByRole("heading", { name: "Times", exact: true }).count(),
    0,
  );
  assert.equal(
    await myTimes.getByRole("heading", { name: athletes[0].name }).count(),
    0,
  );
  assert.equal(await athleteChips.getByRole("button").count(), 3);
  assert.equal(
    await athleteChips
      .getByRole("button", { name: new RegExp(athletes[0].name) })
      .getAttribute("aria-pressed"),
    "true",
  );
  const manageAthletes = myTimes
    .getByRole("region", { name: "Times filters", exact: true })
    .getByRole("link", { name: /manage athletes/i });
  assert.ok(await manageAthletes.isVisible());
  assert.equal(await manageAthletes.getAttribute("href"), "/tools");
  await legend.waitFor();
  assert.equal(await legend.locator("li").count(), 6);
  assert.equal(
    await legend.getByText("Motivational ranks", { exact: true }).count(),
    0,
  );
  for (const [tier, rank] of [
    ["B", "Bronze"],
    ["BB", "Silver"],
    ["A", "Gold"],
    ["AA", "Platinum"],
    ["AAA", "Diamond"],
    ["AAAA", "Elite"],
  ]) {
    assert.ok(await legend.getByText(rank, { exact: false }).isVisible());
    assert.ok(await legend.getByText(tier, { exact: true }).isVisible());
  }
  await freestyle().locator('img[src^="/assets/ranks/"]').waitFor();
  assert.match(
    await freestyle().innerText(),
    new RegExp(`6/15/${previousYear.slice(-2)}\\s*\\(11–12\\)`),
  );
  assert.equal(await freestyle().getAttribute("data-rank"), "AAA");
  await checkCollectedRanks("AAA");
  assert.equal(
    await freestyle().evaluate((card) =>
      getComputedStyle(card).getPropertyValue("--rank-color").trim(),
    ),
    "#4B74D2",
  );
  assert.notEqual(
    await freestyle().evaluate(
      (card) => getComputedStyle(card).backgroundColor,
    ),
    await card("100 Backstroke").evaluate(
      (card) => getComputedStyle(card).backgroundColor,
    ),
  );
  assert.equal(
    await card("100 Backstroke").locator('img[src^="/assets/ranks/"]').count(),
    0,
  );

  const response = await page.request.get(
    base +
      "/api/times?view=my_times&athleteId=" +
      athletes[0].id +
      "&course=SCY&rankPeriod=all",
  );
  assert.equal(response.status(), 200);
  const summary = (await response.json()).myTimes;
  const event = summary.events.find((item) => item.event === "100_FR");
  assert.equal(summary.period, "all");
  assert.ok(event?.allTimeRank >= 3);
  assert.equal(event.race.id, prefix + "primary-old");
  assert.equal(event.rankRace.id, prefix + "primary-preseason");
  assert.equal(event.rankAgeGroup, "13-14");
  assert.equal(event.rankGender, "F");
  assert.match(
    await freestyle().innerText(),
    new RegExp(`Rank ${event.allTimeRank}\\b`),
  );
  const toggle = myTimes.getByRole("button", {
    name: "Time filters",
    exact: true,
  });
  const beforeCollapse = page.url();
  await toggle.focus();
  await toggle.press("Enter");
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  assert.equal(await athleteChips.isVisible(), false);
  assert.equal(await manageAthletes.isVisible(), false);
  const closedFilterStyle = await toggle.evaluate((button) => {
    const panel = getComputedStyle(button.closest("section"));
    return {
      headingBorder: getComputedStyle(button.parentElement).borderBottomWidth,
      bottomLeftRadius: Number.parseFloat(panel.borderBottomLeftRadius),
      bottomRightRadius: Number.parseFloat(panel.borderBottomRightRadius),
    };
  });
  assert.equal(closedFilterStyle.headingBorder, "0px");
  assert.ok(closedFilterStyle.bottomLeftRadius > 0);
  assert.ok(closedFilterStyle.bottomRightRadius > 0);
  assert.equal(await freestyle().isVisible(), true);
  assert.equal(page.url(), beforeCollapse);
  await toggle.press("Space");
  assert.equal(await toggle.getAttribute("aria-expanded"), "true");
  assert.equal(await athleteChips.isVisible(), true);

  await page.reload();
  await showTime("35.20");
  assert.deepEqual(await selected(), saved);
  await chooseAthlete(athletes[1]);
  await showTime("47.80");
  await checkCollectedRanks("AA");
  await page.reload();
  await showTime("47.80");
  assert.deepEqual(
    await selected(),
    saved,
    "Viewing a favorite preserves primary/favorite selections",
  );
  await chooseAthlete(athletes[2]);
  await myTimes.getByText(/no .*times|no .*results|no .*swims/i).waitFor();
  await checkCollectedRanks(null);
  const [overviewResponse] = await Promise.all([
    page.waitForResponse((result) => {
      const params = timesParams(result.url());
      return params?.get("view") === "my_times" &&
        params.get("athleteId") === athletes[0].id && result.ok();
    }),
    page.goto(myTimesUrl),
  ]);
  await showTime("35.20");
  const { expiresAt: overviewExpires } = await overviewResponse.json();
  const filterRequestsStart = myTimesRequests.length;

  const filters = myTimes.getByRole("group", {
    name: "Best times from",
    exact: true,
  });
  await filters.getByRole("button", { name: "Age", exact: true }).click();
  await chooseAge(12);
  await showTime("39.40");
  assert.match(
    await freestyle().innerText(),
    new RegExp(`Rank ${event.allTimeRank}\\b`),
    "Age filtering preserves the all-time rank",
  );
  await chooseAge(13);
  await showTime("45.00");
  await checkCollectedRanks("AA");
  await filters
    .getByRole("button", { name: "Year range", exact: true })
    .click();
  await myTimes
    .getByLabel("Start year", { exact: true })
    .selectOption(previousYear);
  await myTimes
    .getByLabel("End year", { exact: true })
    .selectOption(previousYear);
  await showTime("35.20");
  await myTimes
    .getByLabel("End year", { exact: true })
    .selectOption(recentYear);
  await myTimes
    .getByLabel("Start year", { exact: true })
    .selectOption(recentYear);
  await showTime("39.40");
  assert.match(
    await freestyle().innerText(),
    new RegExp(`Rank ${event.allTimeRank}\\b`),
    "Year filtering preserves the all-time rank",
  );
  await filters.getByRole("button", { name: "All time", exact: true }).click();
  await showTime("35.20");
  const filterRequests = myTimesRequests.slice(filterRequestsStart);
  assert.ok(filterRequests.some(({ params }) =>
    params.get("view") === "my_times_bests" && params.get("ageAtSwim") === "12",
  ), "The age filter uses the personal-bests endpoint");
  assert.ok(filterRequests.some(({ params }) =>
    params.get("view") === "my_times_bests" &&
    params.get("startYear") === recentYear && params.get("endYear") === recentYear,
  ), "The year-range filter uses the personal-bests endpoint");
  assert.ok(filterRequests.every(({ params, sentAt }) =>
    params.get("view") === "my_times_bests" ||
    (sentAt >= overviewExpires &&
      !["ageAtSwim", "startYear", "endYear"].some((key) => params.has(key))),
  ), "Changing personal-best filters keeps the current rank until its scheduled refresh");
  const courses = myTimes.getByRole("group", { name: "Course", exact: true });
  await courses.getByRole("button", { name: "LCM", exact: true }).click();
  await card("50 Freestyle")
    .locator("strong")
    .filter({ hasText: "32.50" })
    .waitFor();
  assert.equal(await freestyle().count(), 0);
  const staleBestsUrl = new URL("/api/times", base);
  staleBestsUrl.search = new URLSearchParams({
    view: "my_times_bests",
    athleteId: athletes[0].id,
    course: "LCM",
    ageAtSwim: "13",
  }).toString();
  const staleResponse = await page.request.get(staleBestsUrl.href);
  assert.equal(staleResponse.status(), 200);
  const staleBests = await staleResponse.json();
  assert.deepEqual(staleBests.personalBests.map(({ race }) => race.id), [
    prefix + "primary-lcm",
  ]);
  const isStaleBests = (url) => {
    const params = timesParams(url);
    return params?.get("view") === "my_times_bests" &&
      params.get("athleteId") === athletes[0].id &&
      params.get("course") === "LCM" && params.get("ageAtSwim") === "13";
  };
  const intercepted = Promise.withResolvers();
  const holdBests = (route) => intercepted.resolve(route);
  await page.route(isStaleBests, holdBests);
  try {
    const [staleRequest] = await Promise.all([
      page.waitForRequest((request) => isStaleBests(request.url())),
      filters.getByRole("button", { name: "Age", exact: true }).click(),
    ]);
    const route = await intercepted.promise;
    await chooseAthlete(athletes[1]);
    await courses.getByRole("button", { name: "SCY", exact: true }).click();
    await showTime("47.80");
    try {
      await route.fulfill({ json: staleBests });
    } catch (error) {
      if (!staleRequest.failure()) throw error;
    }
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    assert.match(await freestyle().innerText(), /47\.80/);
    assert.equal(await card("50 Freestyle").count(), 0);
  } finally {
    await page.unroute(isStaleBests, holdBests);
  }
  await chooseAthlete(athletes[0]);
  await showTime("35.20");

  await checkLayout();
  await page.screenshot({
    path: "/tmp/velocity-my-times-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await checkLayout();
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  await page.screenshot({
    path: "/tmp/velocity-my-times-mobile-collapsed.png",
    fullPage: true,
    animations: "disabled",
  });
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-expanded"), "true");
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Times fits the mobile viewport",
  );
  await page.screenshot({
    path: "/tmp/velocity-my-times-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await checkLayout();
  await page.screenshot({
    path: "/tmp/velocity-my-times-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.evaluate(() => {
    delete document.documentElement.dataset.theme;
  });

  await freestyle().click();
  await page.waitForURL((url) => url.searchParams.get("view") !== "my-times");
  const rankingFilters = JSON.parse(
    new URL(page.url()).searchParams.get("filters"),
  );
  assert.equal(rankingFilters.event, "100_FR");
  assert.equal(rankingFilters.course, "SCY");
  assert.deepEqual(rankingFilters.genders, ["F"]);
  assert.deepEqual(rankingFilters.ageGroups, ["13-14"]);
  assert.equal(rankingFilters.year, "");
  assert.equal(rankingFilters.startDate, "");
  assert.equal(rankingFilters.endDate, "");
  assert.equal(
    await page
      .getByRole("button", { name: "Clear date range", exact: true })
      .count(),
    0,
  );
  const row = page.getByRole("row").filter({ hasText: athletes[0].name });
  await row
    .getByRole("button", {
      name: `Analyze 45.00 by ${athletes[0].name}`,
      exact: true,
    })
    .waitFor();
  const rankIcon = row.getByRole("button", {
    name: /rank: .* motivational standard$/,
  });
  await rankIcon.waitFor();
  const rankingLegend = page.getByRole("complementary", {
    name: "USA Swimming motivational ranks",
  });
  const cutoffTimes = [
    "1:20.00",
    "1:10.00",
    "1:00.00",
    "50.00",
    "40.00",
    "30.00",
  ];
  assert.equal(await rankingLegend.locator("li").count(), cutoffTimes.length);
  for (const [index, item] of (
    await rankingLegend.locator("li").all()
  ).entries()) {
    const metric = item.locator(":scope > span").first();
    assert.equal(await metric.innerText(), cutoffTimes[index]);
    const metricBox = await metric.boundingBox();
    const iconBox = await item.locator("img").boundingBox();
    assert.ok(metricBox && iconBox);
    assert.ok(
      metricBox.x + metricBox.width <= iconBox.x,
      "Event rank cutoff appears to the left of its icon",
    );
  }
  const searchBackground = await page
    .getByRole("searchbox", { name: "Search athletes", exact: true })
    .evaluate(
      (input) =>
        getComputedStyle(input.parentElement.parentElement).backgroundColor,
    );
  const filtersBackground = await page
    .getByRole("group", { name: "Gender", exact: true })
    .evaluate(
      (group) =>
        getComputedStyle(group.closest('[class*="filters"]')).backgroundColor,
    );
  assert.equal(
    searchBackground,
    filtersBackground,
    "Rankings athlete search matches the filter background",
  );
  assert.equal(await rankIcon.locator('img[src^="/assets/ranks/"]').count(), 1);
  const timeBox = await row
    .getByRole("button", { name: /^Analyze / })
    .boundingBox();
  const iconBox = await rankIcon.locator("img").boundingBox();
  assert.ok(timeBox && iconBox);
  assert.ok(
    Math.abs(timeBox.y + timeBox.height / 2 - iconBox.y - iconBox.height / 2) <
      1,
    "The motivational rank icon is vertically centered with the time",
  );
  assert.equal(
    await rankIcon.innerText(),
    "",
    "The motivational time chip is replaced by its rank icon",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Verified My Times athlete selections, isolated personal-best requests, stale responses after athlete/course changes, rank counts, ranking links, and desktop/mobile/dark layouts.",
  );
} catch (error) {
  if (page && !page.isClosed()) {
    await page
      .screenshot({
        path: "/tmp/velocity-my-times-failure.png",
        fullPage: true,
      })
      .catch(() => {});
    console.error(
      await page
        .getByRole("main")
        .ariaSnapshot()
        .catch(() => "Page unavailable"),
    );
  }
  throw error;
} finally {
  await browser?.close();
  try {
    assert.ifError(
      (
        await admin
          .from("account_followed_athletes")
          .delete()
          .eq("user_id", user.id)
      ).error,
    );
    if (original.data.length) {
      assert.ifError(
        (await admin.from("account_followed_athletes").insert(original.data))
          .error,
      );
    }
  } finally {
    const people = await admin
      .from("athletes")
      .select("person_id")
      .in(
        "id",
        athletes.map(({ id }) => id),
      );
    assert.ifError(people.error);
    const cleaned = await admin.rpc("collect_records", {
      reads: [],
      writes: [
        ...writes
          .toReversed()
          .map((write) => ({ path: write.path, after: null })),
        ...people.data.map(({ person_id }) => ({
          path: `people/${person_id}`,
          after: null,
        })),
      ],
    });
    assert.ifError(cleaned.error);
  }
}
