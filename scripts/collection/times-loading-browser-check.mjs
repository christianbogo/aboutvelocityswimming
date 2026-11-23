import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright";

// Start the isolated frontend with synthetic configuration (no actual keys):
// VELOCITY_TEST_BUILD=true NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54329 \
// NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=fixture npm run dev -- --hostname 127.0.0.1 --port 3001
// This check owns that otherwise-empty backend port and never opens a database.
const base = process.env.VELOCITY_LOADING_URL ?? "http://127.0.0.1:3001";
const authPort = Number(process.env.VELOCITY_LOADING_AUTH_PORT ?? 54329);
const widths = process.env.VELOCITY_LOADING_WIDTH
  ? [Number(process.env.VELOCITY_LOADING_WIDTH)]
  : [1440, 390];
const requestedViews = process.env.VELOCITY_LOADING_VIEWS?.split(",");
const views = [
  ["my-times", "Times"],
  ["rankings", "Rankings"],
  ["records", "Records"],
  ["standards", "Standards"],
].filter(([view]) => !requestedViews || requestedViews.includes(view));
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
assert.ok(
  views.length &&
    widths.every((width) => Number.isSafeInteger(width) && width >= 320),
);

const individualEvents = [
  "100_IM",
  "200_IM",
  "400_IM",
  "50_FL",
  "100_FL",
  "200_FL",
  "50_BK",
  "100_BK",
  "200_BK",
  "50_BR",
  "100_BR",
  "200_BR",
  "50_FR",
  "100_FR",
  "200_FR",
  "500_FR",
  "1000_FR",
  "1650_FR",
];
const recordEvents = [
  ...individualEvents,
  // The default 13-14 board omits the 100-yard relays reserved for 8 & under.
  "200_FR-R",
  "400_FR-R",
  "800_FR-R",
  "200_MED-R",
  "400_MED-R",
];
const cuts = {
  cutsByTier: ["B", "BB", "A", "AA", "AAA", "AAAA"].map((tierName, index) => ({
    tierName,
    timeMs: 80000 - index * 10000,
  })),
};
const standard = {
  id: "loading-standard",
  name: "2024–2028 USA Swimming Age Group Motivational Standards",
  governingBody: "USA_Swimming",
  category: "motivational",
  standardType: "age-group",
  effectiveDate: "2024-09-01",
  expirationDate: "2028-12-31",
  sourceUrl: "https://example.test/standards",
  cuts: Object.fromEntries(
    ["SCY", "LCM", "SCM"].map((course) => [
      course,
      {
        F: {
          "13-14": Object.fromEntries(
            individualEvents.map((event) => [`${event}_${course}`, cuts]),
          ),
        },
      },
    ]),
  ),
};
const athlete = {
  id: "loading-athlete",
  name: "Taylor Swimmer",
  team_name: "Velocity Swimming",
  is_primary: true,
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
  refresh_token: "loading-fixture-refresh",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: expires,
  user,
};

function race(event, course = "SCY", extra = {}) {
  return {
    id: `${course}-${event}`,
    athleteId: athlete.id,
    athleteName: athlete.name,
    date: "2026-11-18",
    event,
    course,
    time:
      (course === "LCM" ? 60000 : course === "SCM" ? 55000 : 50000) +
      (event === "100_FR" ? 0 : 1000),
    status: "OK",
    round: "F",
    team: "velocity-swimming",
    gender: "F",
    ageAtSwim: 13,
    official: true,
    relay: event.endsWith("-R"),
    meetId: "loading-meet",
    meet: "Loading fixture meet",
    ...extra,
  };
}

