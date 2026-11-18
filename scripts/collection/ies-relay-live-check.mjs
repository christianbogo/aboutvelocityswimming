import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { eventLabel } from "../../src/components/collection/times-data.ts";

const base = process.env.VELOCITY_LIVE_TEST_URL;
assert.ok(
  base,
  "Set VELOCITY_LIVE_TEST_URL to the new deployed site's URL after publishing imports.",
);
const site = new URL(base);
assert.equal(site.protocol, "https:", "Live verification requires HTTPS.");
const prepared = resolve(
  process.env.VELOCITY_RELAYS_PREPARED_DIR ??
    "backups/ies-relays/2026-10-13/prepared",
);
const output = resolve(
  process.env.VELOCITY_LIVE_TEST_OUTPUT ??
    "backups/ies-relays/2026-10-13/live-browser",
);
const relays = JSON.parse(
  await readFile(resolve(prepared, "relay-results.json"), "utf8"),
);
const leadOffs = [];
let splitUpdate;
for (const file of (await readdir(resolve(prepared, "batches"))).sort()) {
  if (!file.endsWith(".json")) continue;
  const batch = JSON.parse(
    await readFile(resolve(prepared, "batches", file), "utf8"),
  );
  for (const write of batch.writes ?? []) {
    if (write.after?.resultOrigin === "relay_leadoff")
      leadOffs.push({ id: write.path.slice("swims/".length), ...write.after });
    if (
      !splitUpdate &&
      write.path.startsWith("swims/") &&
      write.after?.isRelay === false &&
      write.after?.status === "OK" &&
      write.after?.splitCoverage === "complete" &&
      write.after?.splits?.length
    )
      splitUpdate = {
        id: write.path.slice("swims/".length),
        ...write.after,
      };
  }
}
assert.ok(
  leadOffs.length,
  "Prepared verified lead-offs are required for this release check.",
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(30000);
const errors = [];
const apiFailures = [];
const apiResponses = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => {
  const url = new URL(response.url());
  if (url.pathname === "/api/times") {
    if (response.status() >= 400)
      apiFailures.push({
        status: response.status(),
        view: url.searchParams.get("view"),
      });
    apiResponses.push({
      view: url.searchParams.get("view"),
      params: Object.fromEntries(url.searchParams),
      status: response.status(),
    });
  }
});

