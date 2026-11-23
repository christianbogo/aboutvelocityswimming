import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright";

const base = process.env.TEAM_MAP_TEST_URL ?? "http://127.0.0.1:3002";
const local = (value) =>
  ["127.0.0.1", "localhost"].includes(new URL(value).hostname);
assert.ok(
  local(base),
  "Team Map browser verification requires a local frontend.",
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
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ),
);
assert.ok(local(config.API_URL), "Team Map fixtures require local Supabase.");
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const email = "christiancutter02@gmail.com";
const users = await admin.auth.admin.listUsers();
assert.ifError(users.error);
const user = users.data.users.find((candidate) => candidate.email === email);
assert.ok(user, "Run seed:local before checking Team Map.");
const originalPreferences = await admin
  .from("account_followed_athletes")
  .select("*")
  .eq("user_id", user.id)
  .order("athlete_id");
assert.ifError(originalPreferences.error);
const originalRoster = await admin
  .from("workshare_athletes")
  .select("id,times_athlete_id,is_archived")
  .order("id");
assert.ifError(originalRoster.error);

const prefix = `team-map-browser-${randomUUID()}-`;
const day = new Date().toLocaleDateString("en-CA", {
  timeZone: "America/Los_Angeles",
});
const year = Number(day.slice(0, 4));
const tomorrow = new Date(`${day}T00:00:00Z`);
tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
const athletes = [
  "Avery",
  "Blake",
  "Casey",
  "ArchivedParent",
  "ArchivedAthlete",
].map((first, index) => ({
  id: `${prefix}${index}`,
  first,
  name: `${first} Teammapcheck`,
}));
const privateName = `${prefix}PRIVATE_FAMILY_NAME`;
const accounts = [
  { id: `${prefix}account`, full_name: privateName, is_archived: false },
  {
    id: `${prefix}archived-account`,
    full_name: `${privateName}_ARCHIVED`,
    is_archived: true,
  },
];
const rosterRows = [
  ...athletes.slice(0, 3).map((athlete, index) => ({
    id: `${prefix}roster-${index}`,
    account_id: accounts[0].id,
    full_name: athlete.name,
    training_group: index === 0 ? "Gold group" : "Senior group",
    times_athlete_id: athlete.id,
    is_archived: false,
  })),
  {
    id: `${prefix}duplicate`,
    account_id: accounts[0].id,
    full_name: athletes[0].name,
    training_group: "Senior group",
    times_athlete_id: athletes[0].id,
    is_archived: false,
  },
  {
    id: `${prefix}unlinked`,
    account_id: accounts[0].id,
    full_name: "Unlinked Teammapcheck",
    training_group: "Starter group",
    times_athlete_id: null,
    is_archived: false,
  },
  {
    id: `${prefix}archived-parent-athlete`,
    account_id: accounts[1].id,
    full_name: athletes[3].name,
    training_group: "Archived group",
    times_athlete_id: athletes[3].id,
    is_archived: false,
  },
  {
    id: `${prefix}archived-athlete`,
    account_id: accounts[0].id,
    full_name: athletes[4].name,
    training_group: "Archived group",
    times_athlete_id: athletes[4].id,
    is_archived: true,
  },
];
const meetId = `${prefix}meet`;
const writes = [
  {
    path: `meets/${meetId}`,
    after: { name: "Team Map isolated browser fixture" },
  },
  ...athletes.map((athlete) => ({
    path: `athletes/${athlete.id}`,
    after: {
      id: athlete.id,
      name: { first: athlete.first, last: "Teammapcheck" },
      gender: "F",
      teamId: "velocity-swimming",
      status: "active",
    },
  })),
];
function swim(id, athlete, eventCode, timeMs, ageAtSwim, date = day) {
  const data = {
    id: prefix + id,
    athleteId: athletes[athlete].id,
    raceIdentity: {
      occurrence: prefix + id,
      reviewed: true,
      basis: "Independent synthetic Team Map browser fixture",
      sourceUrl: "https://example.test/team-map-browser",
    },
    eventCode,
    course: eventCode.split("_").at(-1),
    timeMs,
    status: "OK",
    round: "F",
    isOfficial: true,
    isRelay: false,
    gender: "F",
    ...(ageAtSwim == null ? {} : { ageAtSwim }),
    teamId: "velocity-swimming",
    meet: { id: meetId, name: "Team Map isolated browser fixture", date },
  };
  writes.push({ path: `swims/${data.id}`, after: data });
}
for (const stroke of ["FR", "BK", "BR", "FL"])
  swim(`old-${stroke}`, 0, `100_${stroke}_SCY`, 50000, 11, `${year - 2}-06-15`);