function gate(name) {
  let held = true;
  let arrivals = 0;
  let pending = [];
  let observers = [];
  return {
    get count() {
      return arrivals;
    },
    hold() {
      held = true;
    },
    release() {
      held = false;
      pending.splice(0).forEach((resolve) => resolve());
    },
    async enter() {
      arrivals++;
      observers.splice(0).forEach((notify) => notify());
      if (held) await new Promise((resolve) => pending.push(resolve));
    },
    async waitForCount(count) {
      if (arrivals >= count) return;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () =>
            reject(
              new Error(`No ${name} request ${count}; observed ${arrivals}`),
            ),
          15000,
        );
        const observe = () => {
          if (arrivals < count) {
            observers.push(observe);
            return;
          }
          clearTimeout(timeout);
          resolve();
        };
        observers.push(observe);
      });
    },
  };
}

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

async function fixture(width) {
  const context = await browser.newContext({
    viewport: { width, height: width < 768 ? 844 : 1000 },
    reducedMotion: "reduce",
  });
  for (const name of ["sb-127-auth-token", "sb-localhost-auth-token"]) {
    await context.addCookies([
      {
        name,
        value:
          "base64-" +
          Buffer.from(JSON.stringify(session)).toString("base64url"),
        url: base,
        sameSite: "Lax",
      },
    ]);
  }
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const controls = {
    standards: gate("standards"),
    athletes: gate("followed athletes"),
    rankings: gate("rankings"),
    years: gate("ranking years"),
    records: gate("records"),
    SCY: gate("SCY personal bests"),
    LCM: gate("LCM personal bests"),
    SCM: gate("SCM personal bests"),
  };
  let ttl = 60000;
  const active = new Set();
  function intercept(pattern, handler) {
    return context.route(pattern, (route) => {
      const work = handler(route);
      active.add(work);
      void work.then(
        () => active.delete(work),
        () => active.delete(work),
      );
      return work;
    });
  }
  const json = (route, body) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  await context.route("**/*", (route) =>
    ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  await intercept("**/auth/v1/**", async (route) =>
    json(
      route,
      new URL(route.request().url()).pathname.endsWith("/user")
        ? user
        : session,
    ),
  );
  await intercept("**/rest/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body = [];
    if (path.endsWith("/standards")) {
      await controls.standards.enter();
      body = [{ id: standard.id, data: standard }];
    }
    if (path.endsWith("/get_account_athletes")) {
      await controls.athletes.enter();
      body = [athlete];
    }
    if (path.endsWith("/is_staff")) body = true;
    await json(route, body);
  });
  await intercept("**/api/times?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const view = params.get("view");
    const course = params.get("course") || "SCY";
    let body = {};
    if (view === "my_times") {
      await controls[course].enter();
      body = {
        myTimes: {
          period: "all",
          athleteId: athlete.id,
          ages: [13],
          years: ["2026"],
          latestAge: 13,
          latestAgeGroup: "13-14",
          events: individualEvents.map((event, index) => ({
            event,
            race: race(event, course),
            rankRace: race(event, course),
            allTimeRank: index + 1,
            allTimeCount: 100,
            rankAgeGroup: "13-14",
            rankGender: "F",
          })),
        },
      };
    } else if (view === "rankings") {
      await controls.rankings.enter();
      body = {
        rows: Array.from({ length: 25 }, (_, index) => ({
          rank: index + 1,
          race: race(params.get("event") || "100_FR", course, {
            id: `ranking-${course}-${index}`,
            athleteId: `ranking-${index}`,
            athleteName: `Taylor Swimmer ${index + 1}`,
            time: 50000 + index * 1000,
          }),
        })),
        total: 25,
      };
    } else if (view === "ranking_years" || view === "facets") {
      await controls.years.enter();
      body = {
        years: ["2026"],
        events: individualEvents,
        relayAges: [],
        relayEvents: [],
      };
    } else if (view === "records_board") {
      await controls.records.enter();
      const races = recordEvents.flatMap((event) =>
        ["F", "M"].map((gender) =>
          race(event, "SCY", {
            id: `record-${gender}-${event}`,
            athleteId: `record-${gender}`,
            gender,
            ...(event.endsWith("-R")
              ? {
                  members: [1, 2, 3, 4].map((leg) => ({
                    leg,
                    name: `Swimmer ${leg}`,
                  })),
                }
              : {}),
          }),
        ),
      );
      body = {
        races,
        records: Object.fromEntries(
          races.map((r) => [`SCY:13-14:${r.event}:${r.gender}`, [r.id]]),
        ),
        recordsUpdatedAt: "2026-11-18T12:00:00Z",
      };
    }
    await json(route, { ...body, expiresAt: Date.now() + ttl });
  });
  return {
    page,
    controls,
    errors,
    shortExpiry() {
      ttl = 1100;
    },
    longExpiry() {
      ttl = 60000;
    },
    async settleRequests() {
      await Promise.allSettled([...active]);
    },
    async close() {
      Object.values(controls).forEach((control) => control.release());
      await Promise.allSettled([...active]);
      await context.close();
    },
  };
}

