import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  prepareHeldObservations,
  splitObservationRequests,
  stageHeldObservations,
} from "../scripts/collection/load-held-observations.mjs";

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

test("archives observed fields and statuses without member IDs or inferred race-day age", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "velocity-held-observations-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archiveRoot = join(directory, "originals");
  const acquisition = join(directory, "acquisition-confirmed");
  await Promise.all([mkdir(archiveRoot), mkdir(acquisition)]);
  const swimmerId = "022913JONADUPE";
  const relayId = "048912CYPADFIC";
  const date = "11/2/2025";
  const base = {
    "LSC-Team": "IE-CUDA",
    "Competitive Category": "Female",
    "Age Group": "15-16",
    Date: date,
  };
  const captureBase = {
    meetId: "29",
    capturedAt: "2025-11-03T00:00:00Z",
    meet: { name: "Archive Fixture", startsOn: "2025-11-01", endsOn: "2025-11-03", course: "SCY" },
  };
  const timedRow = {
    ...base, "Athlete Name": "Swimmer, Test", "#ID": swimmerId, "Age": 17, "Event Age": 15,
    Distance: 50, Stroke: "Free", Prelim: "29.50Y", Final: "28.79Y", "Final Position": 2,
  };
  const individual = {
    ...captureBase,
    tab: "individuals",
    file: "fixture-individuals.xls",
    sha256: sha256("individual fixture"),
    rows: [
      { sourceRow: 1, row: timedRow, roundDetails: { P: { ageAtSwim: 15 }, F: { ageAtSwim: 15 } } },
      { sourceRow: 2, row: { ...timedRow, Prelim: "", Final: "DNF" } },
      { sourceRow: 3, row: { ...timedRow, Prelim: "", Final: "29.05Y L" } },
    ],
  };
  const relay = {
    ...captureBase,
    tab: "relays",
    file: "fixture-relays.xls",
    sha256: sha256("relay fixture"),
    rows: [{ sourceRow: 1, row: {
      ...base, "Relay Team": "A", "Athletes": `Fixture, Relay\n${relayId}\n\nAnother, Relay\n022913J******X`,
      Distance: 200, Stroke: "Free Relay", Final: "1:57.21Y",
    }, roundDetails: { F: { isOfficial: false } } }],
  };
  const holds = [
    { locator: `meet/29/swim/xls/${individual.sha256.slice(0, 24)}/1/P`, reason: "Preliminary date is ambiguous" },
    { locator: `meet/29/swim/xls/${individual.sha256.slice(0, 24)}/2/F`, reason: "Source reports Did not finish (DNF)" },
    { locator: `meet/29/swim/xls/${individual.sha256.slice(0, 24)}/3/F`, reason: "Relay lead-off lacks verified parent" },
    { locator: `meet/29/relay/xls/${relay.sha256.slice(0, 24)}/1/F`, reason: "No awarded final place" },
  ];
  const holdReceipt = JSON.stringify({ holds, distinctHeldSourceObservations: holds.length });
  const coverage = JSON.stringify({ tabsWithGoMotionVelocityOrBarracuda: 2 });
  const audit = join(directory, "audit.json");
  await Promise.all([
    writeFile(join(archiveRoot, individual.file), "individual fixture"),
    writeFile(join(archiveRoot, relay.file), "relay fixture"),
    writeFile(join(acquisition, "coverage.json"), coverage),
    writeFile(join(acquisition, "joined-scoped-captures.json"), JSON.stringify([individual, relay])),
    writeFile(join(directory, "holds.json"), holdReceipt),
    writeFile(audit, JSON.stringify({
      heldOrNonfinishSourceObservations: 4,
      normalizedSourceReceipt: { file: "holds.json", sha256: sha256(holdReceipt) },
      sourceCoverageReceipt: { file: "acquisition-confirmed/coverage.json", sha256: sha256(coverage) },
      holdReasons: Object.fromEntries(holds.map(({ reason }) => [reason, 1])),
    })),
  ]);

  const { observations, verifiedWorkbooks } = await prepareHeldObservations(audit, archiveRoot);
  const [preliminary, didNotFinish, leadOff, teamRelay] = observations;
  assert.equal(verifiedWorkbooks, 2);
  assert.equal(preliminary.clubCode, "CUDA");
  assert.equal(preliminary.memberIdHash, sha256(swimmerId).slice(0, 24));
  assert.equal(preliminary.observed.raceDate, undefined);
  assert.equal(preliminary.observed.isOfficial, undefined);
  assert.equal(preliminary.observed.eventAge, 15);
  assert.equal(preliminary.observed.age, undefined);
  assert.equal(preliminary.observed.timeMs, 29500);
  assert.equal(preliminary.observed.awardedFinalPlace, undefined);
  assert.equal(didNotFinish.sourceStatus, "DNF");
  assert.equal(didNotFinish.observed.timeMs, undefined);
  assert.equal(didNotFinish.observed.awardedFinalPlace, undefined);
  assert.equal(leadOff.observed.leadOff, true);
  assert.equal(leadOff.observed.awardedFinalPlace, 2);
  assert.equal(teamRelay.observed.raceDate, "2025-11-02");
  assert.equal(teamRelay.observed.isOfficial, false);
  assert.equal(teamRelay.observed.raw.Athletes, "Fixture, Relay\nAnother, Relay");
  assert.equal(teamRelay.observed.eventCode, "200_FR-R_SCY");
  assert.doesNotMatch(JSON.stringify(observations), new RegExp(`#ID|${swimmerId}|${relayId}|022913J`));

  await writeFile(join(archiveRoot, relay.file), "changed original");
  await assert.rejects(prepareHeldObservations(audit, archiveRoot), /Missing the checksummed source workbook/);
});

