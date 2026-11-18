import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const workdir = process.env.VELOCITY_IMPORT_TEST_WORKDIR ?? ".";
const project = readFileSync(join(workdir, "supabase/config.toml"), "utf8")
  .match(/^project_id = "([a-zA-Z0-9_-]+)"/m)?.[1];

function checkRound(statement) {
  if (!project) throw new Error("A local Supabase project is required.");
  // Optional migrations run in the same rollback transaction as the fixture.
  const migrations = (process.env.VELOCITY_IMPORT_TEST_MIGRATIONS ?? "")
    .split(",").filter(Boolean).map((path) => readFileSync(path, "utf8")).join("\n");
  try {
    execFileSync("docker", ["exec", "-i", `supabase_db_${project}`, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt"], {
      input: `begin;\n${migrations}\n${statement}\nrollback;`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(error.stderr?.toString() || error.message, { cause: error });
  }
}

test("reviewed rounds preserve export evidence and publish the verified occurrence", () => checkRound(`
  do $test$
  declare
    staff_id uuid := gen_random_uuid();
    worker_token text := gen_random_uuid()::text;
    fixture_athlete text := 'reviewed-round-test-athlete';
    fixture_meet text := 'reviewed-round-test-meet';
    meet_source text := '90000000000000000003';
    member_hash text := repeat('6',24);
    official_url text := 'https://www.gomotionapp.com/team/ievs/controller/cms/admin/index';
    base jsonb;
    observed jsonb;
    canonical jsonb;
    captures jsonb;
    receipt jsonb;
    evaluated jsonb;
    item private.velocity_held_observations;
    oid uuid;
    row_one uuid;
    row_lead uuid;
    row_manual uuid;
    decision uuid;
    selection uuid;
    fixture_run_id uuid := gen_random_uuid();
    accepted_ids uuid[];
    source_snapshot jsonb;
    acceptance_snapshot jsonb;
    run_snapshot jsonb;
    invalid_round jsonb;
    published_id text;
    published_lead text;
    existing_final jsonb;
    i integer;
  begin
    insert into auth.users(id,email,email_confirmed_at,role)
      values(staff_id,'reviewed-round-staff@example.test',now(),'authenticated');
    insert into public.administrators(user_id) values(staff_id);
    insert into private.collection_workers(name,token_hash,divisions)
      values('reviewed-round-fixture',encode(extensions.digest(worker_token,'sha256'),'hex'),array['times']);
    perform private.put_record('teams/velocity-swimming','{"name":"Velocity Swimming","lscCode":"IE","clubCode":"VS"}');
    perform private.put_record('meets/' || fixture_meet,jsonb_build_object(
      'name','Reviewed round fixture','course','SCY','startsOn','2026-11-13','endsOn','2026-11-14',
      'sourceObservation',jsonb_build_object('sourceMeetId',meet_source)));
    perform private.put_record('athletes/' || fixture_athlete,jsonb_build_object(
      'name','{"first":"Round","last":"Tester"}'::jsonb,'gender','F',
      'sourceObservation',jsonb_build_object('memberIdHash',member_hash)));
    canonical := jsonb_build_object('athleteId',fixture_athlete,'teamId','velocity-swimming',
      'isRelay',false,'isOfficial',true,'status','OK','gender','F','course','SCY','round','F',
      'splitCoverage','unavailable','splits','[]'::jsonb,
      'eventCode','100_FR_SCY','distance',100,'stroke','FR','timeMs',56000,
      'meet',jsonb_build_object('id',fixture_meet,'name','Reviewed round fixture','date','2026-11-13'));
    perform private.put_record('swims/reviewed-round-existing-final',canonical || '{"id":"reviewed-round-existing-final"}');
    select data into existing_final from public.swims where id='reviewed-round-existing-final';
    perform private.put_record('swims/reviewed-round-conflicting-prelim',canonical ||
      '{"id":"reviewed-round-conflicting-prelim","round":"P","eventCode":"100_FL_SCY","stroke":"FL","timeMs":59010}');
    perform private.put_record('swims/reviewed-round-exact-prelim',canonical ||
      '{"id":"reviewed-round-exact-prelim","round":"P","eventCode":"50_FR_SCY","distance":50,"timeMs":25000}');
    perform private.put_record('swims/reviewed-round-correct-existing',canonical ||
      '{"id":"reviewed-round-correct-existing","eventCode":"200_BK_SCY","distance":200,"stroke":"BK","timeMs":145000}');
    for i in 1..2 loop
      perform private.put_record('relay_results/reviewed-round-parent-' || i,
        (canonical - 'athleteId') || jsonb_build_object('id','reviewed-round-parent-' || i,'isRelay',true,'round',case i when 1 then 'F' else 'P' end,
          'eventCode','200_MED-R_SCY','distance',200,'stroke','IM','timeMs',110000,'relayName','Round relay',
          'members',jsonb_build_array(jsonb_build_object('leg',1,'athleteId',fixture_athlete,'name','Round Tester','timeMs',28890))));
    end loop;

    base := jsonb_build_object('sourceMeetId',meet_source,'workbookSha256',repeat('9',64),
      'kind','swim','round','F','clubCode','VS','sourceStatus','OK','memberIdHash',member_hash,
      'sourceUrl',official_url,'capturedAt','2026-11-15T02:00:00Z',
      'holdReason','Existing or reserved race identity differs in result facts');
    observed := '{"name":"Tester, Round","meetName":"Reviewed round fixture","raceDate":"2026-11-13",
      "eventCode":"100_FR_SCY","category":"F","timeMs":55550}'::jsonb;
    captures := jsonb_build_array(
      base || jsonb_build_object('sourceRow',1,'observed',observed),
      base || jsonb_build_object('sourceRow',2,'workbookSha256',repeat('8',64),'observed',observed || '{"timeMs":55800}'),
      base || jsonb_build_object('sourceRow',3,'observed',observed || '{"eventCode":"50_BK_SCY","timeMs":28890,"leadOff":true}'),
      base || jsonb_build_object('sourceRow',4,'sourceUrl','https://example.test/reviewed-round',
        'holdReason','Review the competitive source','observed',observed ||
          '{"eventCode":"200_FR_SCY","timeMs":115440,"awardedFinalPlace":1}'),
      base || jsonb_build_object('sourceRow',5,'holdReason','Review race occurrence',
        'observed',observed || '{"eventCode":"200_IM_SCY","timeMs":140000}'),
      base || jsonb_build_object('sourceRow',6,'observed',observed || '{"eventCode":"100_BR_SCY","timeMs":65880}'),
      base || jsonb_build_object('sourceRow',7,'observed',observed || '{"eventCode":"100_FL_SCY","timeMs":59000}'),
      base || jsonb_build_object('sourceRow',8,'observed',observed || '{"eventCode":"50_FR_SCY","timeMs":25000}'),
      base || jsonb_build_object('sourceRow',9,'observed',observed || '{"eventCode":"200_BK_SCY","timeMs":145000}'),
      base || jsonb_build_object('sourceRow',10,'sourceStatus','DQ','observed',observed)
    );
    receipt := public.stage_velocity_held_observations(worker_token,captures);
    if receipt->>'inserted' <> '10' then raise exception 'Round fixtures did not stage: %',receipt; end if;
    select id into row_one from private.velocity_held_observations where source_meet_id=meet_source and source_row=1;
    select id into row_lead from private.velocity_held_observations where source_meet_id=meet_source and source_row=3;
    select id into row_manual from private.velocity_held_observations where source_meet_id=meet_source and source_row=4;
    select array_agg(id order by id) into accepted_ids from private.velocity_held_observations
      where source_meet_id=meet_source and source_url=official_url;
    insert into private.velocity_official_archive_runs(id,started_by,started_via,completed_at,
      observation_ids,processed,source_only) values(fixture_run_id,staff_id,'staff',now(),accepted_ids,cardinality(accepted_ids),cardinality(accepted_ids));
    insert into private.velocity_official_archive_acceptances(observation_id,run_id,disposition,reason)
      select id,fixture_run_id,'source_only','Choose a verified canonical swimmer.' from private.velocity_held_observations
      where id=any(accepted_ids);
    select jsonb_agg(to_jsonb(o) order by o.id) into source_snapshot from private.velocity_held_observations o where o.source_meet_id=meet_source;
    select jsonb_agg(to_jsonb(a) order by a.observation_id) into acceptance_snapshot
      from private.velocity_official_archive_acceptances a where a.run_id=fixture_run_id;
    select to_jsonb(r) into run_snapshot from private.velocity_official_archive_runs r where r.id=fixture_run_id;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',staff_id,'role','authenticated')::text,true);

    for invalid_round in select value from jsonb_array_elements('[null,1,true,"none","p",""]'::jsonb) loop
      begin
        perform public.velocity_held_observations(jsonb_build_object('action','decision','scope','row',
          'id',row_one,'requestId',gen_random_uuid(),'reason','Verified owning report round','evidenceUrl',official_url,
          'patch',jsonb_build_object('round',invalid_round)));
        raise exception 'Invalid reviewed round was accepted: %',invalid_round;
      exception when invalid_parameter_value then null;
      end;
    end loop;
    begin
      perform public.velocity_held_observations(jsonb_build_object('action','decision','scope','source',
        'id',row_one,'requestId',gen_random_uuid(),'reason','Verified owning report round','evidenceUrl',official_url,
        'patch','{"round":"P"}'::jsonb));
      raise exception 'A source rule must not rewrite every exported round';
    exception when invalid_parameter_value then null;
    end;

    select * into item from private.velocity_held_observations where id=row_one;
    evaluated := private.velocity_held_evaluate(item,null);
    if evaluated->>'state' <> 'held' then raise exception 'Unreviewed old round must still conflict: %',evaluated; end if;
    decision := (public.velocity_held_observations(jsonb_build_object('action','decision','scope','row','id',row_one,
      'requestId',gen_random_uuid(),'reason','Owning report proves preliminary session','evidenceUrl',official_url,
      'patch','{"round":"P"}'::jsonb))->>'decisionId')::uuid;
    receipt := public.velocity_held_observations(jsonb_build_object('action','revalidate','decisionId',decision));
    select private.velocity_held_evaluate(o,null) into evaluated from private.velocity_held_observations o where id=row_one;
    if evaluated->>'state' <> 'ready' or evaluated#>>'{candidate,round}' <> 'P' then
      raise exception 'Reviewed preliminary must resolve only the old F occurrence conflict: %',evaluated;
    end if;
    receipt := public.velocity_held_observations(jsonb_build_object('action','submit','ids',jsonb_build_array(row_one)));
    if receipt->>'staged' <> '1' then raise exception 'Corrected preliminary did not stage: %',receipt; end if;
    receipt := public.velocity_import_selection(jsonb_build_object('ids',(
      select jsonb_agg(import_row_id) from private.velocity_held_assessments where observation_id=row_one)));
    receipt := public.approve_velocity_import((receipt->>'selectionId')::uuid);
    if receipt->>'approved' <> '1' then raise exception 'Corrected preliminary did not approve: %',receipt; end if;
    select record_id into published_id from private.velocity_held_assessments where observation_id=row_one;
    if not exists(select 1 from public.public_swims where id=published_id and data->>'round'='P')
      or not exists(select 1 from public.athlete_bests b where b.athlete_id=fixture_athlete and b.data->>'swimId'=published_id)
      or (select data from public.swims where id='reviewed-round-existing-final') is distinct from existing_final then
      raise exception 'Preliminary publication, best times, or existing final preservation failed';
    end if;
    perform public.velocity_held_observations(jsonb_build_object('action','revalidate','decisionId',decision));
    if (select count(*) from public.swims where meet_id=fixture_meet and data->>'eventCode'='100_FR_SCY' and round='P') <> 1 then
      raise exception 'Revalidation duplicated the corrected preliminary';
    end if;
    perform public.velocity_held_observations(jsonb_build_object('action','decision','scope','row','id',row_one,
      'requestId',gen_random_uuid(),'reason','Verified race day age','evidenceUrl',official_url,'patch','{"age":17}'::jsonb));
    select private.velocity_held_evaluate(o,published_id) into evaluated from private.velocity_held_observations o where id=row_one;
    if evaluated#>>'{candidate,round}' <> 'P' then raise exception 'Later row patches lost the reviewed round: %',evaluated; end if;

    -- Source approvals remain tied to F even though the verified race is P.
    perform public.velocity_held_observations(jsonb_build_object('action','decision','scope','row','id',row_manual,
      'requestId',gen_random_uuid(),'reason','Owning report proves preliminary session','evidenceUrl',official_url,'patch','{"round":"P"}'::jsonb));
    insert into private.velocity_held_decisions(id,observation_id,scope,source_meet_id,workbook_sha256,event_code,round,
      reason,evidence_url,reviewed_by,request,affected)
      values(gen_random_uuid(),row_manual,'source',meet_source,repeat('9',64),'200_FR_SCY','P',
        'Approval for a different original export',official_url,staff_id,'{}',1);
    select private.velocity_held_evaluate(o,null) into evaluated from private.velocity_held_observations o where id=row_manual;
    if evaluated->>'state' <> 'held' then raise exception 'Verified P must not broaden original-source approval: %',evaluated; end if;
    perform public.velocity_held_observations(jsonb_build_object('action','decision','scope','source','id',row_manual,
      'eventCode','200_FR_SCY','round','F','requestId',gen_random_uuid(),
      'reason','Verified original F-labeled report source','evidenceUrl',official_url));
    select private.velocity_held_evaluate(o,null) into evaluated from private.velocity_held_observations o where id=row_manual;
    if evaluated->>'state' <> 'ready' or evaluated#>>'{candidate,round}' <> 'P' then
      raise exception 'Original export approval must authorize the corrected P start: %',evaluated;
    end if;

    -- A corrected child round must agree with the actual parent round.
    perform public.velocity_held_observations(jsonb_build_object('action','decision','scope','row','id',row_lead,
      'requestId',gen_random_uuid(),'reason','Owning report proves exact first leg','evidenceUrl',official_url,
      'patch','{"round":"P","parentRelayResultId":"reviewed-round-parent-1","leadOffVerified":true}'::jsonb));
    select private.velocity_held_evaluate(o,null) into evaluated from private.velocity_held_observations o where id=row_lead;
    if evaluated->>'state' <> 'held' then raise exception 'An F parent must not authorize a P lead-off: %',evaluated; end if;
    decision := (public.velocity_held_observations(jsonb_build_object('action','decision','scope','row','id',row_lead,
      'requestId',gen_random_uuid(),'reason','Owning report proves exact preliminary relay','evidenceUrl',official_url,
      'patch','{"parentRelayResultId":"reviewed-round-parent-2"}'::jsonb))->>'decisionId')::uuid;
    perform public.velocity_held_observations(jsonb_build_object('action','revalidate','decisionId',decision));
    select private.velocity_held_evaluate(o,null) into evaluated from private.velocity_held_observations o where id=row_lead;
    if evaluated->>'state' <> 'ready' or evaluated#>>'{candidate,round}' <> 'P'
      or evaluated#>>'{candidate,parentRelayResultId}' <> 'reviewed-round-parent-2' then
      raise exception 'P parent must support the reviewed P lead-off despite raw F: %',evaluated;
    end if;
    receipt := public.velocity_held_observations(jsonb_build_object('action','submit','ids',jsonb_build_array(row_lead)));
    receipt := public.velocity_import_selection(jsonb_build_object('ids',(
      select jsonb_agg(import_row_id) from private.velocity_held_assessments where observation_id=row_lead)));
    receipt := public.approve_velocity_import((receipt->>'selectionId')::uuid);
    if receipt->>'approved' <> '1' then raise exception 'Reviewed preliminary lead-off did not approve: %',receipt; end if;
    select record_id into published_lead from private.velocity_held_assessments where observation_id=row_lead;
    if not exists(select 1 from public.public_swims where id=published_lead and data->>'round'='P'
      and data->>'resultOrigin'='relay_leadoff' and data->>'parentRelayResultId'='reviewed-round-parent-2') then
      raise exception 'The public lead-off lost its corrected round or parent';
    end if;

    for i in 5..10 loop
      select * into item from private.velocity_held_observations where source_meet_id=meet_source and source_row=i;
      oid := item.id;
      perform public.velocity_held_observations(jsonb_build_object('action','decision','scope','row','id',oid,
        'requestId',gen_random_uuid(),'reason','Verified owning source round','evidenceUrl',official_url,
        'patch',jsonb_build_object('round',case i when 5 then 'S' when 6 then 'F' else 'P' end)));
      evaluated := private.velocity_held_evaluate(item,case i when 9 then 'reviewed-round-correct-existing' end);
      if i=5 then
        if evaluated->>'state' <> 'held' then raise exception 'Reviewed S still needs a distinct occurrence: %',evaluated; end if;
        perform public.velocity_held_observations(jsonb_build_object('action','decision','scope','row','id',oid,
          'requestId',gen_random_uuid(),'reason','Verified distinct swim-off start','evidenceUrl',official_url,
          'patch','{"occurrence":"verified-swimoff"}'::jsonb));
        evaluated := private.velocity_held_evaluate(item,null);
        if evaluated->>'state' <> 'ready' or evaluated#>>'{candidate,round}' <> 'S' then raise exception 'Reviewed S occurrence failed: %',evaluated; end if;
        perform public.velocity_held_observations(jsonb_build_object('action','decision','scope','row','id',oid,
          'requestId',gen_random_uuid(),'reason','Verified time trial start','evidenceUrl',official_url,'patch','{"round":"TT"}'::jsonb));
        evaluated := private.velocity_held_evaluate(item,null);
        if evaluated->>'state' <> 'ready' or evaluated#>>'{candidate,round}' <> 'TT' then raise exception 'Reviewed TT failed: %',evaluated; end if;
      elsif i=6 and evaluated->>'state' <> 'held' then
        raise exception 'An unchanged reviewed F must not bypass the original audit conflict: %',evaluated;
      elsif i=7 and (evaluated->>'state' <> 'held' or evaluated->>'recordId' <> 'reviewed-round-conflicting-prelim') then
        raise exception 'Corrected rounds must preserve canonical conflicting-time checks: %',evaluated;
      elsif i=8 and (evaluated->>'state' <> 'published' or evaluated->>'recordId' <> 'reviewed-round-exact-prelim') then
        raise exception 'Corrected rounds must reuse an exact canonical preliminary: %',evaluated;
      elsif i=9 then
        if evaluated->>'state' <> 'ready' or evaluated#>>'{candidate,round}' <> 'P' or evaluated#>>'{current,round}' <> 'F' then
          raise exception 'Existing canonical result round correction failed: %',evaluated;
        end if;
        selection := private.velocity_held_stage_correction(item.worker_id,'swim','reviewed-round-correct-existing',
          evaluated->'current',evaluated->'candidate',official_url,'Owning report verifies original round correction');
        perform public.review_collection(selection,'approved','Verified original round');
        if not exists(select 1 from public.public_swims where id='reviewed-round-correct-existing' and data->>'round'='P') then
          raise exception 'Round corrections must persist on the same canonical result';
        end if;
      elsif i=10 and evaluated->>'state' <> 'outcome' then
        raise exception 'Round review must not turn DQ into a timed result: %',evaluated;
      end if;
    end loop;
    if (select jsonb_agg(to_jsonb(o) order by o.id) from private.velocity_held_observations o where o.source_meet_id=meet_source)
      is distinct from source_snapshot
      or (select jsonb_agg(to_jsonb(a) order by a.observation_id) from private.velocity_official_archive_acceptances a where a.run_id=fixture_run_id)
        is distinct from acceptance_snapshot
      or (select to_jsonb(r) from private.velocity_official_archive_runs r where r.id=fixture_run_id) is distinct from run_snapshot then
      raise exception 'Round correction changed immutable evidence or the original acceptance receipt';
    end if;
    if has_function_privilege('authenticated','private.velocity_held_evaluate_base(private.velocity_held_observations,text)','execute')
      or has_function_privilege('authenticated','private.velocity_held_record_decision(jsonb)','execute') then
      raise exception 'Round corrections exposed private evaluation or decision writers';
    end if;
  end;
  $test$;
`));