async function noOverflow(page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
    "page overflows horizontally",
  );
}
function nearBounds(before, after, { height = 2, top = 2, width = 2 } = {}) {
  assert.ok(before && after, "expected measurable layout");
  assert.ok(
    Math.abs(before.x - after.x) <= width,
    `layout left edge moved from ${before.x} to ${after.x}`,
  );
  assert.ok(
    Math.abs(before.width - after.width) <= width,
    `layout width changed from ${before.width} to ${after.width}`,
  );
  assert.ok(
    Math.abs(before.y - after.y) <= top,
    `layout top edge moved from ${before.y} to ${after.y}`,
  );
  assert.ok(
    Math.abs(before.height - after.height) <= height,
    `layout height changed from ${before.height} to ${after.height}`,
  );
}
async function relativeBounds(locator, container) {
  const box = await locator.boundingBox();
  const origin = await container.boundingBox();
  assert.ok(box && origin);
  return { ...box, x: box.x - origin.x, y: box.y - origin.y };
}
async function frames(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}
async function loadingState(page, region, view) {
  const placeholder = region.locator(`[data-loading-skeleton="${view}"]`);
  await placeholder.waitFor();
  assert.equal(await placeholder.count(), 1, "duplicate loading trees");
  if (view === "records") {
    // Record event labels remain useful while the result values are loading.
    assert.ok(await placeholder.locator('[aria-hidden="true"]').count());
  } else {
    assert.equal(await placeholder.getAttribute("aria-hidden"), "true");
  }
  assert.ok(
    (await region.locator('[aria-busy="true"]').count()) ||
      (await region.getAttribute("aria-busy")) === "true",
  );
  assert.equal(
    await region.getByRole("status").filter({ hasText: /\S/ }).count(),
    1,
    "loading needs one accessible status",
  );
  await noOverflow(page);
  const before = await placeholder.boundingBox();
  assert.ok(
    before && before.width > 200 && before.height > 150,
    "placeholder does not reserve meaningful content space",
  );
  await frames(page);
  nearBounds(before, await placeholder.boundingBox(), {
    height: 1,
    top: 1,
    width: 1,
  });
  const animationCount = await placeholder.evaluate(
    (root) =>
      [root, ...root.querySelectorAll("*")].filter(
        (el) => getComputedStyle(el).animationName !== "none",
      ).length,
  );
  assert.equal(
    animationCount,
    0,
    "reduced motion must stop placeholder animations",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  assert.ok(
    await placeholder.evaluate((root) =>
      [root, ...root.querySelectorAll("*")].some(
        (el) => getComputedStyle(el).animationName !== "none",
      ),
    ),
    "normal-motion placeholder never uses its loading animation",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  return { before, placeholder };
}
async function collapseMobileNavigation(page) {
  const close = page.getByRole("button", {
    name: "Close navigation sidebar",
    exact: true,
  });
  if (await close.isVisible()) await close.click();
}
async function ready(region, view) {
  await region
    .locator(`[data-loading-skeleton="${view}"]`)
    .waitFor({ state: "hidden" });
  await region
    .page()
    .waitForFunction(
      (element) =>
        element.getAttribute("aria-busy") !== "true" &&
        !element.querySelector('[aria-busy="true"]'),
      await region.elementHandle(),
    );
  await frames(region.page());
}
async function unchangedRefresh(f, region, view, request, content) {
  const count = request.count;
  request.hold();
  const before = await content.boundingBox();
  await request.waitForCount(count + 1);
  assert.equal(
    await region.locator(`[data-loading-skeleton="${view}"]`).count(),
    0,
    "background refresh replaced known content with skeletons",
  );
  nearBounds(before, await content.boundingBox(), {
    height: 1,
    top: 1,
    width: 1,
  });
  const response = f.page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/times" &&
      url.searchParams.get("view") ===
        (view === "my-times"
          ? "my_times"
          : view === "records"
            ? "records_board"
            : "rankings")
    );
  });
  f.longExpiry();
  request.release();
  await response;
  await frames(f.page);
}

