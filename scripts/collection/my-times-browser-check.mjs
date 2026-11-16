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
const athletes = ["Avery", "Blake", "Casey", "Dana"].map((first, index) => ({
  id: `${prefix}${index}`,
  name: `${first} Mytimescheck`,
  first,
}));
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
swim("primary-season", 0, 45600, today, 13);
swim("primary-back", 0, 200000, today, 13, { eventCode: "100_BK_SCY" });
swim("primary-lcm", 0, 32500, today, 13, {
  eventCode: "50_FR_LCM",
  course: "LCM",
});
swim("favorite", 1, 47800, today, 13);
swim("faster-teammate", 3, 44100, today, 13);
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
  await page.goto(base + "/login");
  await page.getByRole("button", { name: /password instead/i }).click();
  await page.locator("input[type=email]").fill(email);
  await page.locator("input[type=password]").fill("Velocity-local-test-2026!");
  await page.locator("button[type=submit]").click();
  await page.waitForURL(base + "/tools");

  const myTimesUrl = base + "/tools/times?view=my-times";
  const myTimes = page.getByRole("region", { name: "My Times", exact: true });
  const card = (event) =>
    myTimes.getByRole("button", {
      name: `View ${event} season rankings`,
      exact: true,
    });
  const freestyle = () => card("100 Freestyle");
  const showTime = async (time) => {
    await freestyle().locator("strong").filter({ hasText: time }).waitFor();
  };
  const checkLayout = async () => {
    const overflowingCards = await myTimes
      .getByRole("button", { name: /season rankings$/ })
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
    await myTimes.getByRole("button", { name: "Athlete", exact: true }).click();
    await myTimes
      .getByRole("dialog", { name: "Athlete", exact: true })
      .getByRole("button", { name: new RegExp(athlete.name) })
      .click();
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
    await myTimes.getByRole("button", { name: /season rankings/ }).count(),
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
  const legend = myTimes.getByRole("complementary", {
    name: "USA Swimming motivational ranks",
  });
  await legend.waitFor();
  assert.equal(await legend.locator("li").count(), 6);
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
  assert.equal(
    await card("100 Backstroke").locator('img[src^="/assets/ranks/"]').count(),
    0,
  );

  const response = await page.request.get(
    base +
      "/api/times?view=my_times&athleteId=" +
      athletes[0].id +
      "&course=SCY",
  );
  assert.equal(response.status(), 200);
  const summary = (await response.json()).myTimes;
  const event = summary.events.find((item) => item.event === "100_FR");
  assert.ok(event?.seasonRank >= 2);
  assert.equal(event.race.id, prefix + "primary-old");
  assert.equal(event.seasonRace.id, prefix + "primary-season");
  assert.equal(event.rankAgeGroup, "13-14");
  assert.equal(event.rankGender, "F");
  assert.match(
    await freestyle().innerText(),
    new RegExp(`#${event.seasonRank}\\b`),
  );

  await page.reload();
  await showTime("35.20");
  assert.deepEqual(await selected(), saved);
  await chooseAthlete(athletes[1]);
  await showTime("47.80");
  await page.reload();
  await showTime("47.80");
  assert.deepEqual(
    await selected(),
    saved,
    "Viewing a favorite preserves primary/favorite selections",
  );
  await chooseAthlete(athletes[2]);
  await myTimes.getByText(/no .*times|no .*results|no .*swims/i).waitFor();
  await page.goto(myTimesUrl);
  await showTime("35.20");

  const filters = myTimes.getByRole("group", {
    name: "Best times from",
    exact: true,
  });
  await filters.getByRole("button", { name: "Age", exact: true }).click();
  await chooseAge(12);
  await showTime("39.40");
  assert.match(
    await freestyle().innerText(),
    new RegExp(`#${event.seasonRank}\\b`),
    "Age filtering preserves the current-season rank",
  );
  await chooseAge(13);
  await showTime("45.60");
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
    new RegExp(`#${event.seasonRank}\\b`),
    "Year filtering preserves the current-season rank",
  );
  await filters.getByRole("button", { name: "All time", exact: true }).click();
  await showTime("35.20");
  const courses = myTimes.getByRole("group", { name: "Course", exact: true });
  await courses.getByRole("button", { name: "LCM", exact: true }).click();
  await card("50 Freestyle")
    .locator("strong")
    .filter({ hasText: "32.50" })
    .waitFor();
  assert.equal(await freestyle().count(), 0);
  await courses.getByRole("button", { name: "SCY", exact: true }).click();
  await showTime("35.20");

  await checkLayout();
  await page.screenshot({
    path: "/tmp/velocity-my-times-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await checkLayout();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "My Times fits the mobile viewport",
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
  assert.equal(rankingFilters.startDate, summary.seasonStart);
  assert.equal(rankingFilters.endDate, summary.seasonEnd);
  const row = page.getByRole("row").filter({ hasText: athletes[0].name });
  await row
    .getByRole("button", {
      name: `Analyze 45.60 by ${athletes[0].name}`,
      exact: true,
    })
    .waitFor();
  const rankIcon = row.getByRole("button", {
    name: /rank: .* motivational standard$/,
  });
  await rankIcon.waitFor();
  assert.equal(await rankIcon.locator('img[src^="/assets/ranks/"]').count(), 1);
  assert.equal(
    await rankIcon.innerText(),
    "",
    "The motivational time chip is replaced by its rank icon",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Verified My Times account choices, primary default, favorites and reload, empty states, age/year/course filters, separate current-season ranks, six-rank legend, exact season/gender/age ranking links, motivational icons, and desktop/mobile/dark layouts.",
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
