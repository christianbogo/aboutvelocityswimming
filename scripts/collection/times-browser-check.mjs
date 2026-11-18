import { chromium } from "playwright";
import assert from "node:assert/strict";
import {
  normalizeRace,
  rankedTimes,
  initialFilters,
  matches,
  teamRecords,
} from "../../src/components/collection/times-data.ts";
const base = process.env.VELOCITY_TEST_URL ?? "http://127.0.0.1:3001";
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(base).hostname),
  "Browser fixtures require a local frontend",
);
const today = new Date().toLocaleDateString("en-CA", {
  timeZone: "America/Los_Angeles",
});
const velocityTeam = "velocity-swimming";
const events = [
  ["50_FR", 30000],
  ["100_FR", 60000],
  ["100_BR", 90000],
  ["200_IM", 150000],
];
const standard = {
  name: "Browser verified standards",
  governingBody: "USA_Swimming",
  category: "motivational",
  standardType: "age-group",
  seasonYears: "2026",
  effectiveDate: "2026-01-01",
  expirationDate: "2026-12-31",
  cuts: {
    SCY: {
      F: {
        "11-12": Object.fromEntries(
          events.map(([event, time]) => [
            event + "_SCY",
            {
              cutsByTier: [
                { tierName: "A", timeMs: Math.round(time * 1.24) },
                { tierName: "AAA", timeMs: time },
              ],
            },
          ]),
        ),
      },
    },
  },
};
const names = new Map(
  Array.from({ length: 29 }, (_, i) => [
    "athlete" + i,
    i === 28
      ? "Provisional Fixture"
      : `Swimmer ${String(i).padStart(2, "0")} Fixture`,
  ]),
);
function race(id, athleteId, event, time, extra = {}) {
  return {
    ...normalizeRace({
      id,
      athlete_id: athleteId,
      swim_date: today,
      data: {
        eventCode: event + "_SCY",
        course: "SCY",
        timeMs: time,
        status: "OK",
        round: "F",
        isOfficial: true,
        isRelay: false,
        ageAtSwim: 12,
        gender: "F",
        teamId: velocityTeam,
        teamName: "Velocity Swimming",
        meet: { id: "meet", name: "Fixture meet" },
      },
    }),
    athleteName: names.get(athleteId) ?? athleteId,
    ...extra,
  };
}
const races = [...names].flatMap(([id], i) =>
  (i === 28 ? events.slice(0, 1) : events).map(([event, time], j) =>
    race(id + "_" + j, id, event, Math.round(time * (1 + i / 100))),
  ),
);
races.push(
  race("old", "athlete0", "100_FR", 65000, { date: "2025-10-01" }),
  race("male", "male", "100_FR", 55000, {
    gender: "M",
    athleteName: "Male Fixture",
  }),
);
const relayMembers = [
  {
    leg: 1,
    athleteId: "athlete0",
    name: names.get("athlete0"),
    stroke: "FR",
    timeMs: 28000,
    leadOffEligible: true,
  },
  {
    leg: 2,
    athleteId: "athlete1",
    name: names.get("athlete1"),
    stroke: "FR",
    timeMs: 31000,
  },
  { leg: 3, name: "Unlinked Fixture", stroke: "FR" },
  { leg: 4, athleteId: "athlete3", name: names.get("athlete3"), stroke: "FR" },
];
races.push(
  ...Array.from({ length: 26 }, (_, index) =>
    race("relay" + index, "", "200_FR-R", 120000 + index * 1000, {
      relay: true,
      gender: "X",
      relayAgeGroup: "11-12",
      relayName:
        index === 0 ? "Mixed fixture relay" : "Mixed fixture relay " + index,
      members: relayMembers,
      splitCoverage: "partial",
      splits: [
        { distance: 50, cumulativeMs: 28000, lapMs: 28000 },
        { distance: 100, cumulativeMs: 59000, lapMs: 31000 },
      ],
    }),
  ),
);
races.push(
  race("girls-relay", "", "200_MED-R", 130000, {
    relay: true,
    gender: "F",
    relayAgeGroup: "11-12",
    relayName: "Girls fixture relay",
    members: relayMembers,
  }),
  race("boys-relay", "", "200_MED-R", 125000, {
    relay: true,
    gender: "M",
    relayAgeGroup: "11-12",
    relayName: "Boys fixture relay",
    members: relayMembers,
  }),
  race("mixed-only-event", "", "300_FR-R", 180000, {
    relay: true,
    gender: "X",
    relayAgeGroup: "13-15",
    relayName: "Mixed-only fixture relay",
    members: relayMembers,
  }),
  race("relay-dq", "", "200_FR-R", 110000, {
    relay: true,
    gender: "X",
    relayAgeGroup: "11-12",
    relayName: "Disqualified fixture relay",
    status: "DQ",
    members: relayMembers,
    splitCoverage: "unavailable",
  }),
);
races.push(
  race("leadoff", "athlete0", "50_FR", 28000, {
    resultOrigin: "relay_leadoff",
    parentRelayResultId: "relay-dq",
    splits: [{ distance: 50, cumulativeMs: 28000, lapMs: 28000 }],
    splitCoverage: "complete",
  }),
);
races.find((race) => race.id === "athlete0_1").splits = [
  { distance: 50, cumulativeMs: 29000, lapMs: 29000 },
  { distance: 100, cumulativeMs: 60000, lapMs: 31000 },
];
races.find((race) => race.id === "athlete0_1").splitCoverage = "complete";
const browser = await chromium.launch({ headless: true });
const errors = [];
let storageState;
async function setup({ failure = false, expiry = false } = {}) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    storageState,
  });
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/auth/v1/**", (route) => {
    assert.ok(
      ["127.0.0.1", "localhost"].includes(
        new URL(route.request().url()).hostname,
      ),
    );
    return route.continue();
  });
  if (!storageState) {
    await page.goto(base + "/login");
    await page.getByRole("button", { name: /password/i }).click();
    await page.locator("input[type=email]").fill("christiancutter02@gmail.com");
    await page
      .locator("input[type=password]")
      .fill("Velocity-local-test-2026!");
    await page.locator("button[type=submit]").click();
    await page.waitForURL(base + "/tools");
    storageState = await page.context().storageState();
  }
  await page.route("**/rest/v1/standards?*", (route) =>
    route.fulfill({
      json: [{ id: "ranking-standard", data: standard }],
    }),
  );
  await page.route("**/rest/v1/rpc/get_account_athletes", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/rest/v1/public_athletes?*", (route) => {
    const id = new URL(route.request().url()).searchParams
      .get("id")
      ?.replace(/^eq\./, "");
    assert.ok(id, "Profile lookup must use an exact swimmer ID");
    const name = names.get(id);
    return route.fulfill({
      json: name ? { id, data: { name: { first: name, last: "" } } } : null,
    });
  });
  const bookmarks = [];
  await page.route("**/rest/v1/times_ranking_bookmarks?*", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: bookmarks });
    const bookmark = {
      ...route.request().postDataJSON(),
      id: `bookmark-${bookmarks.length + 1}`,
    };
    bookmarks.push(bookmark);
    return route.fulfill({ status: 201, json: bookmark });
  });
  const calls = [];
  let expiryDeadline;
  page.on("request", (r) => {
    if (r.url().includes("/rest/v1/public_")) {
      const url = new URL(r.url());
      assert.ok(
        url.pathname.endsWith("/public_athletes") &&
          url.searchParams.get("id")?.startsWith("eq."),
        "Unexpected bulk public download",
      );
    }
  });
  await page.route("**/api/times?*", async (route) => {
    const q = new URL(route.request().url()).searchParams,
      view = q.get("view");
    assert.equal(
      q.has("team"),
      false,
      "Velocity reads do not send a selectable team",
    );
    calls.push(q);
    if (failure && view === "rankings") {
      failure = false;
      return route.fulfill({ status: 503, json: { error: "Fixture failure" } });
    }
    const input = Object.fromEntries(q);
    input.offset = Number(q.get("offset") ?? 0);
    input.limit = Number(q.get("limit") ?? 25);
    input.ageGroups = (q.get("ageGroups") ?? "").split(",").filter(Boolean);
    const filters = {
      ...initialFilters,
      ...input,
      genders:
        q.get("genders")?.split(",") ?? (view === "rankings" ? ["F"] : []),
      relay: q.get("relay") === "true",
    };
    let data;
    if (view === "ranking_years") data = { years: ["2026", "2025"] };
    if (view === "rankings") {
      const all = rankedTimes(
        races.filter((r) => matches(r, filters)),
        filters.mode,
        filters.relay,
      ).filter(
        ({ race }) =>
          !q.get("search") ||
          (race.relay ? race.relayName : race.athleteName)
            .toLowerCase()
            .includes(q.get("search").toLowerCase()),
      );
      data = {
        rows: all.slice(input.offset, input.offset + input.limit),
        total: all.length,
      };
      if (q.get("course") === "LCM")
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (view === "my_times") {
      const athleteId = q.get("athleteId");
      data = {
        myTimes: {
          period: "all",
          athleteId,
          ages: [12],
          years: [today.slice(0, 4)],
          latestAge: 12,
          latestAgeGroup: "11-12",
          events: races
            .filter(
              (race) =>
                race.athleteId === athleteId && race.course === q.get("course"),
            )
            .map((race) => ({
              event: race.event,
              race,
              rankRace: race,
              allTimeRank: 27,
              allTimeCount: 29,
              rankAgeGroup: "11-12",
              rankGender: "F",
            })),
        },
      };
    }
    if (view === "race") {
      const chosen = races.find((race) => race.id === q.get("raceId"));
      data = { rows: chosen ? [{ race: chosen }] : [], total: chosen ? 1 : 0 };
    }
    if (view === "records_board")
      data = {
        records: Object.fromEntries(
          [...teamRecords(races, velocityTeam)].map(([key, holders]) => [
            key,
            holders.map((race) => race.id),
          ]),
        ),
        recordsUpdatedAt: "2026-11-15T18:00:00Z",
        races: [
          ...new Map(
            [...teamRecords(races, velocityTeam).values()]
              .flat()
              .map((race) => [race.id, race]),
          ).values(),
        ],
      };
    assert.ok(data, "Unhandled times view: " + view);
    if (expiry && view === "rankings") expiryDeadline ??= Date.now() + 900;
    const expiresAt =
      expiryDeadline && Date.now() < expiryDeadline && view === "rankings"
        ? expiryDeadline
        : (Math.floor(Date.now() / 60000) + 1) * 60000;
    await route.fulfill({ json: { ...data, expiresAt } });
  });
  return { page, calls };
}
async function checkSharedSelections() {
  const { page } = await setup();
  await page.route("**/rest/v1/standards?*", (route) =>
    route.fulfill({
      json: [
        {
          id: "sharing-standard",
          data: {
            ...standard,
            seasonYears: "2026",
            effectiveDate: "2026-01-01",
            expirationDate: "2026-12-31",
          },
        },
      ],
    }),
  );
  await page.goto(base + "/tools/times?source=shared#results");
  await page.getByRole("link", { name: "Standards", exact: true }).click();
  const standards = page.getByRole("region", { name: "Standards" });
  const standardPicker = standards.getByRole("button", {
    name: "Standard",
    exact: true,
  });
  const tierPicker = standards.getByRole("slider", {
    name: "Tier",
    exact: true,
  });
  const standardDialog = standards.getByRole("dialog", { name: "Standard" });
  const standardOption = /^Browser verified standards · /;
  await standardPicker.click();
  await standards
    .getByRole("dialog", { name: "Standard" })
    .getByRole("button", { name: standardOption })
    .click();
  await page.reload();
  assert.match(await standardPicker.innerText(), standardOption);
  assert.equal(await tierPicker.getAttribute("aria-valuetext"), "A");
  const standardUrl = page.url();
  const standardParams = new URL(standardUrl).searchParams;
  assert.equal(standardParams.get("source"), "shared");
  assert.equal(new URL(standardUrl).hash, "#results");
  assert.equal(standardParams.get("standard"), "sharing-standard");
  assert.equal(JSON.parse(standardParams.get("standardFilters")).tier, "A");

  await page.setViewportSize({ width: 390, height: 844 });
  await standardPicker.press("Enter");
  await standardDialog.waitFor();
  assert.equal(
    await standardDialog
      .getByRole("button", { name: standardOption })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.keyboard.press("Escape");
  await standardDialog.waitFor({ state: "hidden" });
  assert.equal(
    await standardPicker.evaluate(
      (button) => document.activeElement === button,
    ),
    true,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });

  // A fresh document restores URL state without relying on mounted components.
  await page.goto(base + "/tools/times?source=shared#results");
  await page.goto(standardUrl);
  assert.match(await standardPicker.innerText(), standardOption);
  assert.equal(await tierPicker.getAttribute("aria-valuetext"), "A");
  await page.goBack();
  assert.equal(
    await page
      .getByRole("link", { name: "Rankings", exact: true })
      .getAttribute("aria-current"),
    "page",
  );
  await page.goForward();
  assert.match(await standardPicker.innerText(), standardOption);
  assert.equal(await tierPicker.getAttribute("aria-valuetext"), "A");
  await page.close();
}