async function highlightsView(f, width) {
  const { page, controls } = f;
  f.longExpiry();
  await page.goto(`${base}/tools/my-times`);
  const region = page.getByRole("region", { name: "Times", exact: true });
  await region.waitFor();
  if (width < 768) await collapseMobileNavigation(page);
  await ready(region, "my-times");
  await region
    .getByRole("button", { name: "View: Highlights", exact: true })
    .waitFor();
  const highlights = region.getByRole("region", {
    name: "Highlights",
    exact: true,
  });
  const featured = highlights.locator('[data-highlight-size="featured"]');
  const compact = highlights.locator('[data-highlight-size="compact"]');
  assert.equal(await featured.count(), 3);
  assert.equal(await compact.count(), 5);
  assert.equal(
    await highlights
      .getByRole("button", { name: /^View .* rankings$/ })
      .count(),
    8,
  );
  assert.equal(
    await featured.first().getAttribute("aria-label"),
    "View 100 Freestyle rankings",
    "The achieved standard outranks the smaller team rank in another event",
  );
  await featured
    .first()
    .getByText("Loading fixture meet", { exact: true })
    .waitFor();
  await featured.first().getByText("AA standard", { exact: true }).waitFor();
  await featured.first().getByText("#14", { exact: true }).waitFor();
  await highlights
    .getByRole("region", { name: "Standards achieved", exact: true })
    .getByText(new RegExp(`^of ${individualEvents.length} events `))
    .waitFor();
  await highlights
    .getByRole("region", { name: "Stroke coverage", exact: true })
    .waitFor();
  assert.equal(await highlights.getByRole("region").count(), 2);
  const cardGeometry = await highlights
    .locator("[data-highlight-size]")
    .evaluateAll((cards) =>
      cards.map((card) => {
        const bounds = card.getBoundingClientRect();
        const escaped = [...card.querySelectorAll("*")]
          .filter(
            (child) => !child.closest(".sr-only") && child.checkVisibility(),
          )
          .filter((child) => {
            const box = child.getBoundingClientRect();
            return (
              box.left < bounds.left - 1 ||
              box.right > bounds.right + 1 ||
              box.top < bounds.top - 1 ||
              box.bottom > bounds.bottom + 1
            );
          })
          .map((child) => `${child.tagName}: ${child.textContent}`);
        return {
          name: card.getAttribute("aria-label"),
          size: card.getAttribute("data-highlight-size"),
          display: getComputedStyle(card).display,
          direction: getComputedStyle(card).flexDirection,
          height: bounds.height,
          overflow: card.scrollWidth > card.clientWidth + 1,
          escaped,
        };
      }),
    );
  for (const card of cardGeometry) {
    assert.ok(
      card.display === "grid" ||
        (width < 768 &&
          card.size === "featured" &&
          card.display === "flex" &&
          card.direction === "column"),
      `${card.name} retains a structured card layout`,
    );
    assert.ok(
      card.height < (width >= 768 ? 550 : 650),
      `${card.name} has a bounded height`,
    );
    assert.equal(
      card.overflow,
      false,
      `${card.name} has no horizontal overflow`,
    );
    assert.deepEqual(
      card.escaped,
      [],
      `${card.name} contains every visible detail`,
    );
  }
  await noOverflow(page);
  await page.screenshot({
    path: `/tmp/velocity-highlights-${width}.png`,
    fullPage: true,
    animations: "disabled",
  });

  // Reusing the same results for each view must preserve filters and not refetch.
  await region
    .getByRole("button", { name: "Course: Short Course Yards", exact: true })
    .click();
  await region
    .getByRole("button", { name: "Long Course Meters", exact: true })
    .click();
  await ready(region, "my-times");
  const before = new URL(page.url());
  const requests = controls.LCM.count;
  await region
    .getByRole("button", { name: "View: Highlights", exact: true })
    .press("ArrowDown");
  await region
    .getByRole("group", { name: "View options", exact: true })
    .getByRole("button", { name: "Bests Grid", exact: true })
    .click();
  await region
    .getByRole("button", { name: "View: Bests Grid", exact: true })
    .waitFor();
  assert.equal(new URL(page.url()).searchParams.get("myView"), "bests-grid");
  assert.equal(
    new URL(page.url()).searchParams.get("myFilters"),
    before.searchParams.get("myFilters"),
  );
  assert.equal(
    await region.getByRole("button", { name: /^View .* rankings$/ }).count(),
    individualEvents.length,
  );
  await region
    .getByRole("button", { name: "View: Bests Grid", exact: true })
    .press("ArrowDown");
  await region
    .getByRole("group", { name: "View options", exact: true })
    .getByRole("button", { name: "Highlights", exact: true })
    .click();
  await highlights.waitFor();
  assert.equal(new URL(page.url()).searchParams.has("myView"), false);
  assert.equal(
    new URL(page.url()).searchParams.get("myFilters"),
    before.searchParams.get("myFilters"),
  );
  assert.equal(controls.LCM.count, requests);
  await noOverflow(page);

  // A highlight keeps the same event/age/course rankings destination as the grid.
  await featured.first().click();
  await page.waitForURL((url) => url.pathname === "/tools/rankings");
  const selection = JSON.parse(new URL(page.url()).searchParams.get("filters"));
  assert.equal(selection.event, "100_FR");
  assert.equal(selection.course, "LCM");
  assert.deepEqual(selection.genders, ["F"]);
  assert.deepEqual(selection.ageGroups, ["13-14"]);
  console.log(
    `Highlights: ${width}px default, 3+5 cards, aggregates, view switching and rankings navigation passed.`,
  );
}

