import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright";

const base = process.env.MY_TIMES_TEST_URL ?? "http://127.0.0.1:3001";
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(base).hostname),
  "My Times browser checks only run against a local frontend.",
);
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
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  ),
);
assert.ok(
  ["127.0.0.1", "localhost"].includes(new URL(config.API_URL).hostname),
  "My Times fixtures require local Supabase.",
);
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
const athletes = ["Avery", "Blake", "Casey", "Dana", "Elliot", "Finley"].map(
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
swim("primary-25-old", 0, 18000, `${previousYear}-01-15`, 9, {
  eventCode: "25_FR_SCY",
});
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
swim("young-25", 5, 15000, today, 10, { eventCode: "25_FR_SCY" });
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
  if (process.env.MY_TIMES_TEST_AUTH === "admin-link") {
    // Local existing fixture accounts may have another password. Generate the
    // link without sending email, then let SSR create valid session cookies.
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
    const verified = await auth.auth.verifyOtp({
      token_hash: link.data.properties.hashed_token,
      type: "magiclink",
    });
    assert.ifError(verified.error);
    await context.addCookies(
      [...jar.values()]
        .filter((cookie) => cookie.value)
        .map(({ name, value }) => ({
          name,
          value,
          url: base,
          sameSite: "Lax",
        })),
    );
    await page.goto(base + "/tools");
  } else {
    await page.goto(base + "/login");
    await page.getByRole("button", { name: /password instead/i }).click();
    await page.locator("input[type=email]").fill(email);
    await page
      .locator("input[type=password]")
      .fill("Velocity-local-test-2026!");
    await page.locator("button[type=submit]").click();
    await page.waitForURL(base + "/tools");
  }

  const myTimesUrl = base + "/tools/my-times";
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
  const trigger = (label) =>
    myTimes.getByRole("button", { name: new RegExp(`^${label}:`) });
  const openDropdown = async (label) => {
    await trigger(label).focus();
    await trigger(label).press("ArrowDown");
    const options = myTimes.getByRole("group", {
      name: `${label} options`,
      exact: true,
    });
    await options.waitFor();
    return options;
  };
  const chooseOption = async (label, option) => {
    const options = await openDropdown(label);
    await options.getByRole("button", { name: option, exact: true }).click();
  };
  const legend = myTimes.getByRole("complementary", {
    name: "USA Swimming motivational ranks",
  });
  const displayToggle = (name) =>
    myTimes.getByRole("switch", { name, exact: true });
  const assertCardDescriptions = async () => {
    const missing = await myTimes
      .getByRole("button", { name: / rankings$/ })
      .evaluateAll((cards) =>
        cards.flatMap((card) =>
          (card.getAttribute("aria-describedby") ?? "")
            .split(/\s+/)
            .filter((id) => id && !document.getElementById(id)),
        ),
      );
    assert.deepEqual(
      missing,
      [],
      "Visible cards describe only rendered content",
    );
  };
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
    const offCenterToggleRows = await myTimes
      .getByRole("group", { name: "Times display options", exact: true })
      .evaluate((group) => {
        const bounds = group.getBoundingClientRect();
        const rows = new Map();
        for (const label of group.querySelectorAll("label")) {
          const box = label.getBoundingClientRect();
          const key = Math.round(box.top);
          const row = rows.get(key) ?? { left: box.left, right: box.right };
          row.left = Math.min(row.left, box.left);
          row.right = Math.max(row.right, box.right);
          rows.set(key, row);
        }
        const center = (bounds.left + bounds.right) / 2;
        return [...rows.values()].filter(
          (row) => Math.abs((row.left + row.right) / 2 - center) > 1,
        );
      });
    assert.deepEqual(
      offCenterToggleRows,
      [],
      "Display toggles stay centered, including wrapped rows",
    );
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
    await chooseOption("Athlete", athlete.name);
    await trigger("Athlete").getByText(athlete.name, { exact: true }).waitFor();
  };
  const chooseAge = async (age) => chooseOption("Age Range", age);
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
    name: "Athlete Tracking",
    exact: true,
  });
  await following
    .getByRole("button", { name: "Add primary athlete", exact: true })
    .click();
  await following
    .getByLabel("Search for a primary athlete", { exact: true })
    .fill(athletes[0].name);
  await following
    .getByRole("button", {
      name: `Select ${athletes[0].name} as primary athlete`,
      exact: true,
    })
    .click();
  await following
    .getByRole("status")
    .filter({ hasText: "Athletes saved" })
    .waitFor();
  for (const athlete of [athletes[1], athletes[2], athletes[5]]) {
    await following
      .getByRole("button", { name: "Add favorite athlete", exact: true })
      .click();
    await following
      .getByLabel("Search for favorite athletes", { exact: true })
      .fill(athlete.name);
    await following
      .getByRole("button", {
        name: `Add ${athlete.name} to favorite athletes`,
        exact: true,
      })
      .click();
    await following
      .getByRole("status")
      .filter({ hasText: "Athletes saved" })
      .waitFor();
  }
  const saved = await selected();
  assert.equal(saved.length, 4);
  assert.equal(saved.find((row) => row.is_primary)?.athlete_id, athletes[0].id);

  await following
    .getByRole("link")
    .filter({ hasText: athletes[1].name })
    .click();
  await page.waitForURL(
    (url) =>
      url.pathname === "/tools/my-times" &&
      url.searchParams.get("myAthlete") === athletes[1].id,
  );
  await showTime("47.80");
  assert.deepEqual(
    await selected(),
    saved,
    "Following a chip preserves account selections",
  );
  await page.goBack();
  await following.waitFor();
  await following
    .getByRole("link")
    .filter({ hasText: athletes[0].name })
    .click();
  await page.waitForURL(
    (url) =>
      url.pathname === "/tools/my-times" &&
      url.searchParams.get("myAthlete") === athletes[0].id,
  );
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
  assert.equal(await trigger("Athlete").getAttribute("aria-expanded"), "false");
  await trigger("Athlete").hover();
  const athleteOptions = myTimes.getByRole("group", {
    name: "Athlete options",
    exact: true,
  });
  await athleteOptions.waitFor();
  assert.equal(await athleteOptions.getByRole("button").count(), 4);
  const manageAthletes = athleteOptions.getByRole("link", {
    name: /manage athletes/i,
  });
  assert.ok(await manageAthletes.isVisible());
  assert.equal(await manageAthletes.getAttribute("href"), "/tools");
  await trigger("Athlete").press("Escape");
  await athleteOptions.waitFor({ state: "hidden" });
  assert.match(await trigger("Course").innerText(), /Short Course Yards/);
  assert.equal(
    await myTimes
      .getByRole("button", { name: "Time filters", exact: true })
      .count(),
    0,
  );
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

  const getSummary = async (input = {}, athlete = athletes[0]) => {
    const params = new URLSearchParams({
      view: "my_times",
      athleteId: athlete.id,
      course: "SCY",
      rankPeriod: "all",
      ...input,
    });
    const response = await page.request.get(`${base}/api/times?${params}`);
    assert.equal(response.status(), 200);
    const { myTimes: summary } = await response.json();
    assert.equal(summary.period, "all");
    return summary;
  };
  const getEvent = async (input = {}) =>
    (await getSummary(input)).events.find((item) => item.event === "100_FR");
  const assertDisplayedRank = async (input, raceId, group) => {
    const event = await getEvent(input);
    assert.equal(event.race.id, prefix + raceId);
    assert.equal(event.rankRace.id, event.race.id);
    assert.equal(event.rankAgeGroup, group);
    assert.equal(event.rankGender, "F");
    assert.ok(event.allTimeRank >= 1);
    assert.match(
      await freestyle().innerText(),
      new RegExp(`Rank ${event.allTimeRank}\\b`),
    );
    assert.match(
      await freestyle().innerText(),
      new RegExp(group.replace("-", "–")),
    );
    return event;
  };
  await assertDisplayedRank({}, "primary-old", "11-12");
  const olderSummary = await getSummary();
  assert.equal(olderSummary.latestAge, 13);
  assert.equal(
    olderSummary.events.find((event) => event.event === "25_FR")?.race
      ?.ageAtSwim,
    9,
  );
  assert.equal(
    await card("25 Freestyle").count(),
    0,
    "Athletes over 10 hide their historical 25-yard swims",
  );
  assert.equal(await displayToggle("Show 25s").isChecked(), false);
  assert.equal(await displayToggle("Show team ranks").isChecked(), true);
  assert.equal(await displayToggle("Show rank icon").isChecked(), true);
  const beforeDisplayChanges = myTimesRequests.length;
  await displayToggle("Show 25s").check();
  await card("25 Freestyle")
    .locator("strong")
    .filter({ hasText: "18.00" })
    .waitFor();
  await displayToggle("Show team ranks").uncheck();
  await legend.waitFor();
  assert.doesNotMatch(await freestyle().innerText(), /\bRank \d+/);
  assert.equal(
    await myTimes
      .getByText("All-time team ranks · each swim’s age group", { exact: true })
      .count(),
    0,
    "Turning team ranks off also removes their summary",
  );
  assert.equal(
    await freestyle().locator('img[src^="/assets/ranks/"]').count(),
    1,
    "Rank icons have a separate visibility preference",
  );
  await assertCardDescriptions();
  await displayToggle("Show rank icon").uncheck();
  await legend.waitFor({ state: "hidden" });
  assert.equal(
    await freestyle().locator('img[src^="/assets/ranks/"]').count(),
    0,
  );
  await assertCardDescriptions();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  assert.equal(
    myTimesRequests.length,
    beforeDisplayChanges,
    "Display toggles reuse the loaded times without a database query",
  );
  await page.reload();
  await showTime("35.20");
  assert.equal(await displayToggle("Show 25s").isChecked(), true);
  assert.equal(await displayToggle("Show team ranks").isChecked(), false);
  assert.equal(await displayToggle("Show rank icon").isChecked(), false);
  await card("25 Freestyle").waitFor();
  assert.equal(await legend.count(), 0);
  assert.doesNotMatch(await freestyle().innerText(), /\bRank \d+/);
  assert.equal(
    await freestyle().locator('img[src^="/assets/ranks/"]').count(),
    0,
  );
  await assertCardDescriptions();
  await displayToggle("Show team ranks").check();
  assert.equal(
    await legend.count(),
    0,
    "Team ranks do not show the ranks bar while rank icons are hidden",
  );
  assert.match(await freestyle().innerText(), /\bRank \d+/);
  assert.equal(
    await freestyle().locator('img[src^="/assets/ranks/"]').count(),
    0,
  );
  await displayToggle("Show rank icon").check();
  await legend.waitFor();
  await freestyle().locator('img[src^="/assets/ranks/"]').waitFor();
  await displayToggle("Show 25s").uncheck();
  assert.equal(await card("25 Freestyle").count(), 0);
  await assertCardDescriptions();
  // Return to the age-aware default before checking the younger athlete.
  await page.goto(myTimesUrl);
  await showTime("35.20");
  const time = freestyle().locator("strong");
  const dateLabel = freestyle().locator("time").locator("..");
  const iconSlot = freestyle().locator(":scope > span").nth(2);
  const blankIconSlot = card("100 Backstroke").locator(":scope > span").nth(2);
  const [dateBox, timeBox, iconBox, blankBox] = await Promise.all([
    dateLabel.boundingBox(),
    time.boundingBox(),
    iconSlot.boundingBox(),
    blankIconSlot.boundingBox(),
  ]);
  assert.ok(dateBox.y + dateBox.height <= iconBox.y);
  assert.ok(iconBox.y + iconBox.height <= timeBox.y);
  assert.equal(
    iconBox.height,
    blankBox.height,
    "Unranked cards retain the rank icon's space",
  );
  assert.ok(iconBox.height >= 28 && iconBox.height <= 31);

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
    "Viewing favorites preserves account selections",
  );
  await chooseAthlete(athletes[2]);
  await myTimes.getByText(/no .*times|no .*results|no .*swims/i).waitFor();
  await checkCollectedRanks(null);
  await chooseAthlete(athletes[5]);
  await card("25 Freestyle")
    .locator("strong")
    .filter({ hasText: "15.00" })
    .waitFor();
  const youngSummary = await getSummary({}, athletes[5]);
  assert.equal(youngSummary.latestAge, 10);
  assert.equal(
    youngSummary.events.find((event) => event.event === "25_FR")?.rankAgeGroup,
    "9-10",
  );
  assert.ok(
    youngSummary.events.find((event) => event.event === "25_FR")?.allTimeRank >=
      1,
  );
  assert.equal(await displayToggle("Show 25s").isChecked(), true);
  await displayToggle("Show 25s").uncheck();
  assert.equal(
    await card("25 Freestyle").count(),
    0,
    "The 25s toggle can hide events for younger athletes too",
  );
  await displayToggle("Show 25s").check();
  await card("25 Freestyle").waitFor();
  await page.screenshot({
    path: "/tmp/velocity-my-times-young-25.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("my25s");
    window.history.replaceState(null, "", url);
  });
  await chooseAthlete(athletes[0]);
  await showTime("35.20");
  const filterRequestsStart = myTimesRequests.length;
  await chooseOption("Best times from", "Age Range");
  const ageOptions = await openDropdown("Age Range");
  assert.deepEqual(await ageOptions.getByRole("button").allTextContents(), [
    "8 & under",
    "9–10",
    "11–12",
    "13–14",
    "15–16",
    "17–18",
    "19 & over",
  ]);
  await ageOptions.getByRole("button", { name: "13–14", exact: true }).click();
  await showTime("45.00");
  await assertDisplayedRank(
    { ageGroup: "13-14" },
    "primary-preseason",
    "13-14",
  );
  await checkCollectedRanks("AA");
  await chooseAge("11–12");
  await showTime("35.20");
  await assertDisplayedRank({ ageGroup: "11-12" }, "primary-old", "11-12");
  await chooseAge("9–10");
  await myTimes
    .getByRole("status")
    .filter({
      hasText: /No eligible individual times|No times match these filters/,
    })
    .waitFor();
  const youngerAgeSummary = await getSummary({ ageGroup: "9-10" });
  assert.equal(youngerAgeSummary.latestAge, 13);
  assert.equal(
    youngerAgeSummary.events.find((event) => event.event === "25_FR")?.race
      ?.ageAtSwim,
    9,
  );
  assert.equal(
    await card("25 Freestyle").count(),
    0,
    "Younger-age filtering does not restore 25s for an older athlete",
  );
  await chooseAge("11–12");
  await showTime("35.20");

  await chooseOption("Best times from", "Year Range");
  await openDropdown("Year Range");
  await myTimes
    .getByLabel("Start year", { exact: true })
    .selectOption(previousYear);
  await myTimes
    .getByLabel("End year", { exact: true })
    .selectOption(previousYear);
  await trigger("Year Range").press("Escape");
  await showTime("35.20");
  await assertDisplayedRank(
    { startYear: previousYear, endYear: previousYear },
    "primary-old",
    "11-12",
  );
  await openDropdown("Year Range");
  await myTimes
    .getByLabel("End year", { exact: true })
    .selectOption(recentYear);
  await myTimes
    .getByLabel("Start year", { exact: true })
    .selectOption(recentYear);
  await trigger("Year Range").press("Escape");
  await showTime("39.40");
  await assertDisplayedRank(
    { startYear: recentYear, endYear: recentYear },
    "primary-recent",
    "11-12",
  );
  await page.reload();
  await showTime("39.40");
  assert.match(await trigger("Best times from").innerText(), /Year Range/);
  const filterRequests = myTimesRequests.slice(filterRequestsStart);
  assert.ok(
    filterRequests.some(
      ({ params }) =>
        params.get("view") === "my_times" && params.get("ageGroup") === "13-14",
    ),
  );
  assert.ok(
    filterRequests.some(
      ({ params }) =>
        params.get("view") === "my_times" &&
        params.get("startYear") === recentYear &&
        params.get("endYear") === recentYear,
    ),
  );
  assert.ok(
    filterRequests.every(({ params }) => params.get("view") === "my_times"),
    "Each selection requests its displayed best and matching cohort rank together",
  );

  await chooseOption("Best times from", "All-Time");
  await showTime("35.20");
  await chooseOption("Course", "Long Course Meters");
  await card("50 Freestyle")
    .locator("strong")
    .filter({ hasText: "32.50" })
    .waitFor();
  assert.equal(await freestyle().count(), 0);
  await chooseOption("Course", "Short Course Yards");
  await showTime("35.20");
  await checkLayout();
  await page.screenshot({
    path: "/tmp/velocity-my-times-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await checkLayout();
  await chooseOption("Best times from", "Age Range");
  await chooseAge("13–14");
  await showTime("45.00");
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
  await page.waitForURL((url) => url.pathname === "/tools/rankings");
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
    await page.getByRole("button", { name: "← Times", exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("complementary", { name: "USA Swimming motivational ranks" })
      .count(),
    0,
  );
  const row = page.getByRole("row").filter({ hasText: athletes[0].name });
  await row
    .getByRole("link", {
      name: `View Times profile for ${athletes[0].name}`,
      exact: true,
    })
    .waitFor();
  const rankIcon = row.getByRole("button", {
    name: /rank: .* motivational standard$/,
  });
  await rankIcon.waitFor();
  assert.equal(await rankIcon.locator('img[src^="/assets/ranks/"]').count(), 1);
  await page.goBack();
  await showTime("45.00");
  assert.match(await trigger("Best times from").innerText(), /Age Range/);
  await page.goForward();
  await row
    .getByRole("link", {
      name: `View Times profile for ${athletes[0].name}`,
      exact: true,
    })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Verified Account athlete links, My Times selection dropdowns, age/year bests and matching swim-age ranks, 25s/team-rank/rank-icon toggles, display-state reloads, rank counts, ranking links, and desktop/mobile/dark card layouts.",
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
