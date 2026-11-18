import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const workdir = process.env.VELOCITY_IMPORT_TEST_WORKDIR ?? ".";
const project = readFileSync(join(workdir, "supabase/config.toml"), "utf8")
  .match(/^project_id = "([a-zA-Z0-9_-]+)"/m)?.[1];

function checkArchive(statement) {
  if (!project) throw new Error("A local Supabase project is required.");
  if (!/^\s*begin;/i.test(statement) || !/rollback;\s*$/i.test(statement) || /\bcommit\s*;/i.test(statement)) {
    throw new Error("Held archive fixtures must remain inside one rollback-only transaction.");
  }
  // Archive scans are global. Isolate the fixture inside its own rollback so
  // prior task fixtures cannot consume its first page of observations.
  const isolated = statement.replace(/^\s*begin;/i, "begin;\ntruncate private.velocity_held_observations cascade;");
  try {
    execFileSync("docker", ["exec", "-i", `supabase_db_${project}`, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt"], {
      input: isolated,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(error.stderr?.toString() || error.message, { cause: error });
  }
}

test("archive observations reconcile in groups and publish through the existing review queue", () => checkArchive(`
        begin;
        do $test$
        declare
          staff_id uuid;
          worker_token text := gen_random_uuid()::text;
          member_hash text := '0123456789abcdef01234567';
          sha text := repeat('a',64);
          source_url text := 'https://example.test/results';
          base jsonb;
          captures jsonb;
          swim_id uuid;
          unknown_date_id uuid;
          relay_id uuid;
          receipt jsonb;
          decision uuid;
          published_swim text;
          published_relay text;
          existing jsonb;
          selection uuid;
        begin
          insert into auth.users(id,email,email_confirmed_at,role)
            values(gen_random_uuid(),'held-observation-test@example.test',now(),'authenticated')
            returning id into staff_id;
          insert into public.administrators(user_id) values (staff_id);
          insert into private.collection_workers(name,token_hash,divisions)
            values('held-observation-test',encode(extensions.digest(worker_token,'sha256'),'hex'),array['times']);
          perform private.put_record('teams/velocity-swimming','{"name":"Velocity Swimming","lscCode":"IE","clubCode":"VS"}');
          perform private.put_record('meets/held-observation-test-meet','{"name":"Held archive meet","course":"SCY",
            "startsOn":"2026-10-01","endsOn":"2026-10-03","sourceObservation":{"sourceMeetId":"1234567890"}}');
          perform private.put_record('athletes/held-test-observation-athlete',
            '{"name":{"first":"Test","last":"Swimmer"},"gender":"F",
              "sourceObservation":{"memberIdHash":"0123456789abcdef01234567"}}');

          if has_table_privilege('authenticated','private.velocity_held_observations','select')
            or has_function_privilege('anon','public.velocity_held_observations(jsonb)','execute')
            or has_function_privilege('authenticated','private.velocity_held_refresh(uuid,integer,uuid)','execute') then
            raise exception 'Source rows, staff actions and privileged maintenance require separate access checks';
          end if;
          begin
            perform public.velocity_held_observations('{"action":"list"}');
            raise exception 'Authentication must be required';
          exception when insufficient_privilege then null;
          end;

          base := jsonb_build_object('sourceMeetId','1234567890','workbookSha256',sha,'kind','swim','round','P',
            'clubCode','VS','sourceStatus','OK','memberIdHash',member_hash,'sourceUrl',source_url,
            'capturedAt','2026-10-05T02:00:00Z','holdReason','Stable swimmer identity has observed conflicts');
          captures := jsonb_build_array(
            base || jsonb_build_object('sourceRow',1,'observed',
              '{"name":"Test Swimmer","meetName":"Held archive meet","raceDate":"2026-10-02","eventCode":"100_FR_SCY","category":"F","timeMs":41000}'::jsonb),
            base || jsonb_build_object('sourceRow',2,'observed',
              '{"name":"T. Swimmer","meetName":"Held archive meet","eventCode":"100_FR_SCY","category":"F","timeMs":44000}'::jsonb),
            base || jsonb_build_object('sourceRow',5,'round','F','holdReason','Exact age on the race date is unavailable','observed',
              '{"name":"Swimmer, Test","meetName":"Held archive meet","raceDate":"2026-10-03",
                "eventCode":"50_FR_SCY","category":"F","timeMs":40000,"awardedFinalPlace":1}'::jsonb),
            base || jsonb_build_object('sourceRow',3,'sourceStatus','DQ','observed',
              '{"name":"Test Swimmer","meetName":"Held archive meet","raceDate":"2026-10-01","eventCode":"100_FR_SCY","category":"F","timeMs":30000}'::jsonb),
            (base - 'memberIdHash') || jsonb_build_object('sourceRow',4,'kind','relay','round','F','clubCode','CUDA',
              'holdReason','No awarded final place establishing competitive eligibility','observed',
              '{"name":"Test Relay","relayName":"Test Relay","meetName":"Held archive meet","raceDate":"2026-10-02",
                  "eventCode":"200_FR-R_SCY","category":"F","ageGroup":"12 & Under","timeMs":101000}'::jsonb)
          );
          receipt := public.stage_velocity_held_observations(worker_token,captures);
          if receipt <> '{"inserted":5,"duplicates":0}'::jsonb
            or public.stage_velocity_held_observations(worker_token,captures) <> '{"inserted":0,"duplicates":5}'::jsonb then
            raise exception 'The full observation key must prevent duplicates';
          end if;
          begin
            perform public.stage_velocity_held_observations(worker_token,
              jsonb_build_array(captures->0 || '{"holdReason":"Changed archived evidence"}'));
            raise exception 'Changed source data must fail a retry';
          exception when sqlstate 'PT409' then null;
          end;
          begin
            perform public.stage_velocity_held_observations(worker_token,
              jsonb_build_array((captures->0 || '{"sourceRow":20}')
                || jsonb_build_object('observed',(captures->0->'observed') || '{"raw":{"#ID":"synthetic-id"}}')));
            raise exception 'Raw membership data must be rejected';
          exception when invalid_parameter_value then null;
          end;

          perform set_config('request.jwt.claims', jsonb_build_object('sub',staff_id,'role','authenticated')::text,true);
          receipt := public.velocity_held_observations('{"action":"list","sourceMeetId":"1234567890","groupBy":"identity","status":"held"}');
          if receipt#>>'{groups,0,count}' <> '2' or receipt#>>'{counts,outcome}' <> '1' then
            raise exception 'Invalid grouped staff archive %', receipt;
          end if;
          select id into swim_id from private.velocity_held_observations where source_meet_id='1234567890' and source_row=1;
          select id into unknown_date_id from private.velocity_held_observations where source_meet_id='1234567890' and source_row=2;
          select id into relay_id from private.velocity_held_observations where source_meet_id='1234567890' and source_row=4;
          receipt := public.velocity_held_observations('{"action":"scan"}');
          if receipt->>'ready' <> '1' then
            raise exception 'GoMotion comma-order names must match published canonical identities in the baseline: %', receipt;
          end if;
          receipt := jsonb_build_object('action','decision','scope','identity','id',swim_id,'requestId',gen_random_uuid(),
            'athleteId','held-test-observation-athlete');
          decision := (public.velocity_held_observations(receipt)->>'decisionId')::uuid;
          if (public.velocity_held_observations(receipt)->>'affected')::int <> 4 then
            raise exception 'Identity decision should be repeatable across all dependent source rows';
          end if;
          receipt := public.velocity_held_observations(jsonb_build_object('action','revalidate','decisionId',decision));
          if receipt->>'ready' <> '1' or receipt->>'held' <> '2' or receipt->>'outcome' <> '1' then
            raise exception 'An identity decision must not imply competitive eligibility: %', receipt;
          end if;
          decision := (public.velocity_held_observations(jsonb_build_object('action','decision','scope','source','id',swim_id,
            'eventCode','100_FR_SCY','round','P','requestId',gen_random_uuid()))->>'decisionId')::uuid;
          receipt := public.velocity_held_observations(jsonb_build_object('action','revalidate','decisionId',decision));
          if receipt->>'ready' <> '1' or receipt->>'held' <> '1' or receipt->>'outcome' <> '1' then
            raise exception 'Verified export must preserve date gaps and failed race statuses: %', receipt;
          end if;
          decision := (public.velocity_held_observations(jsonb_build_object('action','decision','scope','source','id',relay_id,
            'eventCode','200_FR-R_SCY','round','F','requestId',gen_random_uuid(),
            'reviewedAffiliation',true))->>'decisionId')::uuid;
          receipt := public.velocity_held_observations(jsonb_build_object('action','revalidate','decisionId',decision));
          if receipt->>'ready' <> '1' then
            raise exception 'Verified relay without a lineup should be ready: %', receipt;
          end if;
          receipt := public.velocity_held_observations(jsonb_build_object('action','submit','ids',jsonb_build_array(swim_id,relay_id,unknown_date_id)));
          if receipt->>'staged' <> '2' or receipt->>'blocked' <> '1' then
            raise exception 'Only ready observations enter the existing private import queue: %', receipt;
          end if;
          if exists(select 1 from public.public_swims where data#>>'{meet,id}'='held-observation-test-meet') then
            raise exception 'Observation submission must remain private until approval';
          end if;
          receipt := public.velocity_import_selection(jsonb_build_object('ids',(
            select jsonb_agg(import_row_id) from private.velocity_held_assessments where observation_id in (swim_id,relay_id)
          )));
          selection := (receipt->>'selectionId')::uuid;
          receipt := public.approve_velocity_import(selection);
          if receipt->>'approved' <> '2' then
            raise exception 'Held candidate approval failed: %. Blockers: %', receipt, (
              select jsonb_agg(r.review_blocker) from private.velocity_import_rows r
              join private.velocity_held_assessments a on a.import_row_id=r.id
              where a.observation_id in (swim_id,relay_id)
            );
          end if;
          select record_id into published_swim from private.velocity_held_assessments where observation_id=swim_id;
          select record_id into published_relay from private.velocity_held_assessments where observation_id=relay_id;
          perform private.refresh_team_records();
          if not exists(select 1 from public.athlete_bests where data->>'swimId'=published_swim)
            or exists(select 1 from public.ies_times_candidates('{"ageGroups":["11-12"]}') where id=published_swim)
            or not exists(select 1 from public.team_record_holders where result_id=published_relay)
            or not exists(select 1 from public.public_relay_results where id=published_relay and data->>'lineupCoverage'='unavailable')
            or (select data#>>'{sourceObservation,affiliation,clubCode}' from public.relay_results where id=published_relay) <> 'CUDA'
          then raise exception 'Partial verified results must enter only eligible calculations'; end if;

          receipt := public.velocity_held_observations(jsonb_build_object('action','detail','id',swim_id));
          if receipt->>'status' <> 'published' then raise exception 'Approved status must reflect queue receipt'; end if;
          existing := receipt->'current';
          decision := (public.velocity_held_observations(jsonb_build_object('action','decision','scope','row','id',swim_id,
            'requestId',gen_random_uuid(),
            'expected',existing,'patch','{"age":12}'::jsonb))->>'decisionId')::uuid;
          perform public.velocity_held_observations(jsonb_build_object('action','revalidate','decisionId',decision));
          receipt := public.velocity_held_observations(jsonb_build_object('action','submit','ids',jsonb_build_array(swim_id)));
          if receipt->>'staged' <> '1' or jsonb_array_length(receipt->'correctionBatchIds') <> 1 then
            raise exception 'A same-race age edit must use existing correction review: %', receipt;
          end if;
          selection := (receipt#>>'{correctionBatchIds,0}')::uuid;
          perform public.review_collection(selection,'approved','Verified correction');
          if not exists(select 1 from public.ies_times_candidates('{"ageGroups":["11-12"]}') where id=published_swim) then
            raise exception 'Approved age edit must update age-based rankings';
          end if;

          receipt := public.velocity_held_observations(jsonb_build_object('action','record','kind','relay','recordId',published_relay));
          receipt := public.velocity_held_observations(jsonb_build_object('action','correction','kind','relay','recordId',published_relay,
            'expected',receipt->'current',
            'patch',jsonb_build_object('members',jsonb_build_array(jsonb_build_object(
              'leg',1,'name','Test Swimmer','athleteId','held-test-observation-athlete')))));
          perform public.review_collection((receipt->>'correctionBatchId')::uuid,'approved','Verified first leg');
          if not exists(select 1 from public.public_relay_results where id=published_relay and data->>'lineupCoverage'='partial') then
            raise exception 'Viewer correction must fill in the same relay';
          end if;
        end
        $test$;
        rollback;
`));

test("one swimmer approval publishes a whole group across pages and resumes without duplicates", () => checkArchive(`
  begin;
  do $test$
  declare
    staff_id uuid;
    worker_token text := gen_random_uuid()::text;
    member_hash text := repeat('d', 24);
    source_url text := 'https://example.test/group-results';
    athlete_id text := 'held-swimmer-approval-athlete';
    other_athlete_id text := 'held-swimmer-approval-other';
    first_id uuid;
    staged_id uuid;
    first_import uuid;
    request_id uuid := gen_random_uuid();
    request jsonb;
    receipt jsonb;
    decision_id uuid;
    selection_id uuid;
  begin
    insert into auth.users(id,email,email_confirmed_at,role)
      values(gen_random_uuid(),'held-swimmer-approval@example.test',now(),'authenticated')
      returning id into staff_id;
    insert into public.administrators(user_id) values (staff_id);
    insert into private.collection_workers(name,token_hash,divisions)
      values('held-swimmer-approval-test', encode(extensions.digest(worker_token,'sha256'),'hex'), array['times']);
    perform private.put_record('teams/velocity-swimming','{"name":"Velocity Swimming","lscCode":"IE","clubCode":"VS"}');
    perform private.put_record('athletes/' || athlete_id,'{"name":{"first":"Fixture","last":"Swimmer"},"gender":"F"}');
    perform private.put_record('athletes/' || other_athlete_id,'{"name":{"first":"Fixture","last":"Swimmer"},"gender":"F"}');
    perform private.put_record('meets/held-swimmer-meet-a','{"name":"Group Fixture A","course":"SCY",
      "startsOn":"2026-01-01","endsOn":"2026-02-28","sourceObservation":{"sourceMeetId":"2345678901"}}');
    perform private.put_record('meets/held-swimmer-meet-b','{"name":"Group Fixture B","course":"SCY",
      "startsOn":"2026-03-01","endsOn":"2026-04-30","sourceObservation":{"sourceMeetId":"2345678902"}}');

    receipt := public.stage_velocity_held_observations(worker_token, (
      select jsonb_agg(jsonb_build_object(
        'sourceMeetId',case when n <= 50 then '2345678901' else '2345678902' end,
        'workbookSha256',repeat(case when n <= 50 then 'e' else 'f' end,64),
        'kind','swim','sourceRow',n,'round',case when n = 99 then 'P' else 'F' end,
        'clubCode','VS','sourceStatus',case when n = 98 then 'DQ' else 'OK' end,
        'memberIdHash',case when n = 100 then repeat('c',24) when n <> 101 then member_hash end,
        'sourceUrl',source_url,'capturedAt','2026-05-01T00:00:00Z','holdReason','Swimmer needs a profile',
        'observed',jsonb_strip_nulls(jsonb_build_object(
          'name','Fixture Swimmer','meetName','Group Fixture','category','F','eventCode','100_FR_SCY',
          'raceDate',case when n <= 50 then date '2026-01-01' + n - 1
                          when n <> 97 then date '2026-03-01' + n - 51 end,
          'timeMs',63000 + n,'awardedFinalPlace',case when n <> 99 then 1 end
        ))
      )) from generate_series(1,101) n
    ));
    if receipt->>'inserted' <> '101' then raise exception 'Synthetic observations should all load'; end if;
    select id into strict first_id from private.velocity_held_observations where source_meet_id='2345678901' and source_row=1;
    select id into strict staged_id from private.velocity_held_observations where source_meet_id='2345678901' and source_row=2;

    request := jsonb_build_object('action','linkAndApproveSwimmer','id',staged_id,'athleteId',athlete_id,
      'requestId',request_id,'pageSize',40);
    begin
      perform public.velocity_held_observations(request);
      raise exception 'Swimmer publication must require staff';
    exception when insufficient_privilege then null;
    end;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',staff_id,'role','authenticated')::text,true);

    receipt := public.velocity_held_observations(jsonb_build_object(
      'action','decision','scope','identity','id',first_id,'requestId',gen_random_uuid(),'athleteId',athlete_id
    ));
    decision_id := (receipt->>'decisionId')::uuid;
    if not exists(select 1 from private.velocity_held_decisions where id=decision_id
      and evidence_url=source_url and reviewed_by=staff_id) then
      raise exception 'Group reviews should retain source and reviewer without requiring inputs';
    end if;
    perform public.velocity_held_observations(jsonb_build_object('action','revalidate','decisionId',decision_id));
    perform public.velocity_held_observations(jsonb_build_object('action','submit','ids',jsonb_build_array(first_id,staged_id)));
    select import_row_id into strict first_import from private.velocity_held_assessments where observation_id=first_id;
    selection_id := (public.velocity_import_selection(jsonb_build_object('ids',jsonb_build_array(first_import)))
      ->>'selectionId')::uuid;
    perform public.approve_velocity_import(selection_id);

    receipt := public.velocity_held_observations(request);
    if receipt->>'total' <> '99' or receipt->>'checked' <> '0' then
      raise exception 'Start should freeze only the selected source swimmer: %', receipt;
    end if;
    receipt := public.velocity_held_observations(request);
    if receipt->>'checked' <> '40' or receipt->>'done' <> 'false' then
      raise exception 'The first page should save progress: %', receipt;
    end if;
    receipt := public.velocity_held_observations(request || jsonb_build_object('id',first_id,'requestId',gen_random_uuid()));
    if receipt->>'checked' <> '80' or receipt->>'requestId' <> request_id::text then
      raise exception 'Reopening the same swimmer should resume the existing approval: %', receipt;
    end if;
    receipt := public.velocity_held_observations(request);
    if receipt <> jsonb_build_object('requestId',request_id,'total',99,'checked',99,'approved',95,
      'alreadyRecorded',1,'stillHeld',2,'outcomes',1,'done',true) then
      raise exception 'All eligible swims, including the matching queued observation, should be approved: %', receipt;
    end if;
    if public.velocity_held_observations(request) <> receipt then
      raise exception 'A completed request must return the saved receipt';
    end if;
    if (select count(*) from public.public_swims s where s.athlete_id = 'held-swimmer-approval-athlete') <> 96
      or exists(select 1 from public.public_swims s where s.athlete_id = 'held-swimmer-approval-other')
      or not exists(select 1 from private.velocity_held_review where id=staged_id and state='published') then
      raise exception 'Public results must match the receipt and exclude same-name observations without this source ID';
    end if;
    begin
      perform public.velocity_held_observations(request || jsonb_build_object('athleteId',other_athlete_id));
      raise exception 'A saved group approval cannot be reused for another swimmer';
    exception when sqlstate 'PT409' then null;
    end;
    begin
      perform public.velocity_held_observations(request || jsonb_build_object(
        'athleteId',other_athlete_id,'requestId',gen_random_uuid()));
      raise exception 'A stable published identity blocks a conflicting swimmer link';
    exception when invalid_parameter_value then null;
    end;
  end
  $test$;
  rollback;
`));