try {
  const failures = [];
  for (const width of widths) {
    for (const [view, label] of views) {
      const f = await fixture(width);
      const { page, controls } = f;
      try {
        f.shortExpiry();
        await page.goto(
          `${base}/tools/${view}${view === "my-times" ? "?myView=bests-grid" : ""}`,
        );
        const region = page.getByRole("region", { name: label, exact: true });
        await region.waitFor();
        if (width < 768) await collapseMobileNavigation(page);
        const loading = await loadingState(page, region, view);
        const initialRegionBounds = await region.boundingBox();
        await page.screenshot({
          path: `/tmp/velocity-${view}-loading-${width}.png`,
          fullPage: true,
          animations: "disabled",
        });
        if (view === "my-times") {
          await controls.athletes.waitForCount(1);
          assert.equal(
            await region
              .getByRole("button", { name: /^View .* rankings$/ })
              .count(),
            0,
          );
          controls.athletes.release();
          await controls.SCY.waitForCount(1);
          await loadingState(page, region, view);
          controls.SCY.release();
          await region
            .getByRole("button", {
              name: "View 100 Freestyle rankings",
              exact: true,
            })
            .waitFor();
          const card = region.getByRole("button", {
            name: "View 100 Freestyle rankings",
            exact: true,
          });
          const withoutIcons = await card.boundingBox();
          controls.standards.release();
          await ready(region, view);
          nearBounds(withoutIcons, await card.boundingBox(), {
            height: 2,
            top: 2,
            width: 2,
          });
          assert.equal(
            await region
              .getByRole("button", { name: /^View .* rankings$/ })
              .count(),
            individualEvents.length,
          );
          await unchangedRefresh(f, region, view, controls.SCY, card);
          const previousCard = await relativeBounds(card, region);
          await page.screenshot({
            path: `/tmp/velocity-my-times-before-filter-${width}.png`,
            fullPage: true,
            animations: "disabled",
          });
          // A late response for an abandoned course must not replace the new
          // course's placeholders or results, even when it arrives last.
          await region
            .getByRole("button", {
              name: "Course: Short Course Yards",
              exact: true,
            })
            .click();
          await region
            .getByRole("button", { name: "Long Course Meters", exact: true })
            .click();
          await controls.LCM.waitForCount(1);
          await loadingState(page, region, view);
          const placeholderCard = await relativeBounds(
            region
              .locator("[data-loading-card]")
              .filter({ hasText: "100 Free" }),
            region,
          );
          console.log(
            JSON.stringify({
              view,
              width,
              knownCard: { before: previousCard, loading: placeholderCard },
            }),
          );
          nearBounds(previousCard, placeholderCard, {
            height: 1,
            top: 2,
            width: 1,
          });
          await region
            .getByRole("button", {
              name: "Course: Long Course Meters",
              exact: true,
            })
            .click();
          await region
            .getByRole("button", { name: "Short Course Meters", exact: true })
            .click();
          await controls.SCM.waitForCount(1);
          controls.SCM.release();
          await ready(region, view);
          assert.ok((await card.innerText()).includes("55.00"));
          controls.LCM.release();
          await f.settleRequests();
          await frames(page);
          assert.ok((await card.innerText()).includes("55.00"));
          assert.equal(
            await region
              .getByRole("button", { name: /^View .* rankings$/ })
              .count(),
            individualEvents.length,
          );
          // The same valid query should return from the client cache without
          // inserting a decorative loading tree during browser Back.
          const requestsBeforeBack = controls.SCM.count;
          await page.evaluate(() => {
            window.loadingFlashes = 0;
            window.loadingObserver = new MutationObserver((records) => {
              for (const record of records)
                for (const node of record.addedNodes) {
                  if (node.nodeType !== Node.ELEMENT_NODE) continue;
                  if (
                    node.matches('[data-loading-skeleton="my-times"]') ||
                    node.querySelector('[data-loading-skeleton="my-times"]')
                  )
                    window.loadingFlashes++;
                }
            });
            window.loadingObserver.observe(document.body, {
              childList: true,
              subtree: true,
            });
          });
          if (width < 768)
            await page
              .getByRole("button", {
                name: "Open navigation sidebar",
                exact: true,
              })
              .click();
          await page
            .getByRole("navigation", { name: "Tools navigation", exact: true })
            .getByRole("link", { name: "Standards", exact: true })
            .click();
          await page
            .getByRole("region", { name: "Standards", exact: true })
            .waitFor();
          await page.goBack();
          await card.waitFor();
          await frames(page);
          assert.equal(
            await page.evaluate(() => window.loadingFlashes),
            0,
            "fresh cache flashed a loading tree on Back",
          );
          assert.equal(controls.SCM.count, requestsBeforeBack);
          await page.evaluate(() => window.loadingObserver.disconnect());
        } else if (view === "rankings") {
          await controls.rankings.waitForCount(1);
          const table = region.getByRole("table");
          assert.equal(
            await table.locator('tbody[aria-hidden="true"] tr').count(),
            25,
          );
          assert.equal(
            await table
              .getByRole("link", { name: /^View Times profile for / })
              .count(),
            0,
          );
          const before = await table.boundingBox();
          controls.years.release();
          controls.standards.release();
          controls.rankings.release();
          await ready(region, view);
          assert.equal(
            await table
              .getByRole("link", { name: /^View Times profile for / })
              .count(),
            25,
          );
          assert.equal(
            await table.locator('tbody[aria-hidden="true"] tr').count(),
            0,
          );
          nearBounds(before, await table.boundingBox(), {
            height: before.height * 0.35 + 80,
            top: 36,
            width: before.width * 0.1 + 2,
          });
          await unchangedRefresh(f, region, view, controls.rankings, table);
        } else if (view === "records") {
          await controls.records.waitForCount(1);
          const table = region.getByRole("table");
          const before = await table.boundingBox();
          assert.equal(
            await table.locator("tbody tr").count(),
            recordEvents.length,
          );
          assert.equal(
            await table
              .getByRole("button", { name: /^View (girls|boys) / })
              .count(),
            0,
          );
          controls.records.release();
          await ready(region, view);
          assert.equal(
            await table.locator("tbody tr").count(),
            recordEvents.length,
          );
          assert.equal(
            await table
              .getByRole("button", { name: /^View (girls|boys) / })
              .count(),
            recordEvents.length * (width < 768 ? 1 : 2),
          );
          nearBounds(before, await table.boundingBox(), {
            height: before.height * 0.25 + 80,
            top: 36,
            width: 2,
          });
          await unchangedRefresh(f, region, view, controls.records, table);
        } else {
          await controls.standards.waitForCount(1);
          assert.equal(
            await region
              .getByRole("button", { name: "Standard", exact: true })
              .count(),
            0,
          );
          controls.standards.release();
          await ready(region, view);
          const cut = region.getByLabel("100 Freestyle: 1:20.00", {
            exact: true,
          });
          await cut.waitFor();
          assert.equal(
            await region.locator('[aria-label$=": 1:20.00"]').count(),
            individualEvents.length,
          );
          controls.standards.hold();
          const count = controls.standards.count;
          const before = await region.boundingBox();
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          await controls.standards.waitForCount(count + 1);
          assert.equal(await region.getAttribute("aria-busy"), "true");
          assert.equal(
            await region.locator('[data-loading-skeleton="standards"]').count(),
            0,
          );
          assert.ok(await cut.isVisible());
          nearBounds(before, await region.boundingBox(), {
            height: 1,
            top: 1,
            width: 1,
          });
          controls.standards.release();
          await ready(region, view);
        }
        assert.equal(
          await loading.placeholder.count(),
          0,
          "placeholder remained alongside real content",
        );
        const after = await region.boundingBox();
        assert.ok(
          Math.abs(after.width - initialRegionBounds.width) <= 1,
          "resolved region changed its reserved width",
        );
        if (view === "my-times" || view === "standards") {
          assert.ok(
            Math.abs(after.height - loading.before.height) <=
              loading.before.height * 0.55 + 160,
            "unknown first-load placeholder reserves an implausible final height",
          );
        }
        await page.screenshot({
          path: `/tmp/velocity-${view}-loaded-${width}.png`,
          fullPage: true,
          animations: "disabled",
        });
        await noOverflow(page);
        if (view === "my-times") await highlightsView(f, width);
        assert.deepEqual(f.errors, []);
        console.log(
          `${label}: ${width}px delayed loading, reduced motion, stable replacement and refresh passed.`,
        );
      } catch (error) {
        await page.screenshot({
          path: `/tmp/velocity-${view}-loading-failure-${width}.png`,
          fullPage: true,
          animations: "disabled",
        });
        failures.push(`${label} ${width}px: ${error.stack ?? error}`);
        console.error(`${label} ${width}px failed: ${error.message}`);
      } finally {
        await f.close();
      }
    }
  }
  assert.equal(failures.length, 0, failures.join("\n\n"));
  console.log(
    "Times loading: desktop/mobile placeholders, dependency delays, rapid filters, background refresh and reduced motion passed.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => authServer.close(resolve));
}
