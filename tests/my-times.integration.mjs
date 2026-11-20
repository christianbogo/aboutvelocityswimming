import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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
swim("own-ranked-historical", "owner", 35000, dated(`${year}-08-20`));
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
swim("same-faster-peer", "peer-0", 21000);
swim("historical-male-peer", "peer-0", 12000, { gender: "M" });
swim("own-historical-male", "owner", 42000, {
  ...dated(`${year}-08-19`),
  gender: "M",
});
swim("same-time", "tie", 35000, dated(end + "T23:59:59Z"));
swim("slower", "slower", 50000);
swim("wrong-gender", "wrong-gender", 1000, { gender: "M" });
swim("wrong-age", "wrong-age", 1000, { ageAtSwim: 12 });
swim("wrong-course", "wrong-course", 1000, {
  course: "LCM",
  eventCode: "987_FR_LCM",
});
swim("last-season", "last-season", 1000, dated(`${year}-08-31T23:59:59Z`));
swim("old-archive", "old-archive", 1000, dated(`${history}-06-01`));
swim("dq", "dq", 1000, { status: "DQ" });
swim("split", "split", 1000, { isSplit: true });
swim("flagged", "flagged", 1000);
swim("owner-flagged", "owner", 1000);
swim("owner-split", "owner", 1000, { isSplit: true });
swim("owner-dq", "owner", 1000, { status: "DQ" });
swim("no-age", "no-age", 1000, { ageAtSwim: null });
swim("no-gender", "no-gender", 1000, { gender: null });
swim("aged-up-younger", "aged-up-dq", 1000, {
  ...dated(today + "T23:59:59Z"),
  ageAtSwim: 12,
});
swim("aged-up-dq", "aged-up-dq", 1000, { ...dated(today), status: "DQ" });
for (const [event, age, peerAge] of [
  ["986_FR_SCY", 8, 7],
  ["985_FR_SCY", 19, 24],
]) {
  const extra = { eventCode: event };
  swim(event + "-owner", event, 20000, { ...extra, ageAtSwim: age });
  swim(event + "-peer", event + "-peer", 19000, {
    ...extra,
    ageAtSwim: peerAge,
  });
  swim(event + "-excluded", event + "-excluded", 10000, {
    ...extra,
    ageAtSwim: 16,
  });
}
const genderEvent = { eventCode: "984_FR_SCY" };
swim("gender-profile-f", "gender-profile", 25000, {
  ...genderEvent,
  ...dated(today),
});
swim("gender-profile-m", "gender-profile", 22000, {
  ...genderEvent,
  ...dated(`${year}-08-19`),
  gender: "M",
});
swim("gender-peer-f", "gender-peer-f", 10000, genderEvent);
swim("gender-peer-m", "gender-peer-m", 20000, { ...genderEvent, gender: "M" });
for (const event of ["983_FR_SCY", "982_FR_SCY"]) {
  swim(event + "-old", "self-faster", 60000, {
    ...dated(`${history}-06-01`),
    eventCode: event,
  });
  swim(event + "-new", "self-faster", 50000, { eventCode: event });
}
swim("self-faster-peer", "self-peer", 55000, { eventCode: "983_FR_SCY" });
swim("self-faster-tie", "self-tie", 60000, { eventCode: "983_FR_SCY" });
swim("historical-scy-free", "historical-only-scy", 50000, {
  ...dated(`${history}-06-01`),
  eventCode: "981_FR_SCY",
  ageAtSwim: 13,
});
swim("historical-scy-back", "historical-only-scy", 30000, {
  ...dated(`${history - 1}-06-01`),
  eventCode: "980_BK_SCY",
  ageAtSwim: 9,
});
swim("adult-lcm", "historical-only-scy", 55000, {
  ...dated(today),
  course: "LCM",
  eventCode: "981_FR_LCM",
  ageAtSwim: 19,
});
swim("historical-scy-peer", "historical-scy-peer", 49000, {
  eventCode: "981_FR_SCY",
  ageAtSwim: 14,
});
const query = async (input = {}) => {
  const result = await anon.rpc("ies_my_times_all_time", {
    input: { athleteId, course: "SCY", ...input },
  });
  assert.ifError(result.error);
  return result.data.myTimes;
};
const main = (data) => data.events.find((event) => event.event === "987_FR");
const queryBests = async (input) => {
  const result = await anon.rpc("ies_my_times_bests", {
    input: { athleteId, course: "SCY", ...input },
  });
  assert.ifError(result.error);
  assert.deepEqual(Object.keys(result.data), ["personalBests"]);
  return result.data.personalBests;
};