for (const stroke of ["FR", "BK", "BR"])
  swim(
    `new-${stroke}`,
    0,
    `100_${stroke}_SCY`,
    stroke === "FR" ? 49000 : 50000,
    13,
  );
swim("repeat", 0, "100_FR_SCY", 51000, 13);
swim("unknown-age", 0, "200_FR_SCY", 60000, null);
swim("future", 0, "200_BK_SCY", 10000, 13, tomorrow.toISOString().slice(0, 10));
swim("blake-prior", 1, "100_FR_SCY", 50000, 13, `${year - 1}-06-15`);
swim("blake-upgrade", 1, "100_FR_SCY", 40000, 13);
swim("casey-lcm", 2, "50_FR_LCM", 30000, 13);
swim("archived-parent", 3, "100_FR_SCY", 20000, 13);
swim("archived-athlete", 4, "100_FR_SCY", 20000, 13);
const cuts = {
  cutsByTier: ["B", "BB", "A", "AA", "AAA", "AAAA"].map((tierName, index) => ({
    tierName,
    timeMs: 75000 - index * 10000,
    timeDisplay: (75 - index * 10).toFixed(2),
  })),
};
const scyCuts = Object.fromEntries(
  ["100_FR", "100_BK", "100_BR", "100_FL", "200_FR", "200_BK"].map((event) => [
    `${event}_SCY`,
    cuts,
  ]),
);
writes.push({
  path: `standards/${prefix}standard`,
  after: {
    id: `${prefix}standard`,
    name: "Team Map Browser Motivational",
    governingBody: "USA_Swimming",
    category: "motivational",
    standardType: "age-group",
    seasonYears: `${year - 4}–${year + 1}`,
    effectiveDate: `${year - 4}-01-01`,
    expirationDate: `${year + 1}-12-31`,
    sourceUrl: "https://example.test/team-map-standard",
    cuts: {
      SCY: { F: { "11-12": scyCuts, "13-14": scyCuts } },
      LCM: { F: { "13-14": { "50_FR_LCM": cuts } } },
    },
  },
});