test("batch receipts reconcile a partial replay and reject missing accounting", async () => {
  const rows = Array.from({ length: 502 }, (_, id) => ({ id }));
  const requests = splitObservationRequests(rows);
  assert.deepEqual(requests.map((request) => request.length), [250, 250, 2]);
  const stored = new Set();
  const client = {
    rpc(name, { worker_token: token, observations }) {
      assert.equal(name, "stage_velocity_held_observations");
      assert.equal(token, "fixture");
      return {
        abortSignal() {
          const before = stored.size;
          for (const { id } of observations) stored.add(id);
          const inserted = stored.size - before;
          return { data: { inserted, duplicates: observations.length - inserted } };
        },
      };
    },
  };
  assert.deepEqual(await stageHeldObservations({
    client, workerToken: "fixture", requests: [requests[0]],
  }), { inserted: 250, duplicates: 0 });
  assert.deepEqual(await stageHeldObservations({ client, workerToken: "fixture", requests }), {
    inserted: 252, duplicates: 250,
  });
  assert.deepEqual(await stageHeldObservations({ client, workerToken: "fixture", requests }), {
    inserted: 0, duplicates: 502,
  });
  await assert.rejects(stageHeldObservations({
    client: { rpc: () => ({ abortSignal: () => ({ data: { inserted: 0, duplicates: 0 } }) }) },
    workerToken: "fixture",
    requests,
  }), /unexpected receipt/);
});

test("preserves complete legacy padded member identities without accepting masked name codes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "velocity-held-member-padding-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archiveRoot = join(directory, "originals");
  const acquisition = join(directory, "acquisition-confirmed");
  await Promise.all([mkdir(archiveRoot), mkdir(acquisition)]);
  const ids = [
    ["010101JO**LI**", true], // Short first/last names and unknown middle initial.
    ["010101J**MZ***", true], // One-letter name codes still contain real letters.
    ["A1b2C3d4E5f6G7", true], // Modern opaque IDs keep their existing behavior.
    ["**************", false],
    ["010101***AABCD", false], // A first-name code cannot be entirely missing.
    ["010101ABCA****", false], // A surname code cannot be entirely missing.
    ["010101J*OAABCD", false], // Padding cannot replace an interior character.
    ["010101ABCALI*X", false],
    ["ABCDEFJO**LI**", false],
    ["**0101JO**LI**", false],
    ["010101JO**LI*", false],
    ["010101JO**LI**", true, "DQ", "F"],
    ["010101JO**LI**", true, "NS", "F"],
    ["010101JO**LI**", true, "", "none"],
  ];
  const contents = "synthetic member identifier fixture";
  const checksum = sha256(contents);
  const capture = {
    meetId: "30", tab: "individuals", file: "synthetic-identifiers.xls", sha256: checksum,
    capturedAt: "2025-09-14T00:00:00Z",
    meet: { name: "Synthetic Fixture", startsOn: "2025-09-13", endsOn: "2025-09-13", course: "SCY" },
    rows: ids.map(([member, , result = "28.79Y"], index) => ({ sourceRow: index + 1, row: {
      "LSC-Team": "IE-VS", "Athlete Name": "Li, Jo", "#ID": member,
      "Competitive Category": "Female", "Age Group": "Open", Date: "9/13/2025",
      Distance: 50, Stroke: "Free", Final: result,
    } })),
  };
  const holds = ids.map(([, , , round = "F"], index) => ({
    locator: `meet/30/swim/xls/${checksum.slice(0, 24)}/${index + 1}${round === "none" ? "" : `/${round}`}`,
    reason: `Synthetic source identity ${index}`,
  }));
  const receipt = JSON.stringify({ holds, distinctHeldSourceObservations: holds.length });
  const coverage = JSON.stringify({ tabsWithGoMotionVelocityOrBarracuda: 1 });
  const audit = join(directory, "audit.json");
  await Promise.all([
    writeFile(join(archiveRoot, capture.file), contents),
    writeFile(join(acquisition, "joined-scoped-captures.json"), JSON.stringify([capture])),
    writeFile(join(acquisition, "coverage.json"), coverage),
    writeFile(join(directory, "holds.json"), receipt),
    writeFile(audit, JSON.stringify({
      heldOrNonfinishSourceObservations: holds.length,
      normalizedSourceReceipt: { file: "holds.json", sha256: sha256(receipt) },
      sourceCoverageReceipt: { file: "acquisition-confirmed/coverage.json", sha256: sha256(coverage) },
      holdReasons: Object.fromEntries(holds.map(({ reason }) => [reason, 1])),
    })),
  ]);
  const { observations } = await prepareHeldObservations(audit, archiveRoot);
  const archived = JSON.stringify(observations);
  ids.forEach(([member, complete, result, round = "F"], index) => {
    assert.equal(observations[index].memberIdHash, complete ? sha256(member).slice(0, 24) : null);
    assert.equal(archived.includes(member), false);
    assert.equal(observations[index].observed.ageAtSwim, undefined);
    assert.equal(observations[index].round, round);
    if (result === "DQ" || result === "NS") assert.equal(observations[index].sourceStatus, result);
    if (round === "none") assert.equal(observations[index].sourceStatus, null);
  });
});