try {
  assert.ifError(
    (await admin.rpc("test_write_records", { reads: [], writes })).error,
  );
  assert.ifError(
    (
      await admin.from("result_moderation").insert(
        ["flagged", "owner-flagged"].map((id) => ({
          result_type: "swim",
          result_id: prefix + id,
          flagged: true,
          version: 1,
        })),
      )
    ).error,
  );

  await test("My Times ranks the displayed best in its recorded age group", async () => {
    const data = await query();
    assert.equal(data.period, "all");
    assert.equal(data.seasonStart, undefined);
    assert.equal(data.latestAge, 13);
    assert.equal(data.latestAgeGroup, "13-14");
    assert.equal(main(data).race.id, prefix + "after-history");
    assert.equal(main(data).rankRace.id, prefix + "after-history");
    assert.equal(main(data).allTimeRank, 1);
    assert.equal(main(data).allTimeCount, 1);
    assert.equal(main(data).rankGender, "F");
    assert.equal(main(data).rankAgeGroup, "9-10");
    assert.equal(
      data.events.find((row) => row.event === "989_FR").allTimeRank,
      1,
    );
    assert.deepEqual(data.ages, [7, 8, 9, 12, 13]);
  });

  await test("age/year selections rank their displayed swim against complete age-group history", async () => {
    const aged = await query({ ageAtSwim: 12 });
    assert.equal(main(aged).race.id, prefix + "own-younger");
    assert.equal(main(aged).rankRace.id, prefix + "own-younger");
    assert.equal(main(aged).rankAgeGroup, "11-12");
    assert.equal(main(aged).allTimeRank, 3);
    assert.equal(main(aged).allTimeCount, 3);
    const latestAge = await query({ ageAtSwim: 13 });
    assert.equal(main(latestAge).race.id, prefix + "own-ranked-historical");
    assert.equal(main(latestAge).allTimeRank, 108);
    const range = await query({
      startYear: String(history),
      endYear: String(history),
    });
    assert.equal(main(range).race.id, prefix + "history-last");
    assert.equal(main(range).rankAgeGroup, "8&U");
    assert.equal(main(range).allTimeRank, 1);
    assert.equal(main(range).allTimeCount, 1);
    assert.equal(range.events.find((row) => row.event === "989_FR").race, null);
    const empty = await query({ ageAtSwim: 99 });
    assert.equal(empty.events.length, 3);
    assert.ok(empty.events.every((row) => row.race === null));
    assert.equal(main(empty).allTimeRank, null);
    assert.equal(main(empty).allTimeCount, 0);
    assert.equal(main(empty).rankRace, null);
    const oldest = await query({ endYear: String(history - 1) });
    assert.equal(main(oldest).race.id, prefix + "before-history");
    const unknown = await query({ athleteId: prefix + "unknown" });
    assert.deepEqual(unknown.events, []);
    assert.equal(unknown.latestAgeGroup, null);
    const noAge = await query({ athleteId: prefix + "no-age" });
    assert.equal(noAge.latestAgeGroup, null);
    assert.equal(main(noAge).allTimeRank, null);
    assert.equal(main(noAge).race.time, 1000);
    const noGender = await query({ athleteId: prefix + "no-gender" });
    assert.equal(main(noGender).allTimeRank, null);
    const agedUp = await query({ athleteId: prefix + "aged-up-dq" });
    assert.equal(agedUp.latestAgeGroup, "13-14");
    assert.equal(main(agedUp).allTimeRank, 1);
    assert.equal(main(agedUp).rankAgeGroup, "11-12");
    assert.equal(main(agedUp).race.id, prefix + "aged-up-younger");
  });

  await test("age ranges choose bests across the complete range and rank by the swim's primary bucket", async () => {
    for (const [ageGroup, id, rankGroup] of [
      ["8&U", "before-history", "8&U"],
      ["9-10", "after-history", "9-10"],
      ["11-12", "own-younger", "11-12"],
      ["13-14", "own-ranked-historical", "13-14"],
      ["15-16", null, null],
      ["17-18", null, null],
      ["19&O", null, null],
      ["10&U", "after-history", "9-10"],
      ["12&U", "after-history", "9-10"],
      ["13&O", "own-ranked-historical", "13-14"],
      ["15&O", null, null],
      ["Open", "after-history", "9-10"],
    ]) {
      const data = await query({ ageGroup });
      assert.equal(main(data).race?.id ?? null, id ? prefix + id : null);
      assert.equal(main(data).rankAgeGroup, rankGroup);
      assert.equal(data.events.length, 3);
    }
    for (const filter of [
      { ageGroup: "unknown" },
      { ageGroup: "11-12", ageAtSwim: 12 },
      { ageGroup: "11-12", startYear: String(history) },
      { ageGroup: "11-12", endYear: String(history) },
    ]) {
      const result = await anon.rpc("ies_my_times_all_time", {
        input: { athleteId, ...filter },
      });
      assert.ok(result.error);
    }
  });

  await test("a filtered slower swim never ranks behind the same athlete's faster swim", async () => {
    const data = await query({
      athleteId: prefix + "self-faster",
      startYear: String(history),
      endYear: String(history),
    });
    const withPeers = data.events.find(({ event }) => event === "983_FR");
    assert.equal(withPeers.race.id, prefix + "983_FR_SCY-old");
    assert.equal(withPeers.rankRace.id, withPeers.race.id);
    assert.equal(withPeers.allTimeRank, 2);
    assert.equal(withPeers.allTimeCount, 3);
    const alone = data.events.find(({ event }) => event === "982_FR");
    assert.equal(alone.allTimeRank, 1);
    assert.equal(alone.allTimeCount, 1);
  });

  await test("an adult's latest LCM swim does not remove ranks from historical age-group SCY bests", async () => {
    const data = await query({ athleteId: prefix + "historical-only-scy" });
    assert.equal(data.latestAge, 19);
    assert.equal(data.latestAgeGroup, "19&O");
    assert.equal(data.events.length, 2);
    const free = data.events.find(({ event }) => event === "981_FR");
    assert.equal(free.race.id, prefix + "historical-scy-free");
    assert.equal(free.rankAgeGroup, "13-14");
    assert.equal(free.allTimeRank, 2);
    assert.equal(free.allTimeCount, 2);
    const back = data.events.find(({ event }) => event === "980_BK");
    assert.equal(back.rankAgeGroup, "9-10");
    assert.equal(back.allTimeRank, 1);
    assert.equal(back.allTimeCount, 1);
  });

  await test("personal-bests-only reads preserve filtered public results without a rank payload", async () => {
    for (const [filter, expectedRace] of [
      [{ ageAtSwim: 12 }, "own-younger"],
      [{ ageAtSwim: 13 }, "own-ranked-historical"],
      [{ ageAtSwim: 99 }, null],
      [
        { startYear: String(history), endYear: String(history) },
        "history-last",
      ],
      [
        { startYear: String(history - 1), endYear: String(history + 1) },
        "after-history",
      ],
      [{ athleteId: prefix + "unknown", ageAtSwim: 13 }, null],
    ]) {
      const [legacy, personalBests] = await Promise.all([
        query(filter),
        queryBests(filter),
      ]);
      const rankedBests = legacy.events
        .filter(({ race }) => race !== null)
        .map(({ event, race }) => ({ event, race }));
      assert.deepEqual(personalBests, rankedBests);
      assert.equal(
        personalBests.find(({ event }) => event === "987_FR")?.race.id ?? null,
        expectedRace ? prefix + expectedRace : null,
      );
    }
    const lcm = await queryBests({ course: "LCM", ageAtSwim: 13 });
    assert.deepEqual(
      lcm.map(({ race }) => race.id),
      [prefix + "own-latest-lcm"],
    );
  });

  await test("all-time ranks include the full 8-and-under and 19-and-over cohorts", async () => {
    for (const [event, ageGroup] of [
      ["986_FR", "8&U"],
      ["985_FR", "19&O"],
    ]) {
      const data = await query({ athleteId: prefix + event + "_SCY" });
      assert.equal(data.latestAgeGroup, ageGroup);
      assert.equal(data.events[0].rankAgeGroup, ageGroup);
      assert.equal(data.events[0].allTimeRank, 2);
      assert.equal(data.events[0].allTimeCount, 2);
    }
  });

  await test("the swim's historical gender determines its ranking cohort", async () => {
    const data = await query({ athleteId: prefix + "gender-profile" });
    const [event] = data.events;
    assert.equal(event.rankRace.id, prefix + "gender-profile-m");
    assert.equal(event.rankGender, "M");
    assert.equal(event.allTimeRank, 2);
    assert.equal(event.allTimeCount, 2);
  });

  await test("all-time card ranks match complete Event Rankings, including historical results and ties", async () => {
    const selected = main(await query({ ageAtSwim: 13 }));
    const result = await anon.rpc("ies_times_query", {
      query_kind: "rankings",
      input: {
        team: "velocity-swimming",
        course: "SCY",
        event: "987_FR",
        genders: ["F"],
        ageGroups: ["13-14"],
        mode: "bests",
        offset: 100,
        limit: 25,
      },
    });
    assert.ifError(result.error);
    assert.equal(result.data.total, 110);
    assert.equal(selected.allTimeCount, result.data.total);
    assert.equal(
      result.data.rows.find(({ race }) => race.athleteId === athleteId).rank,
      selected.allTimeRank,
    );
    assert.equal(
      result.data.rows.find(({ race }) => race.athleteId === prefix + "tie")
        .rank,
      108,
    );
    assert.equal(
      result.data.rows.find(({ race }) => race.athleteId === prefix + "slower")
        .rank,
      110,
    );
    assert.ok(
      !(
        await anon.rpc("ies_my_times_all_time", {
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
  await test("the deployed season RPC and its response contract remain intact", async () => {
    const legacy = await anon.rpc("ies_my_times", {
      input: { athleteId, course: "SCY" },
    });
    assert.ifError(legacy.error);
    const data = legacy.data.myTimes;
    assert.equal(data.seasonStart, start);
    assert.equal(data.seasonEnd, end);
    assert.equal(main(data).seasonRace.id, prefix + "own-current");
    assert.equal(main(data).seasonRank, 107);
    assert.equal(main(data).seasonCount, 108);
    assert.equal(main(data).allTimeRank, undefined);
  });

  await test("batched My Times preserves the complete previous JSON across historical cohorts and filters", () => {
    const previous = readFileSync(
      new URL("../supabase/migrations/20261118182230_my_times_displayed_swim_rank.sql", import.meta.url),
      "utf8",
    ).split("revoke all on function")[0].replace(
      "public.ies_my_times_all_time(input",
      "pg_temp.previous_my_times_all_time(input",
    );
    const result = execFileSync("docker", [
      "exec", "-i", process.env.VELOCITY_SUPABASE_DB_CONTAINER ?? "supabase_db_aboutvelocityswimming",
      "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt",
    ], {
      input: `BEGIN;\n${previous}\nSET LOCAL ROLE anon;
        WITH inputs AS (
          SELECT jsonb_build_object('athleteId', a.id, 'course', c.course) || f.filter AS input
          FROM public.public_athletes a
          CROSS JOIN (VALUES ('SCY'), ('LCM')) c(course)
          CROSS JOIN (VALUES ('{}'::jsonb), ('{"ageAtSwim":12}'), ('{"ageAtSwim":13}'),
            ('{"ageAtSwim":99}'), ('{"ageGroup":"8&U"}'), ('{"ageGroup":"Open"}'),
            (jsonb_build_object('startYear','${history}','endYear','${history}'))) f(filter)
          WHERE a.id LIKE '${prefix}%'
        )
        SELECT count(*) FROM inputs
        WHERE public.ies_my_times_all_time(input) IS DISTINCT FROM pg_temp.previous_my_times_all_time(input);
        ROLLBACK;`,
      encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    assert.equal(result.trim(), "0", "Every full response must equal the previous implementation.");
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
      await admin.rpc("test_write_records", {
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