try {
  await checkSharedSelections();
  const { page, calls } = await setup();
  await page.goto(base + "/tools/times");
  await page
    .locator('table[aria-busy="false"]')
    .first()
    .waitFor()
    .catch(async (error) => {
      console.error(
        "Fixture calls",
        calls.map((q) => q.toString()),
        "Page errors",
        errors,
        await page.locator("body").innerText(),
      );
      throw error;
    });
  assert.deepEqual([...new Set(calls.map((q) => q.get("view")))].sort(), [
    "ranking_years",
    "rankings",
  ]);
  assert.equal(
    await page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .count(),
    0,
  );
  const timesNav = page.getByRole("navigation", { name: "Tools navigation" });
  assert.equal(
    await timesNav
      .getByRole("link", { name: "Velocity Times", exact: true })
      .count(),
    0,
  );
  for (const [name, path] of [
    ["Times", "my-times"],
    ["Rankings", "rankings"],
    ["Records", "records"],
    ["Standards", "standards"],
  ]) {
    const link = timesNav.getByRole("link", { name, exact: true });
    assert.equal(await link.getAttribute("href"), `/tools/${path}`);
    assert.equal(await link.getAttribute("aria-controls"), null);
  }
  assert.equal(
    await page
      .locator('a[href*="view=meets"], a[href*="view=athletes"]')
      .count(),
    0,
    "Removed Times pages have no navigation or result links",
  );
  const toolsLink = timesNav.getByRole("link", {
    name: "Account",
    exact: true,
  });
  assert.equal(await toolsLink.getAttribute("href"), "/tools");
  const sidebarBounds = await timesNav.boundingBox();
  const headerBounds = await page
    .locator("[data-times-page] > header")
    .boundingBox();
  assert.ok(sidebarBounds.x + sidebarBounds.width <= headerBounds.x);
  assert.equal(headerBounds.x + headerBounds.width, 1440);
  const summary = page.getByLabel("Selected times filters");
  async function checkCenteredSummary() {
    assert.equal(
      await summary.evaluate((node) => getComputedStyle(node).justifyContent),
      "center",
    );
    assert.equal(
      await summary
        .locator("..")
        .evaluate((node) => getComputedStyle(node).position),
      "sticky",
    );
  }
  await checkCenteredSummary();
  await toolsLink.press("[");
  await timesNav.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Open navigation sidebar" }).click();
  await timesNav.waitFor();
  assert.equal(
    await summary
      .locator("dt")
      .first()
      .evaluate((node) => getComputedStyle(node).position),
    "absolute",
    "Ranking filter labels remain accessible but are visually hidden",
  );
  assert.equal(await page.getByText("R = relay", { exact: true }).count(), 0);
  assert.equal(
    await page
      .locator("label")
      .filter({ hasText: /^Event$/ })
      .first()
      .evaluate((node) => getComputedStyle(node).position),
    "absolute",
    "Event selector label is visually hidden",
  );

  assert.deepEqual(await summary.locator("dd").allTextContents(), [
    "SCY",
    "100 Freestyle",
    "All ages",
    "Female",
  ]);
  await page
    .getByRole("button", { name: "Event filters", exact: true })
    .click();
  const bookmarkSelection = page.getByRole("button", {
    name: "Bookmark Selection",
    exact: true,
  });
  await bookmarkSelection.waitFor();
  await bookmarkSelection.click();
  const bookmarkDialog = page.getByRole("dialog", {
    name: "Bookmark Selection",
    exact: true,
  });
  const suggestedName = "100 Freestyle · SCY · Girls · All ages · All-time";
  assert.equal(
    await bookmarkDialog
      .getByLabel("Bookmark name", { exact: true })
      .inputValue(),
    suggestedName,
  );
  await bookmarkDialog
    .getByRole("button", { name: "Save bookmark", exact: true })
    .click();
  await bookmarkDialog.waitFor({ state: "hidden" });
  const editBookmark = page.getByRole("button", {
    name: `Edit bookmark ${suggestedName}`,
    exact: true,
  });
  const iconSpace = await editBookmark.boundingBox();
  assert.equal(
    await editBookmark
      .locator("svg")
      .evaluate((node) => getComputedStyle(node).opacity),
    "0",
  );
  await editBookmark.hover();
  await page.waitForFunction(() => {
    const icon = document.querySelector('[aria-label^="Edit bookmark"] svg');
    return icon && getComputedStyle(icon).opacity === "1";
  });
  assert.equal(
    (await editBookmark.boundingBox()).width,
    iconSpace.width,
    "Hovering edit preserves bookmark width",
  );
  await page
    .getByRole("button", { name: "Event filters", exact: true })
    .click();
  const rankedTable = page.getByRole("table").first();
  assert.deepEqual(
    await rankedTable.getByRole("columnheader").allTextContents(),
    ["Rank", "Athlete", "Time", "Date", "Meet"],
  );
  assert.equal(
    await rankedTable
      .getByRole("columnheader", { name: "Rank", exact: true })
      .locator("span")
      .getAttribute("class"),
    "sr-only",
  );
  assert.equal(
    await rankedTable
      .locator("tbody tr")
      .first()
      .locator("td")
      .first()
      .evaluate((cell) => getComputedStyle(cell).textAlign),
    "center",
  );
  assert.equal(
    await page.getByRole("button", { name: "Team", exact: true }).count(),
    0,
  );
  await page.getByRole("button", { name: "Age group", exact: true }).click();
  assert.deepEqual(
    await page.getByRole("dialog").getByRole("button").allTextContents(),
    [
      "",
      "All ages",
      "8 & under",
      "9–10",
      "11–12",
      "13–14",
      "15–16",
      "17–18",
      "19 & over",
      "Done",
    ],
  );

  await page
    .getByRole("dialog")
    .getByRole("button", { name: "11–12", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Age group", exact: true })
    .waitFor({ state: "hidden" });
  await summary.getByText("11–12", { exact: true }).waitFor();
  await rankedTable.getByText("Swimmer 00 Fixture", { exact: true }).waitFor();
  const diamondBoundary = rankedTable
    .getByRole("row")
    .filter({ hasText: "1:00.00 DIAMOND CUTOFF" });
  await diamondBoundary.waitFor();
  assert.match(
    await diamondBoundary.locator("xpath=preceding-sibling::tr[1]").innerText(),
    /1:00\.00/,
  );
  assert.match(
    await diamondBoundary.locator("xpath=following-sibling::tr[1]").innerText(),
    /1:00\.60/,
  );
  assert.equal(
    await diamondBoundary
      .locator("td:visible div")
      .evaluate((node) => getComputedStyle(node).borderTopWidth),
    "3px",
  );
  await page
    .getByRole("navigation", { name: "Result pages" })
    .getByRole("button", { name: "Next", exact: true })
    .click();
  const goldBoundary = rankedTable
    .getByRole("row")
    .filter({ hasText: "1:14.40 GOLD CUTOFF" });
  await goldBoundary.waitFor();
  assert.equal(
    await rankedTable.locator("tbody tr").first().innerText(),
    await goldBoundary.innerText(),
    "A cutoff after the previous page's final swim appears before this page's first swim",
  );
  await page
    .getByRole("navigation", { name: "Result pages" })
    .getByRole("button", { name: "Previous", exact: true })
    .click();
  await page.getByRole("button", { name: "Age group", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Age group", exact: true })
    .getByRole("button", { name: "All ages", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Age group", exact: true })
    .waitFor({ state: "hidden" });
  await summary.getByText("All ages", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  const female = page.getByRole("button", { name: "Female", exact: true }),
    male = page.getByRole("button", { name: "Male", exact: true });
  await female.click();
  assert.equal(await female.getAttribute("aria-pressed"), "true");
  await male.click();
  await page
    .getByRole("table")
    .getByText("Male Fixture", { exact: true })
    .waitFor();
  assert.equal(await female.getAttribute("aria-pressed"), "true");
  assert.equal(await male.getAttribute("aria-pressed"), "true");
  await male.click();
  await page
    .getByRole("table")
    .getByText("Swimmer 00 Fixture", { exact: true })
    .waitFor();
  await page
    .getByRole("navigation", { name: "Result pages" })
    .getByRole("button", { name: "Next", exact: true })
    .click();
  await page
    .getByRole("table")
    .getByText("Swimmer 26 Fixture", { exact: true })
    .waitFor();
  await page.getByLabel("Search athletes", { exact: true }).fill("Swimmer 26");
  await page.waitForResponse((r) => r.url().includes("search=Swimmer+26"));
  assert.equal(
    (
      await page.getByRole("table").locator("tbody tr").first().innerText()
    ).startsWith("27"),
    true,
  );
  await page
    .getByRole("table")
    .locator("tbody tr")
    .filter({ hasText: "Swimmer 26 Fixture" })
    .locator("td")
    .last()
    .click();
  await page.waitForURL(
    (url) =>
      url.pathname === "/tools/my-times" &&
      url.searchParams.get("myAthlete") === "athlete26",
  );
  await page
    .getByRole("region", { name: "Athlete times", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: /Athlete.*Swimmer 26 Fixture/ })
    .waitFor();
  assert.ok(
    calls.some(
      (q) => q.get("view") === "my_times" && q.get("athleteId") === "athlete26",
    ),
  );
  await page.reload();
  await page
    .getByRole("region", { name: "Athlete times", exact: true })
    .waitFor();
  await page.goBack();
  await page
    .getByRole("link", { name: "View Times profile for Swimmer 26 Fixture" })
    .waitFor();
  await page.getByRole("link", { name: "Records", exact: true }).click();
  const recordsPanel = page.getByRole("region", {
    name: "Records",
    exact: true,
  });
  await recordsPanel
    .getByRole("region", { name: "SCY 13–14 record table", exact: true })
    .waitFor();
  assert.equal(await recordsPanel.getByRole("table").count(), 1);
  await recordsPanel
    .getByRole("button", { name: "Render all records", exact: true })
    .click();
  await recordsPanel
    .getByRole("navigation", { name: "Record sections" })
    .waitFor();
  assert.equal(
    await recordsPanel
      .getByRole("heading", { name: "Records", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await recordsPanel
      .getByRole("button", { name: "Record team", exact: true })
      .count(),
    0,
  );
  const recordTable = recordsPanel
    .getByRole("region", { name: "SCY 11–12 record table", exact: true })
    .getByRole("table");
  await recordTable.waitFor();
  assert.deepEqual(
    await recordTable.getByRole("columnheader").allTextContents(),
    ["Girls", "Event", "Boys"],
  );
  const recordBoard = recordTable
    .getByRole("button", {
      name: "View girls 11–12 SCY 100 FR rankings",
      exact: true,
    })
    .first();
  await recordBoard.waitFor();
  const boardText = await recordBoard
    .locator(":scope > span")
    .allTextContents();
  assert.equal(
    boardText.length,
    3,
    "Each record board contains only name, time, and year",
  );
  assert.ok(boardText[0].includes("Swimmer"));
  assert.match(boardText[1], /^\d+:\d{2}\.\d{2}$/);
  assert.match(boardText[2], /^\d{4}$/);
  await recordsPanel
    .getByRole("heading", {
      name: "Velocity Swimming · 11–12 · SCY",
      exact: true,
    })
    .waitFor();
  assert.equal(
    await recordTable.locator("caption time").textContent(),
    "Updated Nov 15, 2026",
  );
  const headingLabels = recordTable.locator("caption > div > span");
  assert.deepEqual(await headingLabels.allTextContents(), ["Girls", "Boys"]);
  assert.equal(
    await headingLabels
      .first()
      .evaluate((node) => getComputedStyle(node).textAlign),
    "left",
  );
  assert.equal(
    await headingLabels
      .last()
      .evaluate((node) => getComputedStyle(node).textAlign),
    "right",
  );
  assert.equal(
    await recordTable
      .locator("caption")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
    "rgba(0, 0, 0, 0)",
  );
  assert.equal(
    await recordTable
      .locator("tbody td")
      .first()
      .evaluate((node) => getComputedStyle(node).borderBottomWidth),
    "0px",
  );
  for (const side of ["first-of-type", "last-of-type"]) {
    const walls = await recordsPanel
      .locator(
        `tbody > tr > td:${side} > div > :is(button, div) > :nth-child(2)`,
      )
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().right),
      );
    assert.ok(walls.length > 1);
    assert.ok(
      Math.max(...walls) - Math.min(...walls) < 1,
      "Record time right edges align across all tables",
    );
  }
  await recordTable
    .getByRole("rowheader", { name: "100 Freestyle", exact: true })
    .waitFor();
  await recordTable
    .getByRole("rowheader", { name: "200 Medley relay", exact: true })
    .waitFor();
  const relayEvent = recordTable.getByRole("rowheader", {
    name: "200 Medley relay",
    exact: true,
  });
  const eventHeight = (await relayEvent.locator("span").boundingBox()).height;
  const recordHeights = await relayEvent
    .locator("..")
    .locator("td > div > div")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().height),
    );
  assert.ok(
    Math.abs(eventHeight - Math.max(...recordHeights)) < 1,
    "Relay event cards match the tallest record card",
  );
  assert.equal(
    await recordBoard.evaluate((node) => getComputedStyle(node).color),
    "rgb(255, 255, 255)",
  );
  assert.equal(
    await recordTable
      .getByRole("rowheader")
      .first()
      .locator("span")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
    await recordTable
      .evaluate((node) =>
        getComputedStyle(node).getPropertyValue("--primary-dark").trim(),
      )
      .then((color) => {
        const hex = color.slice(1);
        return `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
      }),
  );
  assert.equal(
    await recordsPanel
      .locator('[aria-label="No available record"]')
      .first()
      .textContent(),
    "",
  );

  assert.equal(
    await recordTable
      .getByRole("rowheader")
      .first()
      .evaluate((node) => getComputedStyle(node).textAlign),
    "center",
  );
  assert.equal(
    await page.getByLabel("Selected times filters").count(),
    0,
    "Team records has no filter summary bar",
  );
  await recordsPanel
    .getByRole("button", {
      name: "View girls 11–12 SCY 200 MED-R rankings",
      exact: true,
    })
    .first()
    .waitFor();
  await recordsPanel
    .getByRole("button", {
      name: "View boys 11–12 SCY 200 MED-R rankings",
      exact: true,
    })
    .first()
    .waitFor();
  assert.equal(
    await recordsPanel
      .getByText("Girls fixture relay", { exact: true })
      .count(),
    0,
  );
  assert.equal(
    await recordsPanel.getByText("Boys fixture relay", { exact: true }).count(),
    0,
  );
  assert.equal(
    await recordsPanel
      .getByRole("columnheader", { name: "Mixed", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await recordsPanel.getByRole("button", { name: /^View mixed / }).count(),
    0,
  );
  assert.equal(
    await recordsPanel
      .getByText("Mixed-only fixture relay", { exact: true })
      .count(),
    0,
  );
  assert.equal(
    await recordsPanel.getByText("300 FR-R", { exact: true }).count(),
    0,
  );
  assert.equal(
    await recordsPanel
      .getByRole("heading", { name: "13-15", exact: true })
      .count(),
    0,
  );
  const recordLineup = recordsPanel
    .getByRole("list", { name: "Relay swimmers" })
    .first();
  await recordLineup.waitFor();
  assert.deepEqual(await recordLineup.getByRole("listitem").allTextContents(), [
    "Swimmer F.",
    "Swimmer F.",
    "Unlinked F.",
    "Swimmer F.",
  ]);
  assert.equal(
    await recordLineup.evaluate(
      (list) => getComputedStyle(list).gridTemplateColumns.split(" ").length,
    ),
    2,
  );
  await page
    .getByRole("button", {
      name: "View girls 11–12 SCY 200 MED-R rankings",
      exact: true,
    })
    .first()
    .click();
  await page.getByText("2:10.00", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "← Records", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "← Times", exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("table")
      .getByText("Girls fixture relay", { exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "Mixed", exact: true }).count(),
    1,
  );
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await Promise.all([
    page.waitForRequest(
      (r) =>
        r.url().includes("view=rankings") && r.url().includes("course=LCM"),
    ),
    page.getByRole("button", { name: "LCM", exact: true }).click(),
  ]);
  await page.getByRole("button", { name: "SCY", exact: true }).click();
  await page
    .getByRole("table")
    .getByText("Swimmer 00 Fixture", { exact: true })
    .waitFor();
  await page.waitForTimeout(550);
  await page
    .getByRole("table")
    .getByText("Swimmer 00 Fixture", { exact: true })
    .waitFor();
  // Wide results panels expose the six-column selector without a popup.
  const eventSelector = page.getByRole("group", { name: "Event", exact: true });
  await eventSelector.waitFor();
  await eventSelector
    .getByRole("button", { name: "200 Medley relay", exact: true })
    .waitFor();
  if (process.env.VELOCITY_SELECTOR_SCREENSHOTS)
    await eventSelector.screenshot({
      path: "/tmp/velocity-selector-desktop.png",
    });
  assert.equal(
    await page.getByRole("button", { name: "Event", exact: true }).count(),
    0,
  );
  await eventSelector
    .getByRole("button", { name: "200 Freestyle relay", exact: true })
    .click();
  assert.equal(
    await page.getByRole("group", { name: "Result type", exact: true }).count(),
    0,
  );
  await page
    .getByLabel("Selected times filters")
    .getByText("200 Freestyle relay", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Mixed", exact: true }).click();
  await page.getByText("2:00.00", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("table")
      .getByText("Mixed fixture relay", { exact: true })
      .count(),
    0,
  );
  const rankedLineup = page
    .getByRole("table")
    .first()
    .getByRole("list", { name: "Relay swimmers" })
    .first();
  assert.deepEqual(await rankedLineup.getByRole("listitem").allTextContents(), [
    "Swimmer F.",
    "Swimmer F.",
    "Unlinked F.",
    "Swimmer F.",
  ]);
  assert.equal(
    await rankedLineup.evaluate(
      (list) => getComputedStyle(list).gridTemplateColumns.split(" ").length,
    ),
    2,
  );
  assert.equal(await rankedLineup.getByRole("link").count(), 3);
  assert.equal(
    await rankedLineup
      .getByRole("link")
      .first()
      .getAttribute("href")
      .then((href) => new URL(href, base).searchParams.get("myAthlete")),
    "athlete0",
  );
  await page.getByRole("button", { name: "LCM", exact: true }).click();
  assert.equal(
    await eventSelector
      .getByRole("button", { name: "100 Freestyle relay", exact: true })
      .count(),
    0,
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await page
    .getByLabel("Selected times filters")
    .getByText("100 Freestyle", { exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Mixed", exact: true }).count(),
    0,
  );
  // An eligible lead-off remains an individual PB when the parent team is disqualified.
  await eventSelector
    .getByRole("button", { name: "50 Freestyle", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("table")
      .getByText("Verified lead-off", { exact: true })
      .count(),
    0,
  );
  const leadProfile = page.getByRole("link", {
    name: "View Times profile for Swimmer 00 Fixture",
    exact: true,
  });
  await leadProfile.click();
  await page.waitForURL(
    (url) =>
      url.pathname === "/tools/my-times" &&
      url.searchParams.get("myAthlete") === "athlete0",
  );
  await page.goBack();
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await page
    .getByRole("table")
    .getByText("Swimmer 00 Fixture", { exact: true })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await rankedTable
      .getByRole("columnheader", { name: "Meet", exact: true })
      .count(),
    0,
  );
  const mobileHeaderBounds = await page
    .locator("[data-times-page] > header")
    .boundingBox();
  assert.equal(mobileHeaderBounds.x, 0);
  assert.equal(mobileHeaderBounds.width, 390);
  await page.getByRole("button", { name: "Event", exact: true }).click();
  const dialog = page.getByRole("dialog");
  assert.deepEqual(
    await dialog.getByRole("heading", { level: 3 }).allTextContents(),
    ["IM", "Fly", "Back", "Breast", "Free", "Dist"],
  );
  assert.equal(
    await dialog
      .getByRole("button", { name: "100 Freestyle", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  if (process.env.VELOCITY_SELECTOR_SCREENSHOTS)
    await dialog.screenshot({ path: "/tmp/velocity-selector-mobile.png" });
  const selectorBounds = await dialog.boundingBox();
  assert.ok(
    selectorBounds.x >= 0 && selectorBounds.x + selectorBounds.width <= 390,
  );
  await dialog
    .getByRole("button", { name: "200 Freestyle relay", exact: true })
    .click();
  await page
    .getByLabel("Selected times filters")
    .getByText("200 Freestyle relay", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Event", exact: true }).click();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(
    await eventSelector
      .getByRole("button", { name: "200 Freestyle relay", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.evaluate(() => window.scrollTo(0, 450));
  const summaryBounds = await summary.boundingBox();
  assert.ok(
    summaryBounds.y >= 0 && summaryBounds.y + summaryBounds.height < 250,
    "The filter summary stays visible under the mobile toolbar while scrolling",
  );
  await page.getByRole("button", { name: "Open navigation sidebar" }).click();
  await timesNav.getByRole("link", { name: "Records", exact: true }).click();
  await timesNav.waitFor({ state: "hidden" });
  const mobileRecords = page.getByRole("region", {
    name: "Records",
    exact: true,
  });
  await mobileRecords
    .getByRole("button", { name: "Render all records", exact: true })
    .click();
  const genderToggle = mobileRecords.getByRole("group", {
    name: "Record gender",
  });
  const girls = genderToggle.getByRole("button", {
    name: "Girls",
    exact: true,
  });
  const boys = genderToggle.getByRole("button", { name: "Boys", exact: true });
  const mobileRecordTable = mobileRecords
    .getByRole("region", { name: "SCY 11–12 record table", exact: true })
    .getByRole("table");
  await mobileRecordTable.waitFor();
  assert.equal(await girls.getAttribute("aria-pressed"), "true");
  assert.deepEqual(
    await mobileRecordTable.getByRole("columnheader").allTextContents(),
    ["Event", "Girls"],
  );
  await mobileRecords.getByRole("link", { name: "SCY 11–12 records" }).click();
  await page.waitForFunction(() => {
    const toggle = document.querySelector('[aria-label="Record gender"]');
    return (
      toggle &&
      Math.abs(
        toggle.getBoundingClientRect().top -
          parseFloat(getComputedStyle(toggle).top),
      ) < 1
    );
  });
  await boys.click();
  assert.equal(await boys.getAttribute("aria-pressed"), "true");
  assert.deepEqual(
    await mobileRecordTable.getByRole("columnheader").allTextContents(),
    ["Event", "Boys"],
  );
  const mobileEvent = mobileRecordTable.getByRole("rowheader", {
    name: "100 Freestyle",
    exact: true,
  });
  const mobileBoysRecord = mobileRecordTable.getByRole("button", {
    name: "View boys 11–12 SCY 100 FR rankings",
    exact: true,
  });
  const [eventBounds, boysBounds] = await Promise.all([
    mobileEvent.boundingBox(),
    mobileBoysRecord.boundingBox(),
  ]);
  assert.ok(
    eventBounds &&
      boysBounds &&
      eventBounds.x + eventBounds.width <= boysBounds.x,
  );
  assert.ok(boysBounds.x + boysBounds.width <= 390);
  await girls.click();
  const mobileLineup = mobileRecords
    .getByRole("list", { name: "Relay swimmers" })
    .first();
  await mobileLineup.scrollIntoViewIfNeeded();
  assert.equal(
    await mobileLineup.evaluate((node) => getComputedStyle(node).fontWeight),
    "650",
    "Relay swimmers are bold like individual record holders",
  );
  const firstMember = await mobileLineup
    .getByRole("listitem")
    .nth(0)
    .boundingBox();
  const secondMember = await mobileLineup
    .getByRole("listitem")
    .nth(1)
    .boundingBox();
  assert.ok(
    firstMember.x + firstMember.width < secondMember.x,
    "Relay member names keep their column gap in narrow record tables",
  );
  await page.close();
  const recovery = await setup({ failure: true });
  await recovery.page.goto(base + "/tools/times");
  await recovery.page.getByRole("table").waitFor();
  assert.equal(
    recovery.calls.filter((q) => q.get("view") === "rankings").length,
    2,
  );
  assert.equal(
    await recovery.page
      .getByRole("button", { name: "Try again", exact: true })
      .count(),
    0,
    "A temporary failure recovers without a manual retry or error popup",
  );
  await recovery.page.close();
  const expiry = await setup({ expiry: true });
  await expiry.page.goto(base + "/tools/times");
  await expiry.page.locator('table[aria-busy="false"]').waitFor();
  const initialRequests = expiry.calls.filter(
    (q) => q.get("view") === "rankings",
  ).length;
  await expiry.page.waitForResponse(
    (r) =>
      r.url().includes("view=rankings") &&
      expiry.calls.filter((q) => q.get("view") === "rankings").length >
        initialRequests,
  );
  assert.equal(
    expiry.calls.filter((q) => q.get("view") === "rankings").length,
    initialRequests + 1,
  );
  await expiry.page.close();
  assert.deepEqual(errors, []);
  console.log(
    "Times browser checks passed: every view, relay/Mixed filters, validated lineup/splits, lead-off parent DQ, course/category resets, ties/ranks, search, cancellation, retries, cache expiry, mobile and keyboard event selection; no bulk downloads.",
  );
} finally {
  await browser.close();
}
