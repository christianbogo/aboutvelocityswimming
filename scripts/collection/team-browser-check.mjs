import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright";
import { localSupabase, assertLocalBackend } from "../local-supabase.mjs";

const config = localSupabase();
const base = process.env.TEAM_TEST_URL ?? "http://127.0.0.1:3001";
assertLocalBackend(base);
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const anon = createClient(config.API_URL, config.PUBLISHABLE_KEY, {
  auth: { persistSession: false },
});
const prefix = `team-check-${randomUUID()}-`;
const email = `${prefix}member@example.test`;
const password = `Local-${randomUUID()}!`;
const meet = prefix + "meet";
const previous = prefix + "previous";
const account = prefix + "account";
const athletes = ["Avery", "Blake", "Casey", "Dana"].map((name, index) => ({
  id: prefix + index,
  name,
}));
const writes = [
  { path: `meets/${meet}`, after: { name: "Team browser meet" } },
  { path: `meets/${previous}`, after: { name: "Previous Team meet" } },
  ...athletes.map(({ id, name }) => ({
    path: `athletes/${id}`,
    after: {
      id,
      name: { first: name, last: "Teamcheck" },
      gender: "F",
      teamId: "velocity-swimming",
      status: "active",
    },
  })),
];
for (const [index, athlete] of athletes.entries()) {
  for (const [event, time] of [
    ["100_FR", 65000 + index * 1000],
    ["50_FR", 30000 + index * 1000],
    ["200_FR", 140000 + index * 2000],
  ]) {
    for (const historical of [true, false]) {
      const id = `${athlete.id}-${event}-${historical}`;
      writes.push({
        path: `swims/${id}`,
        after: {
          id,
          athleteId: athlete.id,
          eventCode: `${event}_SCY`,
          course: "SCY",
          timeMs: time + (historical ? 15000 : 0),
          status: "OK",
          round: "F",
          isOfficial: true,
          isRelay: false,
          gender: "F",
          ageAtSwim: 14,
          teamId: "velocity-swimming",
          raceIdentity: {
            occurrence: id,
            reviewed: true,
            basis: "Team browser fixture",
            sourceUrl: "https://example.test/team",
          },
          meet: {
            id: historical ? previous : meet,
            name: historical ? "Previous Team meet" : "Team browser meet",
            date: historical ? "2026-10-01" : "2026-11-20",
          },
        },
      });
    }
  }
}
writes.push({
  path: `standards/${prefix}standard`,
  after: {
    id: `${prefix}standard`,
    name: "Team motivational fixture",
    governingBody: "USA_Swimming",
    category: "motivational",
    standardType: "age-group",
    seasonYears: "2025–2028",
    effectiveDate: "2025-01-01",
    expirationDate: "2028-12-31",
    sourceUrl: "https://example.test/team-standard",
    cuts: {
      SCY: {
        F: {
          "13-14": Object.fromEntries(
            [
              ["50_FR_SCY", 0.5],
              ["100_FR_SCY", 1],
              ["200_FR_SCY", 2],
            ].map(([event, multiplier]) => [
              event,
              {
                cutsByTier: ["B", "BB", "A", "AA", "AAA", "AAAA"].map(
                  (tierName, index) => ({
                    tierName,
                    timeMs: (100000 - index * 10000) * multiplier,
                    timeDisplay: "",
                  }),
                ),
              },
            ]),
          ),
        },
      },
    },
  },
});
let browser, userId;
try {
  assert.ifError(
    (await admin.rpc("test_write_records", { reads: [], writes })).error,
  );
  assert.ifError(
    (
      await admin
        .from("workshare_accounts")
        .insert({ id: account, full_name: "Team browser account" })
    ).error,
  );
  assert.ifError(
    (
      await admin.from("workshare_athletes").insert([
        ...athletes.map(({ id, name }, index) => ({
          id: id + "-roster",
          account_id: account,
          full_name: `${name} Teamcheck`,
          training_group: ["Prep", "Age Groupers", "Juniors", "Seniors"][index],
          times_athlete_id: id,
          is_archived: false,
        })),
        {
          id: prefix + "unlinked",
          account_id: account,
          full_name: "Unlinked Teamcheck",
          is_archived: false,
          training_group: "Prep",
        },
        {
          id: prefix + "archived",
          account_id: account,
          full_name: "Archived Teamcheck",
          training_group: "Prep",
          is_archived: true,
        },
      ])
    ).error,
  );
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.ifError(created.error);
  userId = created.data.user.id;
  const jar = new Map();
  const auth = createServerClient(config.API_URL, config.PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [...jar.values()],
      setAll: (cookies) =>
        cookies.forEach((cookie) => jar.set(cookie.name, cookie)),
    },
  });
  assert.ifError(
    (await auth.auth.signInWithPassword({ email, password })).error,
  );
  assert.ok(
    (await anon.rpc("team_dashboard")).error,
    "Anonymous roster access must fail",
  );
  const read = await auth.rpc("team_dashboard", { selected_meet: meet });
  assert.ifError(read.error);
  const data = read.data;
  assert.equal(data.meet.id, meet);
  assert.equal(
    data.roster.filter((member) => member.id.startsWith(prefix)).length,
    5,
  );
  assert.ok(
    data.roster.every(
      (member) =>
        Object.keys(member).sort().join() === "athleteId,group,id,name",
    ),
  );
  assert.equal(
    data.bests.filter((race) => race.id.startsWith(prefix)).length,
    12,
  );
  assert.equal(
    data.before.filter((race) => race.id.startsWith(prefix)).length,
    12,
  );
  assert.equal(data.swims.length, 12);
  const latest = await auth.rpc("team_dashboard");
  assert.ifError(latest.error);
  assert.equal(latest.data.meet.id, latest.data.meets[0].id);
  assert.ok(
    (await auth.from("workshare_accounts").select("*")).data.length === 0,
    "Private account tables stay protected",
  );

  browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies(
    [...jar.values()]
      .filter((cookie) => cookie.value)
      .map(({ name, value }) => ({ name, value, url: base, sameSite: "Lax" })),
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*.supabase.co/**", (route) => {
    errors.push("Hosted backend requested");
    return route.abort();
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(base + "/tools/team");
  await page.getByRole("heading", { name: "Rank Counts" }).waitFor();
  assert.ok(
    (await page
      .locator('main[aria-label=Team] [aria-label="Platinum: 2"]')
      .count()) > 0,
  );
  assert.equal(
    await page.getByRole("heading", { name: "Athlete Highlights" }).count(),
    1,
  );
  assert.equal(await page.locator("main[aria-label=Team] article").count(), 3);
  const group = page
    .locator("main[aria-label=Team] details")
    .filter({ has: page.locator(":scope > summary", { hasText: "Prep" }) })
    .first();
  await group.locator(":scope > summary").click();
  await page.getByText("Unlinked Teamcheck", { exact: false }).waitFor();
  assert.equal(
    await page
      .getByRole("link", { name: "Avery Teamcheck" })
      .first()
      .getAttribute("href"),
    `/tools/my-times?myAthlete=${encodeURIComponent(athletes[0].id)}`,
  );
  await page
    .getByRole("combobox", { name: "Meet", exact: true })
    .selectOption(meet);
  await page.getByRole("heading", { name: "Meet Breakdown" }).waitFor();
  await page.getByText("All athletes", { exact: false }).click();
  const athlete = page
    .locator("details")
    .filter({
      has: page.locator(":scope > summary", { hasText: "Avery Teamcheck" }),
    })
    .last();
  await athlete.locator(":scope > summary").click();
  assert.equal(await athlete.locator("li").count(), 3);
  await page.getByText("All event bests", { exact: false }).first().click();
  await mkdir("/tmp/velocity-team-check", { recursive: true });
  await page.screenshot({
    path: "/tmp/velocity-team-check/desktop.png",
    fullPage: true,
  });
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `No overflow at ${width}px`,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const closeNav = page.getByRole("button", {
    name: "Close navigation sidebar",
    exact: true,
  });
  if (await closeNav.isVisible()) await closeNav.click();
  await page
    .getByRole("complementary", { name: "Navigation sidebar" })
    .waitFor({ state: "hidden" });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "/tmp/velocity-team-check/mobile.png",
    fullPage: true,
  });
  // A failed refresh must offer recovery instead of rendering zero counts.
  await page.route("**/api/times/team*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Couldn’t load Team. Please try again." }),
    }),
  );
  await page.reload();
  await page.getByRole("button", { name: "Retry", exact: true }).waitFor();
  await page.unroute("**/api/times/team*");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByRole("heading", { name: "Rank Counts" }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Team database permissions, roster/bests/meet reads, desktop/mobile drill-downs, and retry checks passed.",
  );
} finally {
  await browser?.close();
  assert.ifError(
    (await admin.from("workshare_accounts").delete().eq("id", account)).error,
  );
  assert.ifError(
    (
      await admin.rpc("test_write_records", {
        reads: [],
        writes: [...writes]
          .reverse()
          .map(({ path }) => ({ path, after: null })),
      })
    ).error,
  );
  if (userId) assert.ifError((await admin.auth.admin.deleteUser(userId)).error);
}
