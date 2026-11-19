-- Historical row decisions may omit a URL; this schema change is rolled back
-- with the entire fixture and tests the immutable source URL fallback.
alter table private.velocity_held_decisions alter column evidence_url drop not null;
do $test$
declare
  staff_id uuid:=gen_random_uuid();
  worker_token text:=gen_random_uuid()::text;
  fixture_athlete text:='official-source-lead-athlete';
  fixture_meet text:='official-source-lead-meet';
  source_meet text:='90000000000000000007';
  member_hash text:=repeat('7',24);
  official_url text:='https://www.gomotionapp.com/team/ievs/controller/cms/admin/index';
  fixture_run uuid:=gen_random_uuid();
  captures jsonb:='[]';
  base jsonb;
  observed jsonb;
  canonical jsonb;
  candidate jsonb;
  changed jsonb;
  known jsonb;
  parent jsonb;
  result jsonb;
  receipt jsonb;
  source private.velocity_held_observations;
  row_one uuid;
  row_prelim uuid;
  row_reverse uuid;
  row_duplicate uuid;
  accepted uuid[];
  decision_id uuid;
  first_decision uuid;
  newer_decision uuid;
  published_id text;
  prelim_id text;
  source_snapshot jsonb;
  acceptance_snapshot jsonb;
  i integer;
  rejected boolean;