let browser;
let page;
let seeded = false;
let accountsSeeded = false;
const errors = [];
try {
  assert.ifError(
    (await admin.rpc("test_write_records", { reads: [], writes })).error,
  );
  seeded = true;
  assert.ifError(
    (await admin.from("workshare_accounts").insert(accounts)).error,
  );
  accountsSeeded = true;
  assert.ifError(
    (
      await admin.from("workshare_account_emails").insert({
        account_id: accounts[0].id,
        email: "private-team-map-fixture@example.test",
      })
    ).error,
  );
  assert.ifError(
    (await admin.from("workshare_athletes").insert(rosterRows)).error,
  );
  console.log(
    "Seeded isolated linked Team Map roster and historical swims in the local stack.",
  );
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  await context.route("**/*.supabase.co/**", (route) => {
    errors.push("Refused a hosted backend request");
    return route.abort();
  });
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));
  const link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  assert.ifError(link.error);
  const jar = new Map();
  const auth = createServerClient(
    config.API_URL,
    config.PUBLISHABLE_KEY ?? config.ANON_KEY,
    {
      cookies: {
        getAll: () => [...jar.values()],
        setAll: (cookies) =>
          cookies.forEach((cookie) => jar.set(cookie.name, cookie)),
      },
    },
  );
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

  await page.goto(base + "/tools/team-map");
  const main = page.getByRole("main");
  const waitReady = async () => {
    await main
      .getByRole("heading", {
        name: "Every age group adds to the story.",
        exact: true,
      })
      .waitFor();
  };
  await waitReady();
  assert.ok(
    await page
      .getByRole("link", { name: "Team Map", exact: true })
      .first()
      .isVisible(),
  );
  const apiResponse = await context.request.get(
    base + `/api/times/team-map?year=${year}&course=`,
  );
  assert.equal(apiResponse.status(), 200);
  assert.equal(apiResponse.headers()["cache-control"], "private, no-store");
  const body = await apiResponse.json();
  const data = body.data;
  assert.equal(data.coverage.duplicateLinks, 1);
  assert.equal(data.coverage.linkedAthletes, 3);
  assert.equal(data.coverage.missingAgeSwims, 1);
  assert.equal(data.coverage.validSwims, 12);
  assert.equal(data.coverage.ungradedSwims, 1);
  assert.deepEqual(data.rankCounts, {
    B: 0,
    BB: 0,
    A: 7,
    AA: 1,
    AAA: 1,
    AAAA: 0,
  });
  assert.equal(data.totalContributions, 9);
  assert.equal(data.contributorCount, 3);
  assert.equal(data.roster.length, 4);
  assert.deepEqual(
    data.roster.map(({ name, total }) => [name, total]),
    [
      [athletes[0].name, 7],
      [athletes[1].name, 1],
      [athletes[2].name, 1],
      ["Unlinked Teammapcheck", 0],
    ],
    "The active roster includes everyone, deduplicates links, and keeps unlinked swimmers",
  );
  assert.deepEqual(data.familyCounts, {
    IM: 0,
    FL: 1,
    BK: 2,
    BR: 2,
    FR: 4,
    DST: 0,
  });
  assert.equal(data.gemHistory[0].total, 0);
  assert.deepEqual(
    data.gemHistory.at(-1),
    { date: day, total: 9, counts: data.rankCounts },
    "Career history ends at today's current roster inventory",
  );
  assert.deepEqual(
    data.gemHistory
      .filter(({ total }) => total > 0)
      .map(({ total }) => total),
    [4, 5, 9],
    "Repeats do not add gems and an upgrade does not add a second gem",
  );
  const activeRoster = main.getByRole("region", {
    name: "Active roster",
    exact: true,
  });
  await activeRoster.getByText("Unlinked Teammapcheck", { exact: true }).waitFor();
  for (const athlete of athletes.slice(0, 3))
    assert.equal(
      await activeRoster.getByText(athlete.name, { exact: true }).count(),
      1,
    );
  assert.equal(await activeRoster.locator("[data-gem-tier]").count(), 9);
  assert.equal(await activeRoster.locator('[data-gem-tier="A"]').count(), 7);
  const familyChart = main.getByRole("region", {
    name: "Gems by event family",
    exact: true,
  });
  assert.equal(await familyChart.locator("[data-gem-family]").count(), 6);
  assert.match(
    await familyChart.locator('[data-gem-family="FR"]').textContent(),
    /Free\s*4/,
  );
  await main
    .getByRole("region", { name: "Gems over time", exact: true })
    .getByRole("img")
    .waitFor();
  assert.equal(data.activity.swims, 7);
  assert.equal(data.activity.swimmers, 3);
  assert.equal(data.activity.meets, 1);
  assert.equal(data.activity.improvedEvents, 2);
  assert.equal(data.activity.newRankedEvents, 4);
  assert.equal(data.activity.rankUpgrades, 1);
  assert.equal(data.leaders[0].name, athletes[0].name);
  assert.equal(data.leaders[0].counts.A, 7);
  assert.deepEqual(data.leaders[0].trainingGroups, [
    "Gold group",
    "Senior group",
  ]);
  assert.deepEqual(
    data.ageGroups.map((group) => [group.ageGroup, group.counts.A]),
    [
      ["11-12", 4],
      ["13-14", 3],
    ],
  );
  const serialized = JSON.stringify(body);
  for (const privateValue of [
    privateName,
    "private-team-map-fixture@example.test",
    "emails",
    "account_id",
    "birthdate",
    "dateOfBirth",
    "timeMs",
    "sourceObservation",
  ])
    assert.ok(
      !serialized.includes(privateValue),
      `API omits private/raw ${privateValue}`,
    );
  assert.ok(
    !serialized.includes(athletes[3].name) &&
      !serialized.includes(athletes[4].name),
    "Archived athlete and archived parent results are absent",
  );
  await main
    .getByRole("button", {
      name: "7 Gold contributions; show contributors",
      exact: true,
    })
    .waitFor();
  await main
    .getByRole("button", {
      name: "11–12: 4 Gold; show contributors",
      exact: true,
    })
    .click();
  assert.equal(
    await main
      .getByLabel("Contributor age group", { exact: true })
      .inputValue(),
    "11-12",
  );
  assert.equal(
    await main.getByLabel("Contributor rank", { exact: true }).inputValue(),
    "A",
  );
  const contributors = main.locator("#team-contributors");
  assert.equal(await contributors.getByRole("row").count(), 2);
  assert.match(
    await contributors.getByRole("row").last().innerText(),
    /Avery Teammapcheck[\s\S]*4/,
  );
  await main
    .getByLabel("Contributor age group", { exact: true })
    .selectOption("13-14");
  assert.equal(await contributors.getByRole("row").count(), 2);
  assert.match(
    await contributors.getByRole("row").last().innerText(),
    /Avery Teammapcheck[\s\S]*3/,
  );
  await main.getByLabel("Contributor rank", { exact: true }).selectOption("AA");
  assert.equal(await contributors.getByRole("row").count(), 2);
  assert.match(
    await contributors.getByRole("row").last().innerText(),
    /Blake Teammapcheck/,
  );
  await main
    .getByLabel("Contributor age group", { exact: true })
    .selectOption("all");
  await main
    .getByLabel("Contributor rank", { exact: true })
    .selectOption("all");
  await main
    .getByLabel("Contributor age group", { exact: true })
    .selectOption("10&U");
  assert.equal(
    await main
      .getByLabel("Contributor age group", { exact: true })
      .inputValue(),
    "10&U",
  );
  await contributors
    .getByText("No contributions match this age group and rank yet.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await contributors.getByRole("row").count(),
    0,
    "An empty age band remains selected without falling back to all ages",
  );
  await main
    .getByLabel("Contributor age group", { exact: true })
    .selectOption("all");

  await main
    .getByRole("button", { name: "Previous activity year", exact: true })
    .click();
  await main
    .getByRole("heading", { name: `${year - 1} at a glance`, exact: true })
    .waitFor();
  await main
    .getByRole("button", {
      name: "7 Gold contributions; show contributors",
      exact: true,
    })
    .waitFor();
  assert.equal(
    await main
      .getByRole("heading", { name: "Individual swims", exact: true })
      .locator("..")
      .locator("strong")
      .innerText(),
    "1",
  );
  await main
    .getByRole("button", { name: "Next activity year", exact: true })
    .click();
  await main
    .getByRole("heading", { name: `${year} at a glance`, exact: true })
    .waitFor();
  await main.getByLabel("Course", { exact: true }).selectOption("LCM");
  await main
    .getByRole("button", {
      name: "1 Diamond contributions; show contributors",
      exact: true,
    })
    .waitFor();
  await main
    .getByRole("button", {
      name: "0 Gold contributions; show contributors",
      exact: true,
    })
    .waitFor();
  assert.equal(
    await main
      .getByRole("heading", { name: "Individual swims", exact: true })
      .locator("..")
      .locator("strong")
      .innerText(),
    "1",
  );
  await main.getByLabel("Course", { exact: true }).selectOption("SCM");
  await main
    .getByText("No contributions match this age group and rank yet.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await main
      .getByRole("heading", { name: "Individual swims", exact: true })
      .locator("..")
      .locator("strong")
      .innerText(),
    "0",
  );
  assert.equal(await activeRoster.locator("[data-gem-tier]").count(), 0);
  for (const name of [
    ...athletes.slice(0, 3).map((athlete) => athlete.name),
    "Unlinked Teammapcheck",
  ])
    assert.equal(
      await activeRoster.getByText(name, { exact: true }).count(),
      1,
      "Swimmers without gems remain in the active roster",
    );
  for (const family of ["IM", "FL", "BK", "BR", "FR", "DST"])
    assert.match(
      await familyChart.locator(`[data-gem-family="${family}"]`).textContent(),
      /0$/,
      "An empty course displays zero on every family axis",
    );
  await main.getByLabel("Course", { exact: true }).selectOption("");
  await main
    .getByRole("button", {
      name: "7 Gold contributions; show contributors",
      exact: true,
    })
    .waitFor();
  const failedRead = (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Synthetic Team Map outage" }),
    });
  await page.route("**/api/times/team-map?**", failedRead);
  await main.getByRole("button", { name: "Refresh", exact: true }).click();
  await main
    .getByRole("alert")
    .filter({ hasText: "Synthetic Team Map outage" })
    .waitFor();
  assert.equal(
    await main
      .getByRole("button", {
        name: "7 Gold contributions; show contributors",
        exact: true,
      })
      .count(),
    0,
    "A failed refresh cannot paint partial/stale totals",
  );
  await page.unroute("**/api/times/team-map?**", failedRead);
  await main.getByRole("button", { name: "Try again", exact: true }).click();
  await waitReady();
  await main
    .getByRole("button", {
      name: "7 Gold contributions; show contributors",
      exact: true,
    })
    .waitFor();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: "/private/tmp/velocity-team-map-desktop.png",
    fullPage: true,
  });
  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForFunction(() => {
      const sidebar = document.querySelector(
        'aside[aria-label="Navigation sidebar"]',
      );
      return sidebar && getComputedStyle(sidebar).visibility === "hidden";
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
      `No page-level horizontal overflow at ${width}px`,
    );
    const courseTextFits = await main
      .getByLabel("Course", { exact: true })
      .evaluate((element) => {
        const style = getComputedStyle(element);
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        context.font = style.font;
        const textWidth = context.measureText(
          element.selectedOptions[0].label,
        ).width;
        const availableWidth =
          element.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight);
        return textWidth <= availableWidth;
      });
    assert.equal(
      courseTextFits,
      true,
      `The selected course label fits at ${width}px`,
    );
    const scrollers = await main
      .locator('[role="region"][tabindex="0"]')
      .evaluateAll((elements) =>
        elements.map((element) => ({
          client: element.clientWidth,
          scroll: element.scrollWidth,
        })),
      );
    assert.ok(
      scrollers.some((item) => item.scroll > item.client),
      "Wide rank tables scroll within their own regions",
    );
    if (width === 375)
      await page.screenshot({
        path: "/private/tmp/velocity-team-map-mobile.png",
        fullPage: true,
      });
  }
  assert.deepEqual(errors, []);
  const finalPreferences = await admin
    .from("account_followed_athletes")
    .select("*")
    .eq("user_id", user.id)
    .order("athlete_id");
  assert.ifError(finalPreferences.error);
  assert.deepEqual(
    finalPreferences.data,
    originalPreferences.data,
    "Account preferences remain unchanged",
  );
  console.log(
    "Team Map local browser verification passed: active roster gem squares, six-family hexagon, cumulative gem history, exact seven-Gold counts, age/rank leaders, archive/link dedup, annual progress, courses, retry, private payload, and mobile layouts.",
  );
} catch (error) {
  if (page) {
    console.error((await page.locator("body").innerText()).slice(0, 12000));
    await page
      .screenshot({
        path: "/private/tmp/velocity-team-map-failure.png",
        fullPage: true,
      })
      .catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  if (accountsSeeded)
    assert.ifError(
      (
        await admin
          .from("workshare_accounts")
          .delete()
          .in(
            "id",
            accounts.map(({ id }) => id),
          )
      ).error,
    );
  if (seeded) {
    const people = await admin
      .from("athletes")
      .select("person_id")
      .in(
        "id",
        athletes.map(({ id }) => id),
      );
    assert.ifError(people.error);
    assert.ifError(
      (
        await admin.rpc("test_write_records", {
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
        })
      ).error,
    );
    console.log(
      "Removed isolated Team Map fixture accounts, roster, standards, swims, and athletes.",
    );
  }
  const finalRoster = await admin
    .from("workshare_athletes")
    .select("id,times_athlete_id,is_archived")
    .order("id");
  assert.ifError(finalRoster.error);
  assert.deepEqual(
    finalRoster.data,
    originalRoster.data,
    "Original roster remains unchanged after cleanup",
  );
}