async function times(view, input = {}) {
  const params = new URLSearchParams({ view });
  for (const [key, value] of Object.entries(input))
    params.set(key, String(value));
  const response = await page.request.get(
    new URL("/api/times?" + params, base).href,
  );
  assert.equal(response.status(), 200, "Live API failed for " + view);
  return response.json();
}
function publicRace(race) {
  assert.ok(race && race.id, "Expected a published public race.");
  const forbidden = [
    "sourceObservation",
    "sourceRecords",
    "metadata",
    "leadOffVerification",
    "birthDate",
    "dob",
    "registration",
    "email",
    "privateRegistration",
  ];
  for (const key of forbidden)
    assert.ok(!Object.hasOwn(race, key), "Private field exposed: " + key);
  for (const member of race.members ?? []) {
    assert.ok(
      Object.keys(member).every((key) =>
        [
          "leg",
          "athleteId",
          "name",
          "gender",
          "stroke",
          "timeMs",
          "leadOffEligible",
        ].includes(key),
      ),
      "Unexpected public member field.",
    );
  }
  for (const split of race.splits ?? [])
    assert.ok(
      Object.keys(split).every((key) =>
        ["distance", "cumulativeMs", "lapMs"].includes(key),
      ),
      "Unexpected public split field.",
    );
}
async function chooseEvent(label, event) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: eventLabel(event), exact: true })
    .click();
}
async function fullScreenshot(file) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        window.scrollTo({ top: 0, behavior: "instant" });
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
  await page.screenshot({ path: resolve(output, file), fullPage: true });
}
try {
  const facets = await times("facets");
  assert.ok(
    facets.relayEvents?.length,
    "Relay facets must contain published events.",
  );
  const mixed = await times("rankings", {
    relay: true,
    course: "SCY",
    event: "200_MED-R",
    genders: "X",
    mode: "performances",
    limit: 25,
  });
  assert.ok(
    mixed.total > 0 && mixed.rows.length,
    "Mixed medley relay rankings must exist.",
  );
  for (const { race } of mixed.rows) {
    publicRace(race);
    assert.equal(race.relay, true);
    assert.equal(race.gender, "X");
    assert.equal(race.athleteId, "");
  }
  const selectedMixed = mixed.rows.find(
    ({ race }) => race.members?.length === 4 && race.splits?.length,
  )?.race;
  assert.ok(
    selectedMixed,
    "A first-page mixed relay with members and splits is needed.",
  );
  assert.ok(
    relays.some((race) => race.id === selectedMixed.id),
    "Selected public relay must match the reviewed import.",
  );

  const velocityRecords = await times("records", { team: "velocity-swimming" });
  const relayRecord = velocityRecords.races.find(
    (race) => race.relay && race.gender !== "X" && race.members?.length === 4,
  );
  assert.ok(
    relayRecord,
    "Velocity relay records need a complete reported lineup.",
  );
  publicRace(relayRecord);
  let lead, eligible;
  for (const candidate of leadOffs) {
    const current = await times("race", { raceId: candidate.id });
    if (current.rows?.[0]?.race) {
      lead = candidate;
      eligible = current.rows[0].race;
      break;
    }
  }
  assert.ok(
    lead && eligible,
    "At least one verified lead-off must be published as an individual result.",
  );
  publicRace(eligible);
  assert.equal(eligible.relay, false);
  assert.equal(eligible.resultOrigin, "relay_leadoff");
  assert.equal(eligible.parentRelayResultId, lead.parentRelayResultId);
  assert.ok(splitUpdate, "A reviewed individual split update is required.");
  const individualResult = await times("race", { raceId: splitUpdate.id });
  const individual = individualResult.rows?.[0]?.race;
  publicRace(individual);
  assert.equal(individual.relay, false);
  assert.equal(individual.splitCoverage, "complete");
  assert.deepEqual(individual.splits, splitUpdate.splits);
  await page.goto(new URL("/tools/times", base).href);
  await page.getByRole("table").first().waitFor();
  await page.getByRole("button", { name: "Relays", exact: true }).click();
  await page.getByRole("button", { name: "Mixed", exact: true }).click();
  await page.getByRole("button", { name: "Female", exact: true }).click();
  await chooseEvent("Event", "200_MED-R");
  const lineup = page.getByRole("list", { name: "Relay swimmers" }).first();
  await lineup.waitFor();
  assert.equal(await lineup.getByRole("listitem").count(), 4);
  await fullScreenshot("mixed-relay-lineup.png");

  await page.getByRole("link", { name: "Records", exact: true }).click();
  await page.getByRole("region", { name: "Records" }).waitFor();
  for (const member of relayRecord.members) {
    await page
      .getByRole("region", { name: "Records" })
      .locator("small")
      .filter({ hasText: member.name })
      .first()
      .waitFor();
  }
  await page
    .getByRole("region", { name: "Records" })
    .locator("small")
    .filter({ hasText: relayRecord.members[0].name })
    .first()
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(output, "velocity-relay-records.png"),
    fullPage: false,
  });

  await page.getByRole("button", { name: "Rankings", exact: true }).click();
  await page
    .getByRole("button", { name: individual.course, exact: true })
    .click();
  await chooseEvent("Event", individual.event);
  if (individual.gender === "M") {
    await page.getByRole("button", { name: "Male", exact: true }).click();
    await page.getByRole("button", { name: "Female", exact: true }).click();
  }
  await page.getByRole("button", { name: "Performances", exact: true }).click();
  await page
    .getByLabel("Search athletes", { exact: true })
    .fill(individual.athleteName);
  await page
    .getByRole("link", {
      name: `View Times profile for ${individual.athleteName}`,
      exact: true,
    })
    .first()
    .click();
  await page.waitForURL(
    (url) =>
      url.pathname === "/tools/my-times" &&
      url.searchParams.get("myAthlete") === individual.athleteId,
  );
  await fullScreenshot("individual-times-profile.png");
  assert.deepEqual(errors, [], "Unexpected browser errors.");
  assert.deepEqual(apiFailures, [], "Unexpected API failures.");
  const result = {
    checkedAt: new Date().toISOString(),
    url: base,
    mixedRelayCount: mixed.total,
    mixedMeetId: selectedMixed.meetId,
    mixedRelayId: selectedMixed.id,
    relayRecordId: relayRecord.id,
    individualSplitResultId: individual.id,
    verifiedLeadOffId: lead.id,
    parentRelayId: parent.id,
    athleteId: lead.athleteId,
    athleteName: eligible.athleteName,
    apiCalls: apiResponses,
    errors,
    apiFailures,
  };
  await writeFile(
    resolve(output, "verification.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    "Live relay browser verification passed: " +
      JSON.stringify({
        mixedRelays: mixed.total,
        athlete: eligible.athleteName,
        leadOff: lead.id,
        output,
      }),
  );
} catch (error) {
  await page
    .screenshot({ path: resolve(output, "failure.png"), fullPage: true })
    .catch(() => {});
  await writeFile(
    resolve(output, "failure.json"),
    JSON.stringify(
      {
        error: error.message,
        pageUrl: page.url(),
        errors,
        apiFailures,
        apiResponses,
      },
      null,
      2,
    ) + "\n",
  );
  throw error;
} finally {
  await browser.close();
}