begin
  insert into auth.users(id,email,email_confirmed_at,role)
    values(staff_id,'official-source-lead@example.test',now(),'authenticated');
  insert into public.administrators(user_id)values(staff_id);
  insert into private.collection_workers(name,token_hash,divisions)
    values('official-source-lead',encode(extensions.digest(worker_token,'sha256'),'hex'),array['times']);
  perform private.put_record('teams/velocity-swimming','{"name":"Velocity Swimming","lscCode":"IE","clubCode":"VS"}');
  perform private.put_record('athletes/'||fixture_athlete,jsonb_build_object(
    'name','{"first":"Source","last":"Lead"}'::jsonb,'gender','F',
    'sourceObservation',jsonb_build_object('memberIdHash',member_hash)));
  perform private.put_record('meets/'||fixture_meet,jsonb_build_object('name','Official source lead fixture',
    'course','SCY','startsOn','2026-11-13','endsOn','2026-11-14',
    'sourceObservation',jsonb_build_object('sourceMeetId',source_meet)));
  canonical:=jsonb_build_object('athleteId',fixture_athlete,'teamId','velocity-swimming',
    'isRelay',false,'isOfficial',true,'status','OK','gender','F','course','SCY','round','F',
    'eventCode','100_FR_SCY','distance',100,'stroke','FR','timeMs',60000,
    'splitCoverage','unavailable','splits','[]'::jsonb,
    'meet',jsonb_build_object('id',fixture_meet,'name','Official source lead fixture','date','2026-11-14'));
  perform private.put_record('swims/official-source-ordinary',canonical);
  base:=jsonb_build_object('sourceMeetId',source_meet,'workbookSha256',repeat('7',64),
    'kind','swim','round','F','clubCode','VS','sourceStatus','OK','memberIdHash',member_hash,
    'sourceUrl',official_url,'capturedAt','2026-11-17T00:00:00Z','holdReason','Choose a verified canonical swimmer.');
  for i in 1..12 loop
    observed:=jsonb_build_object('name','Lead, Source','meetName','Official source lead fixture',
      'raceDate','2026-11-14','eventCode','100_FR_SCY','category','F','timeMs',case i
        when 1 then 50000 when 2 then 53000 when 3 then 54000 when 4 then 55000
        when 5 then 56000 when 6 then 57000 when 7 then 58000 when 8 then 60000
        when 9 then 25000 when 12 then 50000 else 30000 end,'leadOff',i<>7,
      'raw',jsonb_build_object('Final',case i
        when 1 then '50.00Y L' when 2 then '53.00Y' when 3 then '54.00Y L'
        when 4 then '55.00Y L' when 5 then '56.00Y L' when 6 then '57.00Y L'
        when 7 then '58.00Y L' when 8 then '1:00.00Y L' when 9 then '25.00Y L' when 12 then '50.00Y L' else '30.00Y L' end));
    if i=6 then observed:=observed||'{"isOfficial":false}';end if;
    if i=8 then observed:=observed||'{"eventCode":"100_BK_SCY"}';end if;
    if i=9 then observed:=observed||'{"eventCode":"50_FR_SCY"}';end if;
    if i=10 then observed:=observed||'{"eventCode":"50_BK_SCY"}';end if;
    if i=11 then observed:=observed-'category';end if;
    captures:=captures||jsonb_build_array(base||jsonb_build_object('sourceRow',i,'observed',observed)
      ||case i when 3 then '{"sourceUrl":"https://example.test/untrusted"}'::jsonb
        when 4 then '{"sourceStatus":"DQ"}'::jsonb when 5 then '{"clubCode":"CUDA"}'::jsonb else '{}'::jsonb end);
  end loop;
  receipt:=public.stage_velocity_held_observations(worker_token,captures);
  if receipt->>'inserted'<>'12'then raise exception 'Official lead fixtures did not stage: %',receipt;end if;
  select id into row_one from private.velocity_held_observations where source_meet_id=source_meet and source_row=1;
  select id into row_prelim from private.velocity_held_observations where source_meet_id=source_meet and source_row=8;
  select id into row_reverse from private.velocity_held_observations where source_meet_id=source_meet and source_row=10;
  select id into row_duplicate from private.velocity_held_observations where source_meet_id=source_meet and source_row=12;
  select array_agg(id order by id)into accepted from private.velocity_held_observations
    where source_meet_id=source_meet and source_row<>9;
  insert into private.velocity_official_archive_runs(id,started_by,started_via,completed_at,observation_ids,processed,source_only)
    values(fixture_run,staff_id,'staff',now(),accepted,cardinality(accepted),cardinality(accepted));
  insert into private.velocity_official_archive_acceptances(observation_id,run_id,disposition,reason)
    select id,fixture_run,'source_only','Choose a verified canonical swimmer.'
    from private.velocity_held_observations where id=any(accepted);
  select jsonb_agg(to_jsonb(o)order by o.id)into source_snapshot
    from private.velocity_held_observations o where o.source_meet_id=source_meet;
  select jsonb_agg(to_jsonb(a)order by a.observation_id)into acceptance_snapshot
    from private.velocity_official_archive_acceptances a where a.run_id=fixture_run;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',staff_id,'role','authenticated')::text,true);

  select private.velocity_held_evaluate(o,null)into result from private.velocity_held_observations o where id=row_one;
  if result->>'state'<>'held'then raise exception 'Literal L alone must still require row approval: %',result;end if;
  for i in 1..2 loop
    select *into source from private.velocity_held_observations where id=case i when 1 then row_one else row_prelim end;
    decision_id:=(public.velocity_held_observations(jsonb_build_object('action','decision','scope','row',
      'id',source.id,'requestId',gen_random_uuid(),'reason','Verified official source first-leg timing',
      'evidenceUrl',official_url,'patch',jsonb_build_object('meetId',fixture_meet,'raceDate',case i when 1 then '2026-11-14'else'2026-11-13'end,
        'round',case i when 1 then'F'else'P'end,'leadOffVerified',true)))->>'decisionId')::uuid;
    if i=1 then first_decision:=decision_id;end if;
    update private.velocity_held_decisions set evidence_url=case i when 1 then null else 'http://example.test/reviewed-first-leg' end
      where id=decision_id;
    perform public.velocity_held_observations(jsonb_build_object('action','revalidate','decisionId',decision_id));
    result:=private.velocity_held_evaluate(source,null);
    if result->>'state'<>'ready'or not private.velocity_official_source_leadoff(result->'candidate')
      or result#>>'{candidate,resultOrigin}'<>'relay_leadoff'
      or result#>>'{candidate,parentRelayResultId}'is not null then
      raise exception 'Official parentless lead should be ready without an invented relay: %',result;end if;
    receipt:=public.velocity_held_observations(jsonb_build_object('action','submit','ids',jsonb_build_array(source.id)));
    receipt:=public.velocity_import_selection(jsonb_build_object('ids',(
      select jsonb_agg(import_row_id)from private.velocity_held_assessments where observation_id=source.id)));
    receipt:=public.approve_velocity_import((receipt->>'selectionId')::uuid);
    if receipt->>'approved'<>'1'then raise exception 'Normal approval rejected official lead: %',receipt;end if;
    if i=1 then select record_id into published_id from private.velocity_held_assessments where observation_id=source.id;
    else select record_id into prelim_id from private.velocity_held_assessments where observation_id=source.id;end if;
  end loop;
  select data into canonical from public.swims where id=published_id;
  if not private.velocity_official_source_leadoff(canonical)
    or canonical#>>'{leadOffVerification,decisionId}'<>first_decision::text
    or canonical#>>'{leadOffVerification,sourceUrl}'<>official_url then
    raise exception 'The canonical source proof must bind its recorded decision';end if;
  if (select data#>>'{leadOffVerification,sourceUrl}'from public.swims where id=prelim_id)<>'http://example.test/reviewed-first-leg'then
    raise exception 'The existing safe HTTP source URL contract must remain valid';end if;
  if (select count(*)from public.public_swims where id in(published_id,prelim_id)
      and data->>'resultOrigin'='relay_leadoff'and not(data?'parentRelayResultId')
      and not(data?'leadOffVerification')and not(data?'sourceObservation'))<>2 then
    raise exception 'Public projection leaked private proof or hid the lead-offs';end if;
  if not exists(select 1 from public.public_swims where id=prelim_id and data->>'round'='P'and data#>>'{meet,date}'='2026-11-13')then
    raise exception 'Reviewed actual date/round must survive a raw F source';end if;
  if (select count(*)from private.velocity_rankable_swims where id in(published_id,prelim_id))<>2
    or not exists(select 1 from public.athlete_bests where athlete_id=fixture_athlete and event_code='100_FR_SCY'and data->>'swimId'=published_id)then
    raise exception 'Official parentless lead-offs must participate in normal bests';end if;
  result:=public.ies_times_query('rankings',jsonb_build_object('event','100_FR','course','SCY','genders','["F"]'::jsonb,
    'team','velocity-swimming','official','official','search','Source Lead','mode','performances'));
  if not exists(select 1 from jsonb_array_elements(result->'rows')r
    where r#>>'{race,id}'=published_id and(r->>'rank')::int>0)then
    raise exception 'Normal public Times rankings lost the source lead-off: %',result;end if;

  -- A second accepted observation corroborates the same canonical start and
  -- retains the first live proof through repeated evaluations and later review.
  decision_id:=(public.velocity_held_observations(jsonb_build_object('action','decision','scope','row',
    'id',row_duplicate,'requestId',gen_random_uuid(),'reason','Corroborating official first-leg source',
    'evidenceUrl',official_url,'patch',jsonb_build_object('meetId',fixture_meet,'raceDate','2026-11-14','round','F','leadOffVerified',true)))->>'decisionId')::uuid;
  perform public.velocity_held_observations(jsonb_build_object('action','revalidate','decisionId',decision_id));
  for i in 1..3 loop
    select private.velocity_held_evaluate(o,null)into result from private.velocity_held_observations o where id=row_duplicate;
    if result->>'state'<>'published'or result->>'recordId'<>published_id
      or result#>'{current,leadOffVerification}'is distinct from canonical->'leadOffVerification'then
      raise exception 'Corroborating observation rotated the live proof or proposed another result: %',result;end if;
    select private.velocity_held_evaluate(o,null)into result from private.velocity_held_observations o where id=row_one;
    if result->>'state'<>'published'then raise exception 'Original observation stopped being published: %',result;end if;
  end loop;
  decision_id:=(public.velocity_held_observations(jsonb_build_object('action','decision','scope','row',
    'id',row_duplicate,'requestId',gen_random_uuid(),'reason','Later unrelated corroborating review',
    'evidenceUrl',official_url,'patch','{"leadOffVerified":true}'::jsonb))->>'decisionId')::uuid;
  perform public.velocity_held_observations(jsonb_build_object('action','revalidate','decisionId',decision_id));
  select private.velocity_held_evaluate(o,null)into result from private.velocity_held_observations o where id=row_duplicate;
  if result->>'state'<>'published'or result#>'{current,leadOffVerification}'is distinct from canonical->'leadOffVerification'then
    raise exception 'Later unrelated row review rotated the live proof: %',result;end if;

  -- A later pending/rejected review cannot alter the old recorded proof.
  newer_decision:=(public.velocity_held_observations(jsonb_build_object('action','decision','scope','row',
    'id',row_one,'requestId',gen_random_uuid(),'reason','Pending a separate source timing review',
    'evidenceUrl',official_url,'patch','{"leadOffVerified":false}'::jsonb))->>'decisionId')::uuid;
  if not private.velocity_official_source_leadoff(canonical)then raise exception 'Latest review must not invalidate old live proof';end if;
  perform private.put_record('swims/'||published_id,canonical);
  select private.velocity_held_evaluate(o,published_id)into result from private.velocity_held_observations o where id=row_one;
  if result->>'state'<>'held'then raise exception 'The unapproved newer review must not authorize a new proof: %',result;end if;

  for changed in select value from jsonb_array_elements(jsonb_build_array(
    canonical-'leadOffVerification',
    jsonb_set(canonical,'{leadOffVerification,observationId}',to_jsonb(gen_random_uuid()::text)),
    jsonb_set(canonical,'{leadOffVerification,decisionId}',to_jsonb(gen_random_uuid()::text)),
    jsonb_set(canonical,'{leadOffVerification,decisionId}',to_jsonb(newer_decision::text)),
    jsonb_set(canonical,'{leadOffVerification,workbookSha256}',to_jsonb(repeat('0',64))),
    jsonb_set(canonical,'{leadOffVerification,memberIdHash}',to_jsonb(repeat('0',24))),
    jsonb_set(canonical,'{leadOffVerification,sourceRow}','999'::jsonb),
    jsonb_set(canonical,'{leadOffVerification,flatStart}','false'::jsonb),
    jsonb_set(canonical,'{leadOffVerification,sourceUrl}','"https://example.test/forged"'::jsonb),
    jsonb_set(canonical,'{leadOffVerification,sourceUrl}','null'::jsonb),
    jsonb_set(canonical,'{leadOffVerification,sourceUrl}','"javascript:alert(1)"'::jsonb),
    jsonb_set(canonical,'{leadOffVerification,sourceUrl}','"https://user@example.test/path"'::jsonb),
    canonical||'{"timeMs":50010}',canonical||'{"athleteId":"wrong-source-athlete"}',
    canonical||'{"course":"LCM","eventCode":"100_FR_LCM"}',
    canonical||'{"eventCode":"100_BK_SCY","stroke":"BK"}',
    canonical||'{"round":"P"}',canonical||'{"gender":"M"}',canonical-'gender',
    jsonb_set(canonical,'{meet,date}','"2026-11-13"'::jsonb),
    canonical||'{"isSplit":true}',canonical||'{"isRelaySplit":true}',canonical||'{"isRelay":true}',
    canonical||'{"isOfficial":false}',canonical||'{"resultOrigin":"individual"}',
    canonical||'{"raceIdentity":{"occurrence":"forged-other-start","reviewed":true,"basis":"Forged occurrence","sourceUrl":"https://example.test/forged"}}'
  ))loop
    if private.velocity_official_source_leadoff(changed)then raise exception 'Forged or changed source proof was accepted';end if;
  end loop;
  changed:=(canonical-array['id','externalResult'])||'{"eventCode":"50_FL_SCY","distance":50,"stroke":"FL","timeMs":29000}';
  rejected:=false;begin perform private.put_record('swims/official-source-forged-flying',changed);
    exception when raise_exception then
      if sqlerrm not like '%parentless lead-off requires%'then raise;end if;
      rejected:=true;end;
  if not rejected then raise exception 'Core writer accepted untrusted/flying parentless evidence';end if;

  -- A textual true value is not the explicit boolean approval in the ledger.
  decision_id:=(public.velocity_held_observations(jsonb_build_object('action','decision','scope','row',
    'id',row_one,'requestId',gen_random_uuid(),'reason','Negative nonboolean timing approval',
    'evidenceUrl',official_url,'patch','{"leadOffVerified":"true"}'::jsonb))->>'decisionId')::uuid;
  if private.velocity_official_source_leadoff(jsonb_set(canonical,'{leadOffVerification,decisionId}',to_jsonb(decision_id::text)))then
    raise exception 'A textual timing approval must not authorize source-only timing';end if;

  -- Every source-level exclusion remains effective despite JSON true flags.
  for i in 2..9 loop
    if i=8 then continue;end if;
    select *into source from private.velocity_held_observations where source_meet_id=source_meet and source_row=i;
    decision_id:=(public.velocity_held_observations(jsonb_build_object('action','decision','scope','row',
      'id',source.id,'requestId',gen_random_uuid(),'reason','Negative official lead fixture review',
      'evidenceUrl',official_url,'patch',jsonb_build_object('meetId',fixture_meet,'raceDate','2026-11-14',
        'leadOffVerified',true,'officialVerified',true)))->>'decisionId')::uuid;
    changed:=canonical||jsonb_build_object('timeMs',(source.observed->>'timeMs')::int,
      'eventCode',source.observed->>'eventCode','distance',split_part(source.observed->>'eventCode','_',1)::int,
      'stroke',split_part(source.observed->>'eventCode','_',2),'leadOffVerification',
      canonical->'leadOffVerification'||jsonb_build_object('observationId',source.id,'decisionId',decision_id,'sourceRow',source.source_row));
    if private.velocity_official_source_leadoff(changed)then raise exception 'Noneligible immutable source passed: row %',i;end if;
  end loop;

  -- The predicate itself rejects category NULL even when both source and body omit it.
  select *into source from private.velocity_held_observations where source_meet_id=source_meet and source_row=11;
  decision_id:=(public.velocity_held_observations(jsonb_build_object('action','decision','scope','row',
    'id',source.id,'requestId',gen_random_uuid(),'reason','Negative missing category approval',
    'evidenceUrl',official_url,'patch',jsonb_build_object('meetId',fixture_meet,'raceDate','2026-11-14','leadOffVerified',true)))->>'decisionId')::uuid;
  changed:=(canonical-'gender')||jsonb_build_object('timeMs',30000,'leadOffVerification',
    canonical->'leadOffVerification'||jsonb_build_object('observationId',source.id,'decisionId',decision_id,'sourceRow',11));
  if private.velocity_official_source_leadoff(changed)then raise exception 'NULL source/body category must fail closed';end if;

  parent:=(canonical-array['id','athleteId','sourceObservation','leadOffVerification','resultOrigin','externalResult','raceIdentity'])||
    jsonb_build_object('id','official-source-known-parent','isRelay',true,'eventCode','400_FR-R_SCY','distance',400,'stroke','FR','timeMs',220000,'relayName','A',
      'members',jsonb_build_array(jsonb_build_object('leg',1,'athleteId',fixture_athlete,'name','Source Lead','timeMs',50000)));
  perform private.put_record('relay_results/official-source-known-parent',parent);
  known:=(canonical-array['id','externalResult','sourceObservation'])||jsonb_build_object('parentRelayResultId','official-source-known-parent',
    'leadOffVerification','{"verified":true,"flatStart":true,"timingVerified":true,"leadOffStatus":"OK","sourceUrl":"https://example.test/known-parent"}'::jsonb);
  rejected:=false;begin perform private.put_record('swims/official-source-known-duplicate',known);
    exception when unique_violation then rejected:=true;end;
  if not rejected then raise exception 'Known-parent insert duplicated the existing parentless first leg';end if;
  -- A conflicting time does not create a second start with the same identity.
  begin
    perform private.put_record('relay_results/official-source-known-parent',jsonb_set(parent,'{members,0,timeMs}','50010'::jsonb));
    rejected:=false;begin perform private.put_record('swims/official-source-known-different-time',known||'{"timeMs":50010}');
      exception when unique_violation then rejected:=true;end;
    if not rejected then raise exception 'Different-time known parent duplicated the existing parentless start';end if;
    raise exception using errcode='ZX001',message='Rollback different-time parent fixture';
  exception when sqlstate 'ZX001' then null;end;

  -- Explicit, separately reviewed occurrence tokens remain distinct starts.
  known:=known||'{"raceIdentity":{"occurrence":"known-second-start","reviewed":true,"basis":"A separately reviewed second relay start","sourceUrl":"https://example.test/second"}}';
  perform private.put_record('swims/official-source-known-distinct',known);
  if not private.velocity_official_source_leadoff(canonical)then raise exception 'A different reviewed occurrence must not invalidate the first start';end if;
  changed:=(canonical-array['id','externalResult'])||'{"parentRelayResultId":"missing-supplied-parent"}';
  rejected:=false;begin perform private.put_record('swims/official-source-invalid-parent',changed||
    '{"raceIdentity":{"occurrence":"invalid-parent-start","reviewed":true,"basis":"Fixture","sourceUrl":"https://example.test/parent"}}');
    exception when raise_exception then
      if sqlerrm not like '%linked first member%'then raise;end if;
      rejected:=true;end;
  if not rejected then raise exception 'A supplied missing parent incorrectly fell back to source verification';end if;

  -- Reverse insertion order also rejects a parentless duplicate.
  select *into source from private.velocity_held_observations where id=row_reverse;
  decision_id:=(public.velocity_held_observations(jsonb_build_object('action','decision','scope','row',
    'id',row_reverse,'requestId',gen_random_uuid(),'reason','Verified preliminary first-leg timing',
    'evidenceUrl',official_url,'patch',jsonb_build_object('meetId',fixture_meet,'raceDate','2026-11-13','round','P','leadOffVerified',true)))->>'decisionId')::uuid;
  result:=private.velocity_held_evaluate(source,null);candidate:=result->'candidate';
  if result->>'state'<>'ready'then raise exception 'Reverse duplicate fixture was not ready: %',result;end if;
  parent:=jsonb_build_object('id','official-source-reverse-parent','teamId','velocity-swimming','isRelay',true,'isOfficial',true,'status','OK','gender','F',
    'eventCode','200_MED-R_SCY','distance',200,'stroke','IM','course','SCY','round','P','timeMs',120000,'relayName','B',
    'splitCoverage','unavailable','splits','[]'::jsonb,'meet',jsonb_build_object('id',fixture_meet,'name','Official source lead fixture','date','2026-11-13'),
    'members',jsonb_build_array(jsonb_build_object('leg',1,'athleteId',fixture_athlete,'name','Source Lead','timeMs',30010)));
  perform private.put_record('relay_results/official-source-reverse-parent',parent);
  known:=(candidate-array['id','externalResult','sourceObservation','leadOffVerification'])||
    jsonb_build_object('parentRelayResultId','official-source-reverse-parent','timeMs',30010,
      'leadOffVerification','{"verified":true,"flatStart":true,"timingVerified":true,"leadOffStatus":"OK","sourceUrl":"https://example.test/known-reverse"}'::jsonb);
  perform private.put_record('swims/official-source-known-first',known);
  if private.velocity_official_source_leadoff(candidate)then raise exception 'Known-parent child did not block source duplicate';end if;
  rejected:=false;begin perform private.put_record('swims/official-source-parentless-second',candidate);
    exception when unique_violation then rejected:=true;end;
  if not rejected then raise exception 'Parentless insert duplicated the different-time known first leg';end if;

  -- The versioned row review must also approve a non-single source occurrence.
  decision_id:=(public.velocity_held_observations(jsonb_build_object('action','decision','scope','row',
    'id',row_one,'requestId',gen_random_uuid(),'reason','Verified separately reviewed third start',
    'evidenceUrl',official_url,'patch','{"leadOffVerified":true,"occurrence":"source-third-start"}'::jsonb))->>'decisionId')::uuid;
  select private.velocity_held_evaluate(o,null)into result from private.velocity_held_observations o where id=row_one;
  if result->>'state'<>'ready'or not private.velocity_official_source_leadoff(result->'candidate')then
    raise exception 'An explicit reviewed distinct source occurrence should pass: %',result;end if;
  perform private.put_record('swims/'||(result->>'recordId'),result->'candidate');

  if (select jsonb_agg(to_jsonb(o)order by o.id)from private.velocity_held_observations o where o.source_meet_id=source_meet)
    is distinct from source_snapshot then raise exception 'Immutable observations changed';end if;
  if (select jsonb_agg(to_jsonb(a)order by a.observation_id)from private.velocity_official_archive_acceptances a where a.run_id=fixture_run)
    is distinct from acceptance_snapshot then raise exception 'Archive acceptance receipt changed';end if;
  if has_function_privilege('anon','private.velocity_official_source_leadoff(jsonb)','execute')
    or has_function_privilege('authenticated','private.velocity_official_source_leadoff(jsonb)','execute')
    or has_function_privilege('service_role','private.velocity_official_source_leadoff(jsonb)','execute')then
    raise exception 'Private source-proof predicate must not be an exposed RPC';end if;
end;
$test$;
