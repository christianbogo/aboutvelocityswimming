import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const workdir = process.env.VELOCITY_IMPORT_TEST_WORKDIR ?? ".";
const project = readFileSync(join(workdir, "supabase/config.toml"), "utf8")
  .match(/^project_id = "([a-zA-Z0-9_-]+)"/m)?.[1];

function checkArchive(statement) {
  if (!project) throw new Error("A local Supabase project is required.");
  try {
    execFileSync("docker", ["exec", "-i", `supabase_db_${project}`, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt"], {
      input: statement,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(error.stderr?.toString() || error.message, { cause: error });
  }
}

test("staff can accept every official observation without changing source facts or publishing conflicts", () => checkArchive(`
  begin;
  do $test$
  declare
    staff_id uuid := gen_random_uuid();
    member_id uuid := gen_random_uuid();
    worker_token text := gen_random_uuid()::text;
    fixture_athlete text := 'official-archive-test-swimmer';
    fixture_meet text := 'official-archive-test-meet';
    meet_source text := '90000000000000000001';
    official_url text := 'https://www.gomotionapp.com/team/ievs/controller/cms/admin/index';
    base jsonb;
    observed jsonb;
    captures jsonb;
    receipt jsonb;
    status jsonb;
    published_count integer := 0;
    source_count integer;
    tries integer := 0;
  begin
    if exists(select 1 from private.velocity_held_observations o where o.source_url = official_url) then
      raise exception 'Use a local test database without a live GoMotion archive.';
    end if;
    insert into auth.users(id,email,email_confirmed_at,role) values
      (staff_id,'official-archive-staff@example.test',now(),'authenticated'),
      (member_id,'official-archive-member@example.test',now(),'authenticated');
    insert into public.administrators(user_id) values (staff_id);
    insert into private.collection_workers(name,token_hash,divisions)
      values('official-archive-fixture',encode(extensions.digest(worker_token,'sha256'),'hex'),array['times']);
    if not exists(select 1 from public.teams where id = 'velocity-swimming') then
      perform private.put_record('teams/velocity-swimming','{"name":"Velocity Swimming","lscCode":"IE","clubCode":"VS"}');
    end if;
    perform private.put_record('meets/' || fixture_meet, jsonb_build_object(
      'name','Official archive test','course','SCY','startsOn','2026-10-01','endsOn','2026-10-03',
      'sourceObservation',jsonb_build_object('sourceMeetId',meet_source)));
    perform private.put_record('athletes/' || fixture_athlete, jsonb_build_object(
      'name','{"first":"Verified","last":"Fixture"}'::jsonb,'gender','F',
      'sourceObservation',jsonb_build_object('memberIdHash',repeat('8',24))));

    base := jsonb_build_object('sourceMeetId',meet_source,'workbookSha256',repeat('a',64),
      'kind','swim','round','P','clubCode','VS','sourceStatus','OK','memberIdHash',repeat('8',24),
      'sourceUrl',official_url,'capturedAt','2026-10-05T02:00:00Z',
      'holdReason','Stable swimmer identity has observed conflicts');
    observed := '{"name":"Fixture, Verified","meetName":"Official archive test","raceDate":"2026-10-02", "eventCode":"100_FR_SCY","category":"F","timeMs":61230}'::jsonb;
    captures := jsonb_build_array(
      base || jsonb_build_object('sourceRow',1,'observed',observed),
      base || jsonb_build_object('sourceRow',2,'workbookSha256',repeat('b',64),'observed',observed),
      base || jsonb_build_object('sourceRow',3,'sourceStatus','DQ','observed',
        (observed - 'timeMs') || '{"eventCode":"100_BK_SCY","raw":{"Prelim":"DQ"}}'::jsonb),
      base || jsonb_build_object('sourceRow',4,'observed',(observed - 'raceDate') || '{"eventCode":"50_FR_SCY"}'::jsonb),
      base || jsonb_build_object('sourceRow',5,'round','F','holdReason','Relay lead-off lacks verified parent relay and flat-start timing',
        'observed',observed || '{"eventCode":"200_FR_SCY","leadOff":true}'::jsonb),
      base || jsonb_build_object('sourceRow',6,'observed',observed || '{"eventCode":"200_BR_SCY","timeMs":141110}'::jsonb),
      base || jsonb_build_object('sourceRow',7,'workbookSha256',repeat('b',64),
        'observed',observed || '{"eventCode":"200_BR_SCY","timeMs":141120}'::jsonb),
      base || jsonb_build_object('sourceRow',8,'observed',observed || '{"eventCode":"100_FL_SCY","isOfficial":false}'::jsonb),
      base || jsonb_build_object('sourceRow',9,'sourceUrl','https://example.test/not-gomotion',
        'observed',observed || '{"eventCode":"100_IM_SCY"}'::jsonb)
    );
    -- Additional no-time outcomes cross a request boundary without creating results.
    captures := captures || (select jsonb_agg(base || jsonb_build_object(
      'sourceRow',n,'round','none','sourceStatus',null,'memberIdHash',null,
      'observed',jsonb_build_object('meetName','Official archive test','raw',jsonb_build_object('Final','—'))))
      from generate_series(10,180) n);
    source_count := jsonb_array_length(captures) - 1;
    receipt := public.stage_velocity_held_observations(worker_token,captures);
    if (receipt->>'inserted')::int is distinct from source_count + 1 then
      raise exception 'Fixture archive could not be staged: %', receipt;
    end if;

    begin
      perform public.velocity_held_observations('{"action":"acceptOfficialArchive"}');
      raise exception 'Anonymous archive acceptance did not require staff access';
    exception when insufficient_privilege then null;
    end;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'role','authenticated')::text,true);
    begin
      perform public.velocity_held_observations('{"action":"acceptOfficialArchive"}');
      raise exception 'A non-staff member could accept the official archive';
    exception when insufficient_privilege then null;
    end;

    perform set_config('request.jwt.claims',jsonb_build_object('sub',staff_id,'role','authenticated')::text,true);
    if has_table_privilege('authenticated','private.velocity_official_archive_acceptances','select')
      or has_function_privilege('authenticated','private.velocity_accept_official_archive(integer)','execute') then
      raise exception 'The underlying archive tables and writer must remain private';
    end if;
    if public.velocity_held_observations('{"action":"officialArchiveStatus"}') is not null then
      raise exception 'No archive receipt should exist before the first import';
    end if;
    loop
      receipt := public.velocity_held_observations('{"action":"acceptOfficialArchive"}');
      published_count := published_count + (receipt->>'publishedThisChunk')::int;
      tries := tries + 1;
      exit when receipt->>'completed' = 'true';
      if tries >= 50 then raise exception 'The archive did not finish: %', receipt; end if;
      status := public.velocity_held_observations('{"action":"officialArchiveStatus"}');
      if status - array['publishedThisChunk','hasUnaccepted'] is distinct from receipt - 'publishedThisChunk' then
        raise exception 'In-progress status must preserve the cursor and totals: %', status;
      end if;
    end loop;
    if (receipt->>'total')::int is distinct from source_count
      or (receipt->>'accepted')::int is distinct from source_count
      or (receipt->>'sourceOnly')::int is distinct from source_count - 2
      or receipt->>'published' is distinct from '1' or receipt->>'alreadyRecorded' is distinct from '1'
      or published_count is distinct from 1 or tries < 2
    then raise exception 'Unexpected official archive receipt: %', receipt;
    end if;

    status := public.velocity_held_observations('{"action":"officialArchiveStatus"}');
    if status - array['publishedThisChunk','hasUnaccepted'] is distinct from receipt - 'publishedThisChunk'
      or status->>'hasUnaccepted' is distinct from 'false' then
      raise exception 'Status should show the durable receipt: %', status;
    end if;
    status := public.velocity_held_observations('{"action":"acceptOfficialArchive"}');
    if status - 'publishedThisChunk' is distinct from receipt - 'publishedThisChunk'
      or status->>'publishedThisChunk' is distinct from '0' then
      raise exception 'A repeat request should return the saved result without writes: %', status;
    end if;

    if (select count(*) from public.public_swims s where s.data#>>'{meet,id}'=fixture_meet) <> 1
      or not exists(select 1 from public.public_swims s where s.data#>>'{meet,id}'=fixture_meet
        and s.data->>'athleteId'=fixture_athlete and s.data->>'timeMs'='61230' and s.data->>'round'='P')
      or not exists(select 1 from public.athlete_bests b
        join public.swims s on s.id=b.data->>'swimId' and s.meet_id=fixture_meet
        where b.athlete_id=fixture_athlete and s.time_ms=61230)
      or (select count(*) from private.velocity_held_review o where o.source_meet_id=meet_source
        and o.source_row in (1,2) and o.state='published') <> 2
    then raise exception 'Exactly one canonical preliminary should be published and both observations should link to it';
    end if;
    if (select count(*) from private.velocity_held_review o where o.source_meet_id=meet_source
        and o.source_row not in (1,2,9) and o.state='accepted') <> source_count - 2
      or not exists(select 1 from private.velocity_held_review o where o.source_meet_id=meet_source
        and o.source_row=3 and o.source_status='DQ' and o.observed#>>'{raw,Prelim}'='DQ')
      or not exists(select 1 from private.velocity_held_review o where o.source_meet_id=meet_source
        and o.source_row=9 and o.state='held')
    then raise exception 'Source-only rows must preserve evidence, and non-GoMotion rows must remain untouched';
    end if;
    receipt := public.velocity_held_observations(jsonb_build_object('action','list','sourceMeetId',meet_source,'status','accepted'));
    if (receipt->>'total')::int is distinct from source_count - 2
      or (receipt#>>'{counts,accepted}')::int is distinct from source_count - 2 then
      raise exception 'Accepted observations must remain visible in the staff list: %', receipt - 'rows';
    end if;
  end
  $test$;
  rollback;
`));

test("official swimmer reconciliation publishes a verified middle initial variant and preserves conflicting names", () => checkArchive(`
  begin;
  do $test$
  declare
    staff_id uuid := gen_random_uuid();
    worker_token text := gen_random_uuid()::text;
    fixture_meet text := 'official-swimmer-reconcile-meet';
    meet_source text := '90000000000000000002';
    fixture_athlete text := 'official-swimmer-reconcile-athlete';
    other_athlete text := 'official-swimmer-reconcile-other';
    official_url text := 'https://www.gomotionapp.com/team/ievs/controller/cms/admin/index';
    base jsonb;
    observed jsonb;
    before_acceptances jsonb;
    before_observations jsonb;
    page jsonb;
    cursor_id uuid;
    counts jsonb;
    published_count integer := 0;
    pages integer := 0;
    record_id text;
  begin
    if exists(select 1 from private.velocity_held_observations o where o.source_url = official_url) then
      raise exception 'Use a local test database without a live GoMotion archive.';
    end if;
    insert into auth.users(id,email,email_confirmed_at,role) values
      (staff_id,'official-swimmer-reconcile@example.test',now(),'authenticated');
    insert into public.administrators(user_id) values (staff_id);
    insert into private.collection_workers(name,token_hash,divisions)
      values('official-swimmer-reconcile',encode(extensions.digest(worker_token,'sha256'),'hex'),array['times']);
    if not exists(select 1 from public.teams where id = 'velocity-swimming') then
      perform private.put_record('teams/velocity-swimming','{"name":"Velocity Swimming","lscCode":"IE","clubCode":"VS"}');
    end if;
    perform private.put_record('meets/' || fixture_meet, jsonb_build_object(
      'name','Official swimmer reconciliation test','course','SCY','startsOn','2026-10-01','endsOn','2026-10-03',
      'sourceObservation',jsonb_build_object('sourceMeetId',meet_source)));

    base := jsonb_build_object('sourceMeetId',meet_source,'workbookSha256',repeat('d',64),
      'kind','swim','round','P','clubCode','VS','sourceStatus','OK','memberIdHash',repeat('6',24),
      'sourceUrl',official_url,'capturedAt','2026-10-05T02:00:00Z',
      'holdReason','Stable swimmer identity has observed conflicts');
    observed := '{"meetName":"Official swimmer reconciliation test","raceDate":"2026-10-02","category":"F","timeMs":61770}'::jsonb;
    perform public.stage_velocity_held_observations(worker_token,jsonb_build_array(
      base || jsonb_build_object('sourceRow',1,'observed',observed || '{"name":"Tester, Swimmer Q.","eventCode":"100_FR_SCY"}'::jsonb),
      base || jsonb_build_object('sourceRow',2,'observed',observed || '{"name":"Tester, Different","eventCode":"100_BK_SCY"}'::jsonb),
      base || jsonb_build_object('sourceRow',3,'memberIdHash',repeat('7',24),
        'observed',observed || '{"name":"Tester, Second Q.","eventCode":"100_IM_SCY"}'::jsonb),
      base || jsonb_build_object('sourceRow',4,'sourceStatus','DQ',
        'observed',(observed - 'timeMs') || '{"name":"Tester, Swimmer Q.","eventCode":"50_FR_SCY","raw":{"Prelim":"DQ"}}'::jsonb)
    ));
    perform set_config('request.jwt.claims',jsonb_build_object('sub',staff_id,'role','authenticated')::text,true);

    -- Save the original acceptance before either canonical swimmer exists.
    counts := public.velocity_held_observations('{"action":"acceptOfficialArchive"}');
    if counts->>'sourceOnly' is distinct from '4' or counts->>'completed' is distinct from 'true' then
      raise exception 'Fixture records should all start with a source-only acceptance: %', counts;
    end if;
    select jsonb_agg(to_jsonb(a) order by o.source_row), jsonb_agg(to_jsonb(o) order by o.source_row)
      into before_acceptances, before_observations
    from private.velocity_official_archive_acceptances a
    join private.velocity_held_observations o on o.id=a.observation_id
    where o.source_meet_id=meet_source;

    perform private.put_record('athletes/' || fixture_athlete, jsonb_build_object(
      'name','{"first":"Swimmer","last":"Tester"}'::jsonb,'gender','F',
      'sourceObservation',jsonb_build_object('memberIdHash',repeat('6',24))));
    perform private.put_record('athletes/' || other_athlete, jsonb_build_object(
      'name','{"first":"Second R.","last":"Tester"}'::jsonb,'gender','F',
      'sourceObservation',jsonb_build_object('memberIdHash',repeat('7',24))));

    loop
      page := private.velocity_reconcile_official_swimmer_page(cursor_id,1);
      pages := pages + 1;
      published_count := published_count + coalesce((page->>'published')::int,0);
      exit when page->>'hasNext' = 'false';
      cursor_id := (page->>'afterId')::uuid;
      if cursor_id is null or pages >= 10 then raise exception 'Reconciliation cursor did not advance: %', page; end if;
    end loop;
    if published_count is distinct from 1 or pages < 2 then
      raise exception 'Only the uniquely verified middle initial variant should publish: %', page;
    end if;

    select o.record_id into record_id from private.velocity_held_review o
    where o.source_meet_id=meet_source and o.source_row=1 and o.state='published';
    if not exists(select 1 from public.public_swims s where s.id=record_id
        and s.data->>'athleteId'=fixture_athlete and s.data->>'timeMs'='61770')
      or not exists(select 1 from public.athlete_bests b where b.athlete_id=fixture_athlete and b.data->>'swimId'=record_id)
      or (select count(*) from private.velocity_held_review o where o.source_meet_id=meet_source
        and o.source_row in (2,3,4) and o.state='accepted') <> 3
    then raise exception 'The verified race should reach Times and bests, while the conflicts and DQ stay accepted'; end if;
    if (select jsonb_agg(to_jsonb(a) order by o.source_row) from private.velocity_official_archive_acceptances a
        join private.velocity_held_observations o on o.id=a.observation_id where o.source_meet_id=meet_source)
        is distinct from before_acceptances
      or (select jsonb_agg(to_jsonb(o) order by o.source_row) from private.velocity_held_observations o where o.source_meet_id=meet_source)
        is distinct from before_observations
    then raise exception 'Reconciliation changed an original acceptance or source observation'; end if;

    page := private.velocity_reconcile_official_swimmer_page(null,500);
    if page->>'published' is distinct from '0'
      or (select count(*) from public.public_swims s where s.data#>>'{meet,id}'=fixture_meet) <> 1
    then raise exception 'Reconciliation retry duplicated a published race: %', page; end if;
  end
  $test$;
  rollback;
`));
