import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const config = JSON.parse(
  execFileSync("supabase", ["status", "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
);
assert.equal(
  config.API_URL,
  "http://127.0.0.1:54321",
  "My Times fixtures require local Supabase.",
);
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const anon = createClient(config.API_URL, config.PUBLISHABLE_KEY, {
  auth: { persistSession: false },
});
const prefix = "my-times-data-fixture-";
const today = new Date().toLocaleDateString("en-CA", {
  timeZone: "America/Los_Angeles",
});
const year =
  Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 9 ? 1 : 0);
const start = `${year}-09-01`,
  end = `${year + 1}-08-31`,
  history = year - 2;
const athleteId = prefix + "owner";
const writes = [
  { path: "meets/" + prefix + "meet", after: { name: "My Times fixture" } },
];
const athletes = new Set();
function swim(id, athlete, time, extra = {}) {
  const owner = prefix + athlete;
  if (!athletes.has(owner)) {
    athletes.add(owner);
    writes.push({
      path: "athletes/" + owner,
      after: {
        id: owner,
        name: { first: "My Times Fixture", last: athlete },
        gender: "F",
        teamId: "velocity-swimming",
        status: "active",
      },
    });
  }
  const data = {
    id: prefix + id,
    athleteId: owner,
    raceIdentity: {
      occurrence: id,
      reviewed: true,
      basis: "Independent local test swims",
      sourceUrl: "https://example.test/my-times",
    },
    eventCode: "987_FR_SCY",
    course: "SCY",
    timeMs: time,
    status: "OK",
    round: "F",
    isOfficial: true,
    isRelay: false,
    gender: "F",
    ageAtSwim: 13,
    teamId: "velocity-swimming",
    meet: { id: prefix + "meet", name: "My Times fixture", date: start },
    ...extra,
  };
  writes.push({ path: "swims/" + data.id, after: data });
}
const dated = (date) => ({
  meet: { id: prefix + "meet", name: "My Times fixture", date },
});
swim("own-current", "owner", 40000, dated(today));
swim("own-younger", "owner", 15000, { ageAtSwim: 12 });
swim("own-latest-lcm", "owner", 60000, {
  ...dated(today),
  course: "LCM",
  eventCode: "987_FR_LCM",
});
swim("history-first", "owner", 7000, {
  ...dated(`${history}-01-01`),
  ageAtSwim: 8,
});
swim("history-last", "owner", 6000, {
  ...dated(`${history}-12-31T23:59:59Z`),
  ageAtSwim: 8,
});
swim("before-history", "owner", 5000, {
  ...dated(`${history - 1}-12-31`),
  ageAtSwim: 7,
});
swim("after-history", "owner", 4000, {
  ...dated(`${history + 1}-01-01`),
  ageAtSwim: 9,
});
swim("past-event", "owner", 30000, {
  ...dated(`${history}-06-01`),
  eventCode: "988_FR_SCY",
  ageAtSwim: 8,
});
swim("younger-event", "owner", 30000, {
  eventCode: "989_FR_SCY",
  ageAtSwim: 12,
});
for (let i = 0; i < 105; i++)
  swim("faster-" + i, "peer-" + i, 20000 + i, { isOfficial: i !== 0 });
swim("same-time", "tie", 40000, dated(end + "T23:59:59Z"));
swim("slower", "slower", 50000);
swim("wrong-gender", "wrong-gender", 1000, { gender: "M" });
swim("wrong-age", "wrong-age", 1000, { ageAtSwim: 12 });
swim("wrong-course", "wrong-course", 1000, {
  course: "LCM",
  eventCode: "987_FR_LCM",
});
swim("last-season", "last-season", 1000, dated(`${year}-08-31T23:59:59Z`));
swim("next-season", "next-season", 1000, dated(`${year + 1}-09-01`));
swim("dq", "dq", 1000, { status: "DQ" });
swim("split", "split", 1000, { isSplit: true });
swim("flagged", "flagged", 1000);
swim("no-age", "no-age", 1000, { ageAtSwim: null });
swim("no-gender", "no-gender", 1000, { gender: null });
swim("aged-up-younger", "aged-up-dq", 1000, {
  ...dated(today + "T23:59:59Z"),
  ageAtSwim: 12,
});
swim("aged-up-dq", "aged-up-dq", 1000, { ...dated(today), status: "DQ" });
const query = async (input = {}) => {
  const result = await anon.rpc("ies_my_times", {
    input: { athleteId, course: "SCY", ...input },
  });
  assert.ifError(result.error);
  return result.data.myTimes;
};
const main = (data) => data.events.find((event) => event.event === "987_FR");

try {
  assert.ifError(
    (await admin.rpc("collect_records", { reads: [], writes })).error,
  );
  assert.ifError(
    (
      await admin.from("result_moderation").insert([
        {
          result_type: "swim",
          result_id: prefix + "flagged",
          flagged: true,
          version: 1,
        },
      ])
    ).error,
  );

  await test("My Times ranks the complete current-season cohort in the latest recorded age group", async () => {
    const data = await query();
    assert.equal(data.seasonStart, start);
    assert.equal(data.seasonEnd, end);
    assert.equal(data.seasonAge, 13);
    assert.equal(data.seasonAgeGroup, "13-14");
    assert.equal(main(data).race.id, prefix + "after-history");
    assert.equal(main(data).seasonRace.id, prefix + "own-current");
    assert.equal(main(data).seasonRank, 106);
    assert.equal(main(data).seasonCount, 108);
    assert.equal(main(data).rankGender, "F");
    assert.equal(main(data).rankAgeGroup, "13-14");
    assert.equal(
      data.events.find((row) => row.event === "989_FR").seasonRank,
      null,
    );
    assert.deepEqual(data.ages, [7, 8, 9, 12, 13]);
  });

  await test("personal-best filters preserve event cards and never change the current-season rank", async () => {
    const aged = await query({ ageAtSwim: 12 });
    assert.equal(main(aged).race.id, prefix + "own-younger");
    assert.equal(main(aged).seasonRank, 106);
    const range = await query({
      startYear: String(history),
      endYear: String(history),
    });
    assert.equal(main(range).race.id, prefix + "history-last");
    assert.equal(main(range).seasonRank, 106);
    assert.equal(range.events.find((row) => row.event === "989_FR").race, null);
    const empty = await query({ ageAtSwim: 99 });
    assert.equal(empty.events.length, 3);
    assert.ok(empty.events.every((row) => row.race === null));
    assert.equal(main(empty).seasonRank, 106);
    const oldest = await query({ endYear: String(history - 1) });
    assert.equal(main(oldest).race.id, prefix + "before-history");
    const unknown = await query({ athleteId: prefix + "unknown" });
    assert.deepEqual(unknown.events, []);
    assert.equal(unknown.seasonAgeGroup, null);
    const noAge = await query({ athleteId: prefix + "no-age" });
    assert.equal(noAge.seasonAgeGroup, null);
    assert.equal(main(noAge).seasonRank, null);
    assert.equal(main(noAge).race.time, 1000);
    const noGender = await query({ athleteId: prefix + "no-gender" });
    assert.equal(main(noGender).seasonRank, null);
    const agedUp = await query({ athleteId: prefix + "aged-up-dq" });
    assert.equal(agedUp.seasonAgeGroup, "13-14");
    assert.equal(main(agedUp).seasonRank, null);
    assert.equal(main(agedUp).race.id, prefix + "aged-up-younger");
  });

  await test("season card ranks match date-bounded Event Rankings, including ties and end dates", async () => {
    const result = await anon.rpc("ies_times_query", {
      query_kind: "rankings",
      input: {
        team: "velocity-swimming",
        course: "SCY",
        event: "987_FR",
        genders: ["F"],
        ageGroups: ["13-14"],
        startDate: start,
        endDate: end,
        mode: "bests",
        offset: 100,
        limit: 25,
      },
    });
    assert.ifError(result.error);
    assert.equal(result.data.total, 108);
    assert.equal(
      result.data.rows.find(({ race }) => race.athleteId === athleteId).rank,
      106,
    );
    assert.equal(
      result.data.rows.find(({ race }) => race.athleteId === prefix + "tie")
        .rank,
      106,
    );
    assert.equal(
      result.data.rows.find(({ race }) => race.athleteId === prefix + "slower")
        .rank,
      108,
    );
    assert.ok(
      !(
        await anon.rpc("ies_my_times", {
          input: { athleteId, ageAtSwim: 12, startYear: String(history) },
        })
      ).data,
    );
    const noDates = await anon.rpc("ies_times_query", {
      query_kind: "rankings",
      input: {
        team: "velocity-swimming",
        course: "SCY",
        event: "987_FR",
        genders: ["F"],
        startDate: "",
        endDate: "",
        mode: "bests",
        offset: 0,
        limit: 25,
      },
    });
    assert.ifError(noDates.error);
  });
} finally {
  assert.ifError(
    (
      await admin
        .from("result_moderation")
        .delete()
        .like("result_id", prefix + "%")
    ).error,
  );
  const people = await admin
    .from("athletes")
    .select("person_id")
    .like("id", prefix + "%");
  assert.ifError(people.error);
  assert.ifError(
    (
      await admin.rpc("collect_records", {
        reads: [],
        writes: [
          ...[...writes].reverse().map(({ path }) => ({ path, after: null })),
          ...people.data.map(({ person_id }) => ({
            path: "people/" + person_id,
            after: null,
          })),
        ],
      })
    ).error,
  );
}
