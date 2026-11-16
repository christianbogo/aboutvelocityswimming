import test from "node:test";
import { execFileSync } from "node:child_process";

// Synthetic, rollback-only checks. This container name cannot target hosting.
function check(sql) {
  try {
    return execFileSync("docker", ["exec", "-i", "supabase_db_aboutvelocityswimming", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt"], {
      input: `BEGIN;\n${fixture}\n${sql}\nROLLBACK;`,
      encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(error.stderr?.toString() || error.message);
  }
}
const fixture = `
-- Match bulk publication: these checks concern records, not per-row PB rebuilds.
SELECT set_config('velocity.defer_bests','true',true);
-- Keep this rollback-only fixture independent from the shared Velocity seed.
DELETE FROM public.public_swims;
DELETE FROM public.public_relay_results;
CREATE FUNCTION pg_temp.check_ok(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%',message; END IF; END; $$;
SELECT private.put_record('teams/velocity-swimming','{"name":"Record cache fixture","lscCode":"IE"}');
SELECT private.put_record('meets/record-cache-meet','{"name":"Record fixture"}');
SELECT private.put_record('athletes/record-cache-a','{"id":"record-cache-a","name":{"first":"First","last":"Fixture"},"status":"active","teamId":"velocity-swimming"}');
SELECT private.put_record('athletes/record-cache-b','{"id":"record-cache-b","name":{"first":"Second","last":"Fixture"},"status":"active","teamId":"velocity-swimming"}');
CREATE FUNCTION pg_temp.swim(rid text, athlete text, ms integer, extra jsonb default '{}') RETURNS void LANGUAGE sql AS $$
  SELECT private.put_record('swims/'||rid,jsonb_build_object('id',rid,'athleteId',athlete,'teamId','velocity-swimming',
    'eventCode','100_FR_SCY','course','SCY','timeMs',ms,'status','OK','round','F','isRelay',false,'isOfficial',true,'gender','F','ageAtSwim',12,
    'raceIdentity',jsonb_build_object('occurrence',rid,'reviewed',true,'basis','Independent synthetic starts','sourceUrl','https://example.test/records'),
    'meet',jsonb_build_object('id','record-cache-meet','name','Record fixture','date','2026-10-01'),
    'sourceObservation',jsonb_build_object('private','never-public'))||extra);
$$;
CREATE FUNCTION pg_temp.board() RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.ies_team_records_board('{"team":"velocity-swimming"}');
$$;
SELECT pg_temp.swim('record-cache-first','record-cache-a',60000);
SELECT pg_temp.swim('record-cache-tie','record-cache-b',60000);
SELECT private.refresh_team_records();
`;

test("reads reuse the stored board; imports queue one refresh and preserve ties", () => check(`
  SELECT pg_temp.check_ok(jsonb_array_length(pg_temp.board()#>'{records,SCY:11-12:100_FR:F}')=2,'initial ties');
  SELECT pg_temp.check_ok(NOT private.refresh_team_records(),'unchanged database skips work');
  SELECT pg_temp.swim('record-cache-faster','record-cache-a',55000);
  SELECT pg_temp.swim('record-cache-faster-tie','record-cache-b',55000);
  SELECT pg_temp.check_ok((SELECT count(*)=1 FROM private.team_record_refresh_queue WHERE transaction_id=txid_current()),'one marker per import transaction');
  SET LOCAL ROLE anon;
  SELECT pg_temp.check_ok(pg_temp.board()#>>'{records,SCY:11-12:100_FR:F,0}'='record-cache-first','page reads previous board without computing');
  SELECT pg_temp.check_ok(public.ies_times_query('record_teams')->'teams' @> '[["velocity-swimming","Record cache fixture"]]','Velocity record scope');
  RESET ROLE;
  SELECT pg_temp.check_ok(private.refresh_team_records(),'queued refresh runs');
  SET LOCAL ROLE anon;
  SELECT pg_temp.check_ok(pg_temp.board()#>>'{records,SCY:11-12:100_FR:F,0}'='record-cache-faster','new record published');
  SELECT pg_temp.check_ok(jsonb_array_length(pg_temp.board()#>'{records,SCY:Open:100_FR:F}')=2,'overlapping age groups retain ties');
  SELECT pg_temp.check_ok(NOT (pg_temp.board()::text LIKE '%never-public%'),'private source evidence stays private');
  RESET ROLE;
  SELECT pg_temp.check_ok(NOT private.refresh_team_records(),'subsequent reads require no rebuild');
`));

test("flagged, edited, hidden and deleted holders disappear before the next refresh", () => check(`
  INSERT INTO public.result_moderation VALUES('swim','record-cache-first',true,1);
  SET LOCAL ROLE anon;
  SELECT pg_temp.check_ok(NOT (pg_temp.board()::text LIKE '%record-cache-first%'),'flag hides cached winner immediately');
  RESET ROLE;
  SELECT pg_temp.swim('record-cache-tie','record-cache-b',70000,'{"ageAtSwim":14}');
  SET LOCAL ROLE anon;
  SELECT pg_temp.check_ok(jsonb_array_length(pg_temp.board()->'races')=0,'corrected time and age are not attributed to old record');
  RESET ROLE;
  SELECT private.refresh_team_records();
  SELECT pg_temp.check_ok(pg_temp.board()#>>'{records,SCY:13-14:100_FR:F,0}'='record-cache-tie','refresh promotes corrected result in correct age group');
  UPDATE public.result_moderation SET flagged=false,version=2 WHERE result_id='record-cache-first';
  SELECT private.refresh_team_records();
  DELETE FROM public.public_swims WHERE id='record-cache-first';
  DELETE FROM public.public_athletes WHERE id='record-cache-a';
  SET LOCAL ROLE anon;
  SELECT pg_temp.check_ok(NOT (pg_temp.board()::text LIKE '%record-cache-first%'),'removed public athlete is not disclosed');
  SELECT pg_temp.check_ok(NOT EXISTS(SELECT 1 FROM public.team_record_holders WHERE result_id='record-cache-first'),'snapshot table RLS also hides removed athlete');
  RESET ROLE;
  DELETE FROM public.swims WHERE id='record-cache-tie';
  SET LOCAL ROLE anon;
  SELECT pg_temp.check_ok(jsonb_array_length(pg_temp.board()->'races')=0,'deleted source cannot survive in snapshot');
  RESET ROLE;
  SELECT private.refresh_team_records();
  SELECT pg_temp.check_ok(jsonb_array_length(pg_temp.board()->'races')=0,'empty board refresh removes old winners');
`));

test("the compact board keeps legacy ties, relay lineups, and verified lead-offs", () => check(`
  SELECT private.put_record('relay_results/record-cache-relay', '{
    "id":"record-cache-relay", "relayName":"Record Fixture Relay", "teamId":"velocity-swimming", "eventCode":"200_FR-R_SCY", "course":"SCY",
    "distance":200, "stroke":"FR", "timeMs":125000, "status":"OK", "round":"F", "isRelay":true,
    "isOfficial":true, "gender":"F", "ageGroup":"11-12", "splitCoverage":"partial",
    "meet":{"id":"record-cache-meet", "name":"Record fixture", "date":"2026-10-01"},
    "members":[{"leg":1, "athleteId":"record-cache-a", "name":"First Fixture", "stroke":"FR", "timeMs":28000}],
    "splits":[{"distance":50,"cumulativeMs":28000}]
  }');
  SELECT pg_temp.swim('record-cache-leadoff', 'record-cache-a', 28000, '{
    "eventCode":"50_FR_SCY", "distance":50, "stroke":"FR", "resultOrigin":"relay_leadoff", "parentRelayResultId":"record-cache-relay",
    "leadOffVerification":{"verified":true,"flatStart":true,"timingVerified":true,"leadOffStatus":"OK","sourceUrl":"https://example.test/source"}
  }');
  SELECT private.refresh_team_records();
  SET LOCAL ROLE anon;
  WITH boards AS MATERIALIZED (
    SELECT pg_temp.board() current_board, public.ies_team_records('velocity-swimming') legacy_board
  )
  SELECT pg_temp.check_ok(current_board->'records'=legacy_board->'records', 'identical winners and tie order'),
    pg_temp.check_ok(current_board->'recordsUpdatedAt'=legacy_board->'recordsUpdatedAt', 'same freshness timestamp'),
    pg_temp.check_ok(current_board->'races' @> '[{"id":"record-cache-relay","members":[{"leg":1,"name":"First Fixture"}]}]', 'preserves the inline relay lineup'),
    pg_temp.check_ok(current_board->'races' @> '[{"id":"record-cache-leadoff","resultOrigin":"relay_leadoff"}]', 'preserves the lead-off label'),
    pg_temp.check_ok(NOT jsonb_path_exists(current_board, '$.races[*].splits'), 'board skips full splits'),
    pg_temp.check_ok(jsonb_path_exists(legacy_board, '$.races[*].splits'), 'legacy response retains full race metadata')
  FROM boards;
  RESET ROLE;
  INSERT INTO public.result_moderation VALUES ('relay','record-cache-relay',true,1);
  SET LOCAL ROLE anon;
  SELECT pg_temp.check_ok(NOT (pg_temp.board()::text LIKE '%record-cache-relay%' OR pg_temp.board()::text LIKE '%record-cache-leadoff%'), 'relay flag immediately hides parent and lead-off');
  RESET ROLE;
  UPDATE public.result_moderation SET flagged=false,version=2 WHERE result_id='record-cache-relay';
  SET LOCAL ROLE anon;
  SELECT pg_temp.check_ok(pg_temp.board()->'races' @> '[{"id":"record-cache-relay"},{"id":"record-cache-leadoff"}]','restore makes the current winners visible again');
  RESET ROLE;
`));

test("public callers cannot write the board or invoke the background worker", () => check(`
  SELECT pg_temp.check_ok(NOT has_function_privilege('anon','private.refresh_team_records()','execute'),'anon cannot rebuild');
  SELECT pg_temp.check_ok(NOT has_function_privilege('authenticated','private.refresh_team_records()','execute'),'members cannot rebuild');
  SELECT pg_temp.check_ok(NOT has_table_privilege('anon','public.team_record_holders','insert'),'anon cannot forge holders');
  SELECT pg_temp.check_ok(NOT has_table_privilege('authenticated','public.team_record_refresh_state','update'),'members cannot forge freshness');
  SELECT pg_temp.check_ok(NOT has_table_privilege('anon','private.team_record_refresh_queue','select'),'refresh queue is private');
  SELECT pg_temp.check_ok((SELECT count(*)=1 FROM cron.job WHERE jobname='refresh-team-records' AND schedule='*/5 * * * *' AND active),'scheduled refresh exists');
`));

test("failed refreshes keep the previous board and retryable work", () => check(`
  SELECT pg_temp.swim('record-cache-faster','record-cache-a',55000);
  ALTER TABLE public.team_record_holders ADD CONSTRAINT simulated_refresh_failure CHECK(team<>'velocity-swimming') NOT VALID;
  DO $$ BEGIN
    BEGIN
      PERFORM private.refresh_team_records();
      RAISE EXCEPTION 'Expected the simulated refresh failure';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END; $$;
  SELECT pg_temp.check_ok(pg_temp.board()#>>'{records,SCY:11-12:100_FR:F,0}'='record-cache-first','failed refresh preserves previous board');
  SELECT pg_temp.check_ok(EXISTS(SELECT 1 FROM private.team_record_refresh_queue WHERE transaction_id=txid_current()),'failed refresh keeps queued work');
  ALTER TABLE public.team_record_holders DROP CONSTRAINT simulated_refresh_failure;
  SELECT pg_temp.check_ok(private.refresh_team_records(),'retry succeeds');
  SELECT pg_temp.check_ok(pg_temp.board()#>>'{records,SCY:11-12:100_FR:F,0}'='record-cache-faster','retry publishes new winner');
`));

test("page reads touch only holders even with a large slower-swim history", () => check(`
  SELECT pg_temp.swim('record-cache-slower-'||n,'record-cache-a',70000+n) FROM generate_series(1,2000) n;
  SELECT private.refresh_team_records();
  CREATE FUNCTION pg_temp.reject_archive_scan(rid text) RETURNS boolean LANGUAGE plpgsql AS $$
  BEGIN
    IF rid LIKE 'record-cache-slower-%' THEN RAISE EXCEPTION 'Page scanned a non-record swim'; END IF;
    RETURN true;
  END; $$;
  CREATE POLICY records_read_must_not_scan_archive ON public.public_swims AS RESTRICTIVE
    FOR SELECT TO anon USING (pg_temp.reject_archive_scan(id));
  SET LOCAL ROLE anon;
  SELECT pg_temp.check_ok(jsonb_array_length(pg_temp.board()->'races')=2,'read only the two holders');
  RESET ROLE;
`));
