import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const workdir = process.env.VELOCITY_IMPORT_TEST_WORKDIR ?? ".";
const project = readFileSync(join(workdir, "supabase/config.toml"), "utf8")
  .match(/^project_id = "([a-zA-Z0-9_-]+)"/m)?.[1];

function checkRelay(statement) {
  if (!project) throw new Error("A local Supabase project is required.");
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

test("reviewed relay and first-leg athlete corrections preserve the existing records and source identities", () => checkRelay(`
  do $test$
  declare
    staff_id uuid := gen_random_uuid();
    worker_token text := gen_random_uuid()::text;
    preferred text := 'relay-link-preferred-profile';
    verified text := 'relay-link-verified-profile';
    fixture_meet text := 'relay-link-test-meet';
    parent_id text := 'relay-link-test-parent';
    child_id text := 'relay-link-test-child';
    source_url text := 'https://www.gomotionapp.com/team/ievs/controller/cms/admin/index';
    parent_before jsonb;
    child_before jsonb;
    parent_after jsonb;
    child_after jsonb;
    unrelated jsonb;
    profiles_before jsonb;
    athlete_claims_before jsonb;
    aliases_before jsonb;
    occurrence_before uuid;
    public_parent_before jsonb;
    public_child_before jsonb;
    batch jsonb;
    review_batch_id uuid;
    revision_before bigint;
    i integer;
  begin
    insert into auth.users(id,email,email_confirmed_at,role)
      values(staff_id,'relay-link-staff@example.test',now(),'authenticated');
    insert into public.administrators(user_id) values(staff_id);
    insert into private.collection_workers(name,token_hash,divisions)
      values('relay-link-fixture',encode(extensions.digest(worker_token,'sha256'),'hex'),array['times']);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',staff_id,'role','authenticated')::text,true);
    perform private.put_record('teams/velocity-swimming','{"name":"Velocity Swimming","lscCode":"IE","clubCode":"VS"}');
    perform private.put_record('meets/' || fixture_meet,jsonb_build_object('name','Relay correction fixture',
      'startsOn','2026-02-27','endsOn','2026-03-01','course','SCY'));
    -- These are independent profiles. Correct only the source-proven race link;
    -- the fixture does not assert the profiles represent the same person.
    perform private.put_record('athletes/' || preferred,jsonb_build_object(
      'name','{"first":"Preferred","last":"Profile"}'::jsonb,'gender','M',
      'aliases','["Legacy profile spelling"]'::jsonb,
      'sourceObservation',jsonb_build_object('memberIdHash',repeat('2',24))));
    perform private.put_record('athletes/' || verified,jsonb_build_object(
      'name','{"first":"Verified","last":"Target"}'::jsonb,'gender','M',
      'sourceObservation',jsonb_build_object('memberIdHash',repeat('3',24))));
    for i in 2..4 loop
      perform private.put_record('athletes/relay-link-member-' || i,
        jsonb_build_object('name',jsonb_build_object('first','Fixture','last','Member' || i),'gender','M'));
    end loop;
    parent_before := jsonb_build_object('id',parent_id,'teamId','velocity-swimming','isRelay',true,
      'eventCode','200_MED-R_SCY','distance',200,'stroke','IM','course','SCY','round','F',
      'gender','M','status','OK','timeMs',110000,'isOfficial',true,'relayName','Fixture relay',
      'splitCoverage','unavailable','splits','[]'::jsonb,
      'meet',jsonb_build_object('id',fixture_meet,'name','Relay correction fixture','date','2026-02-28'),
      'metadata',jsonb_build_object('source','hytek_hy3','archiveSha256',repeat('a',64),'sourceRow',123),
      'externalResult',jsonb_build_object('namespace','hytek-hy3','id','relay-link-original-parent'),
      'members',jsonb_build_array(
        jsonb_build_object('leg',1,'athleteId',preferred,'name','Preferred source name','timeMs',25330),
        jsonb_build_object('leg',2,'athleteId','relay-link-member-2','name','Second member','timeMs',28000),
        jsonb_build_object('leg',3,'athleteId','relay-link-member-3','name','Third member','timeMs',27000),
        jsonb_build_object('leg',4,'athleteId','relay-link-member-4','name','Fourth member','timeMs',26000)));
    perform private.put_record('relay_results/' || parent_id,parent_before);
    child_before := jsonb_build_object('id',child_id,'athleteId',preferred,'teamId','velocity-swimming','isRelay',false,
      'eventCode','50_BK_SCY','distance',50,'stroke','BK','course','SCY','round','F','gender','M',
      'status','OK','timeMs',25330,'isOfficial',true,'resultOrigin','relay_leadoff','parentRelayResultId',parent_id,
      'splitCoverage','unavailable','splits','[]'::jsonb,'meet',parent_before->'meet',
      'metadata',jsonb_build_object('source','hytek_hy3','archiveSha256',repeat('a',64),'sourceRow',124),
      'sourceObservation',jsonb_build_object('method','Official retained HY3 first-leg result','sourceUrl',source_url),
      'externalResult',jsonb_build_object('namespace','hytek-hy3','id','relay-link-original-child'),
      'leadOffVerification',jsonb_build_object('verified',true,'flatStart',true,'timingVerified',true,
        'leadOffStatus','OK','sourceUrl',source_url));
    perform private.put_record('swims/' || child_id,child_before);
    unrelated := (child_before - array['resultOrigin','parentRelayResultId','leadOffVerification']) ||
      '{"id":"relay-link-unrelated-history","eventCode":"50_FR_SCY","stroke":"FR","timeMs":26000,
        "externalResult":{"namespace":"hytek-hy3","id":"relay-link-unrelated-original"}}'::jsonb;
    perform private.put_record('swims/relay-link-unrelated-history',unrelated);
    select id into occurrence_before from private.result_occurrences where kind='swim' and result_id=child_id;
    perform private.claim_result_source('swim','secondary-official-result','relay-link-secondary-alias',occurrence_before,'{}');
    select jsonb_agg(to_jsonb(a) order by a.id) into profiles_before from public.athletes a where a.id in
      (preferred,verified,'relay-link-member-2','relay-link-member-3','relay-link-member-4');
    select jsonb_agg(to_jsonb(a) order by a.namespace,a.source_id) into athlete_claims_before
      from private.athlete_source_identities a where a.athlete_id in(preferred,verified);
    select jsonb_agg(to_jsonb(s) order by s.kind,s.namespace,s.source_id) into aliases_before
      from private.result_source_identities s join private.result_occurrences o on o.id=s.occurrence_id
      where o.result_id in(parent_id,child_id,'relay-link-unrelated-history');
    select data into public_parent_before from public.public_relay_results where id=parent_id;
    select data into public_child_before from public.public_swims where id=child_id;
    parent_after := jsonb_set(parent_before,'{members,0,athleteId}',to_jsonb(verified));
    child_after := child_before || jsonb_build_object('athleteId',verified,'raceIdentity',jsonb_build_object(
      'occurrence','single','reviewed',true,'basis','Official member ID proves this race first-leg athlete link','sourceUrl',source_url));

    if not exists(select 1 from pg_trigger where tgrelid='public.relay_results'::regclass
      and tgname='relay_leadoff_children_consistent' and tgdeferrable and not tginitdeferred)
      or has_function_privilege('authenticated','private.check_relay_leadoff_children()','execute') then
      raise exception 'The graph constraint must be private, deferrable and initially immediate';
    end if;
    begin
      perform private.put_record('relay_results/' || parent_id,parent_after);
      raise exception 'Immediate parent-only mismatch was accepted' using errcode='ZX001';
    exception when raise_exception then
      if sqlerrm <> 'Correct or remove the verified lead-off before changing its relay member' then raise; end if;
    end;
    begin
      perform private.put_record('swims/' || child_id,child_after);
      raise exception 'Child-before-parent mismatch was accepted' using errcode='ZX001';
    exception when raise_exception then
      if sqlerrm <> 'Relay lead-offs require a linked first member and independent verified flat-start timing evidence' then raise; end if;
    end;
    begin
      set constraints public.relay_leadoff_children_consistent deferred;
      perform private.put_record('relay_results/' || parent_id,jsonb_set(parent_after,'{members,0,leg}','5'));
      raise exception 'Deferral bypassed structural validation' using errcode='ZX001';
    exception when raise_exception then
      if sqlerrm <> 'Relay members require unique ordered legs and a public name' then raise; end if;
    end;
    begin
      set constraints public.relay_leadoff_children_consistent deferred;
      perform private.put_record('relay_results/' || parent_id,parent_after);
      set constraints public.relay_leadoff_children_consistent immediate;
      raise exception 'Invalid final graph passed deferred validation' using errcode='ZX001';
    exception when raise_exception then
      if sqlerrm <> 'Correct or remove the verified lead-off before changing its relay member' then raise; end if;
    end;
    -- Explicit deferral also supports an operator's single transaction. Undo
    -- this successful trial so the normal approval path starts from old facts.
    begin
      set constraints public.relay_leadoff_children_consistent deferred;
      perform private.put_record('relay_results/' || parent_id,parent_after);
      perform private.put_record('swims/' || child_id,child_after);
      set constraints public.relay_leadoff_children_consistent immediate;
      if (select athlete_id from public.swims where id=child_id) <> verified then
        raise exception 'Atomic same-ID child correction failed';
      end if;
      raise exception 'Rollback successful synthetic trial' using errcode='ZX002';
    exception when sqlstate 'ZX002' then null;
    end;

    batch := jsonb_build_object('division','times','scope','Reviewed relay first-leg athlete correction',
      'sourceUrl',source_url,'capturedAt','2026-11-17T19:00:00Z','coverage','partial',
      'evidence',jsonb_build_object('reason','Official full member ID proves this race link, without a profile merge'),
      'writes',jsonb_build_array(jsonb_build_object('path','relay_results/' || parent_id,'after',parent_after)));
    review_batch_id := private.stage_collection(worker_token,batch);
    select revision into revision_before from private.canonical_revision where singleton;
    begin
      perform public.review_collection(review_batch_id,'approved','Reviewed incomplete parent-only correction');
      raise exception 'Approval returned success for an invalid final graph' using errcode='ZX001';
    exception when raise_exception then
      if sqlerrm <> 'Correct or remove the verified lead-off before changing its relay member' then raise; end if;
    end;
    if (select status from public.collection_batches where id=review_batch_id) <> 'pending'
      or exists(select 1 from public.collection_reviews where collection_reviews.batch_id=review_batch_id)
      or (select revision from private.canonical_revision where singleton) <> revision_before
      or (select data from public.relay_results where id=parent_id) is distinct from parent_before
      or (select data from public.swims where id=child_id) is distinct from child_before
      or (select data from public.public_relay_results where id=parent_id) is distinct from public_parent_before
      or (select data from public.public_swims where id=child_id) is distinct from public_child_before then
      raise exception 'Rejected final graph left a partial write, projection or decision';
    end if;
    -- Force multiple queued NEW images: the final parent row must be checked.
    begin
      set constraints public.relay_leadoff_children_consistent deferred;
      perform private.put_record('relay_results/' || parent_id,parent_after);
      perform private.put_record('relay_results/' || parent_id,parent_before);
      set constraints public.relay_leadoff_children_consistent immediate;
      raise exception 'Rollback final-row trial' using errcode='ZX002';
    exception when sqlstate 'ZX002' then null;
    end;

    -- The supplied JSON lists the child first. Existing approval ordering must
    -- still apply the parent first and enforce the final graph before return.
    batch := jsonb_set(batch,'{writes}',jsonb_build_array(
      jsonb_build_object('path','swims/' || child_id,'after',child_after),
      jsonb_build_object('path','relay_results/' || parent_id,'after',parent_after)));
    review_batch_id := private.stage_collection(worker_token,batch);
    perform public.review_collection(review_batch_id,'approved','Verified same-race parent and first-leg athlete correction');
    if (select status from public.collection_batches where id=review_batch_id) <> 'approved'
      or (select data from public.relay_results where id=parent_id) is distinct from parent_after
      or (select data from public.swims where id=child_id) is distinct from child_after
      or not exists(select 1 from public.public_swims where id=child_id and athlete_id=verified
        and data->>'resultOrigin'='relay_leadoff' and data->>'parentRelayResultId'=parent_id
        and data->>'timeMs'='25330' and data->>'isOfficial'='true')
      or not exists(select 1 from public.public_relay_results where id=parent_id
        and data#>>'{members,0,athleteId}'=verified and data->>'timeMs'='110000')
      or not exists(select 1 from public.athlete_bests where athlete_id=verified and data->>'swimId'=child_id)
      or exists(select 1 from public.athlete_bests where athlete_id=preferred and data->>'swimId'=child_id)
      or (select data from public.swims where id='relay-link-unrelated-history') is distinct from unrelated then
      raise exception 'Approved same-ID correction failed to preserve race facts or rebuild the linked athlete best';
    end if;
    if (select id from private.result_occurrences where kind='swim' and result_id=child_id) is distinct from occurrence_before
      or (select jsonb_agg(to_jsonb(s) order by s.kind,s.namespace,s.source_id)
        from private.result_source_identities s join private.result_occurrences o on o.id=s.occurrence_id
        where o.result_id in(parent_id,child_id,'relay-link-unrelated-history')) is distinct from aliases_before
      or (select jsonb_agg(to_jsonb(a) order by a.id) from public.athletes a where a.id in
        (preferred,verified,'relay-link-member-2','relay-link-member-3','relay-link-member-4')) is distinct from profiles_before
      or (select jsonb_agg(to_jsonb(a) order by a.namespace,a.source_id) from private.athlete_source_identities a
        where a.athlete_id in(preferred,verified)) is distinct from athlete_claims_before then
      raise exception 'Race correction changed profile history, stable source aliases or the occurrence ID';
    end if;
    begin
      perform private.put_record('relay_results/' || parent_id,parent_before);
      raise exception 'Ordinary writers stayed deferred after approval' using errcode='ZX001';
    exception when raise_exception then
      if sqlerrm <> 'Correct or remove the verified lead-off before changing its relay member' then raise; end if;
    end;
    begin
      set constraints public.relay_leadoff_children_consistent deferred;
      perform private.put_record('swims/relay-link-alias-conflict',
        (child_after - array['resultOrigin','parentRelayResultId','leadOffVerification','raceIdentity']) ||
          '{"id":"relay-link-alias-conflict"}'::jsonb);
      raise exception 'Deferral bypassed stable result source aliases' using errcode='ZX001';
    exception when unique_violation then null;
    end;
    begin
      set constraints public.relay_leadoff_children_consistent deferred;
      perform private.put_record('swims/' || child_id,
        jsonb_set(child_after,'{sourceObservation,memberIdHash}',to_jsonb(repeat('2',24))));
      raise exception 'Deferral bypassed the source athlete identity guard' using errcode='ZX001';
    exception when unique_violation then null;
    end;
  end;
  $test$;
`));
