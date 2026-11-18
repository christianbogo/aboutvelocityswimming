-- Accept an explicitly reviewed official GoMotion first-leg result without
-- inventing an unknown relay or attributing a school relay to Velocity.
-- The proof references an immutable observation and one recorded row decision.
create function private.velocity_official_source_leadoff(body jsonb)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  source private.velocity_held_observations;
  decision private.velocity_held_decisions;
  proof jsonb := body->'leadOffVerification';
  target_id text;
  display text;
  timing_course text;
  source_event_code text;
begin
  if jsonb_typeof(body) is distinct from 'object'
    or jsonb_typeof(proof) is distinct from 'object'
    or body->>'resultOrigin' is distinct from 'relay_leadoff'
    or body->>'parentRelayResultId' is not null
    or coalesce(body->>'isRelay','false') <> 'false'
    or coalesce(body->>'isSplit','false') <> 'false'
    or coalesce(body->>'isRelaySplit','false') <> 'false'
    or body->>'teamId' is distinct from 'velocity-swimming'
    or body->>'status' is distinct from 'OK' or body->'isOfficial' is distinct from 'true'::jsonb
    or proof->>'method' is distinct from 'Official GoMotion lead-off'
    or proof->'verified' is distinct from 'true'::jsonb
    or proof->'flatStart' is distinct from 'true'::jsonb
    or proof->'timingVerified' is distinct from 'true'::jsonb
    or proof->>'leadOffStatus' is distinct from 'OK'
    or coalesce(proof->>'observationId','') !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
    or coalesce(proof->>'decisionId','') !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
  then return false; end if;

  select * into source from private.velocity_held_observations
    where id=(proof->>'observationId')::uuid;
  select * into decision from private.velocity_held_decisions
    where id=(proof->>'decisionId')::uuid and scope='row' and observation_id=source.id;
  if source.id is null or decision.id is null
    or source.source_url is distinct from private.velocity_official_archive_source()
    or source.kind is distinct from 'swim' or source.source_status is distinct from 'OK'
    or source.club_code is distinct from 'VS' or source.member_id_hash is null
    or source.observed->'leadOff' is distinct from 'true'::jsonb
    or source.observed->>'isOfficial' = 'false'
    or source.observed->>'isSplit' = 'true' or source.observed->>'isRelaySplit' = 'true'
    or decision.patch->'leadOffVerified' is distinct from 'true'::jsonb
    or decision.patch->>'parentRelayResultId' is not null
    or proof->>'sourceUrl' is distinct from coalesce(decision.evidence_url,source.source_url)
    -- Match the linked-parent HTTP/HTTPS contract, with the held URL host,
    -- credentials and sensitive-query checks applied to either scheme.
    or private.velocity_held_safe_url(regexp_replace(proof->>'sourceUrl','^http://','https://')) is not true
    or proof->>'sourceMeetId' is distinct from source.source_meet_id
    or proof->>'workbookSha256' is distinct from source.workbook_sha256
    or proof->>'sourceRow' is distinct from source.source_row::text
    or proof->>'memberIdHash' is distinct from source.member_id_hash
    or not exists(select 1 from private.velocity_official_archive_acceptances a
      where a.observation_id=source.id)
  then return false; end if;

  select min(t.athlete_id) into target_id
    from private.velocity_import_swimmer_identity_targets(source.member_id_hash) t having count(*)=1;
  display := source.observed#>>array['raw',
    jsonb_build_object('F','Final','P','Prelim','TT','Trial','S','Swim-off')->>source.round];
  timing_course := case substring(display from '([YSL])[[:space:]]+L[[:space:]]*$')
    when 'Y' then 'SCY' when 'S' then 'SCM' when 'L' then 'LCM' end;
  source_event_code := coalesce(decision.patch->>'eventCode',source.observed->>'eventCode');
  if target_id is null or body->>'athleteId' is distinct from target_id
    or (decision.patch->>'athleteId' is not null and decision.patch->>'athleteId' is distinct from target_id)
    or timing_course is null or body->>'course' is distinct from timing_course
    or source_event_code !~ '^(25|50|100|200)_(FR|BK)_(SCY|SCM|LCM)$'
    or body->>'eventCode' is distinct from source_event_code
    or body->>'distance' is distinct from split_part(source_event_code,'_',1)
    or body->>'stroke' is distinct from split_part(source_event_code,'_',2)
    or body->>'course' is distinct from split_part(source_event_code,'_',3)
    or body->>'timeMs' is distinct from source.observed->>'timeMs'
    or (decision.patch ? 'timeMs' and decision.patch->>'timeMs' is distinct from source.observed->>'timeMs')
    or coalesce(source.observed->>'timeMs','') !~ '^[1-9][0-9]{0,8}$'
    or body#>>'{meet,id}' is distinct from decision.patch->>'meetId'
    or decision.patch->>'meetId' is null
    or coalesce(body#>>'{meet,date}','') !~ '^\d{4}-\d{2}-\d{2}$'
    or not pg_input_is_valid(body#>>'{meet,date}','date')
    or body#>>'{meet,date}' is distinct from coalesce(decision.patch->>'raceDate',source.observed->>'raceDate')
    or coalesce(body->>'round','') not in ('F','P','S','TT')
    or body->>'round' is distinct from coalesce(decision.patch->>'round',source.round)
    or coalesce(body->>'gender','') not in ('F','M','X')
    or body->>'gender' is distinct from coalesce(decision.patch->>'category',source.observed->>'category')
    or coalesce(body#>>'{raceIdentity,occurrence}','single') is distinct from coalesce(decision.patch->>'occurrence','single')
  then return false; end if;
  if not exists(select 1 from public.meets m where m.id=body#>>'{meet,id}'
    and body#>>'{meet,date}' between coalesce(m.data->>'startsOn',m.data->>'startDate',m.data#>>'{dates,startDate}')
      and coalesce(m.data->>'endsOn',m.data->>'endDate',m.data#>>'{dates,endDate}',
        m.data->>'startsOn',m.data->>'startDate',m.data#>>'{dates,startDate}'))
  then return false; end if;

  -- A known-parent result already records this exact first-leg start.
  -- Separately reviewed occurrence tokens remain distinct starts.
  if exists(select 1 from public.swims s
    where s.id<>coalesce(body->>'id','') and s.data->>'resultOrigin'='relay_leadoff'
      and s.data->>'parentRelayResultId' is not null
      and s.athlete_id=target_id and s.meet_id=body#>>'{meet,id}'
      and s.event_code=source_event_code and s.data#>>'{meet,date}'=body#>>'{meet,date}'
      and s.round=body->>'round'
      and coalesce(s.data#>>'{raceIdentity,occurrence}','single')
        =coalesce(body#>>'{raceIdentity,occurrence}','single'))
  then return false; end if;
  return true;
end;
$$;
revoke all on function private.velocity_official_source_leadoff(jsonb)
  from public, anon, authenticated, service_role;

-- Keep every existing linked-parent check. Only an absent parent can take the
-- private official-source branch; a supplied invalid parent never falls back.
do $migration$
declare definition text; before_text text; after_text text;
begin
  definition := pg_get_functiondef('private.validate_relay_leadoff()'::regprocedure);
  before_text := $before$  select * into parent from public.relay_results where id=new.data->>'parentRelayResultId';$before$;
  after_text := $after$  if exists(select 1 from public.swims s
    where s.id<>new.id and s.data->>'resultOrigin'='relay_leadoff'
      and (s.data->>'parentRelayResultId' is null or new.data->>'parentRelayResultId' is null)
      and s.athlete_id=new.data->>'athleteId' and s.meet_id=new.data#>>'{meet,id}'
      and s.event_code=new.data->>'eventCode' and s.data#>>'{meet,date}'=new.data#>>'{meet,date}'
      and s.round=new.data->>'round'
      and coalesce(s.data#>>'{raceIdentity,occurrence}','single')
        =coalesce(new.data#>>'{raceIdentity,occurrence}','single')) then
    raise unique_violation using message='This exact relay first-leg start is already recorded.';
  end if;
  if new.data->>'parentRelayResultId' is null then
    if not private.velocity_official_source_leadoff(new.data) then
      raise exception 'A parentless lead-off requires a versioned reviewed official source first-leg result';
    end if;
    return new;
  end if;
  select * into parent from public.relay_results where id=new.data->>'parentRelayResultId';$after$;
  if (length(definition)-length(replace(definition,before_text,'')))/length(before_text)<>1 then
    raise exception 'Expected one child lead-off validation edit';
  end if;
  execute replace(definition,before_text,after_text);

  definition := pg_get_functiondef('private.velocity_held_evaluate_base(private.velocity_held_observations,text)'::regprocedure);
  before_text := $before$  parent_data jsonb;$before$;
  after_text := $after$  parent_data jsonb;
  official_lead_verification jsonb;$after$;
  if (length(definition)-length(replace(definition,before_text,'')))/length(before_text)<>1 then
    raise exception 'Expected one held lead-off declaration edit';
  end if;
  definition := replace(definition,before_text,after_text);

  before_text := $before$    if o.kind <> 'swim' or parent_data is null$before$;
  after_text := $after$    if parent_data is null and coalesce(patch->>'parentRelayResultId',current_data->>'parentRelayResultId') is null then
      official_lead_verification := jsonb_build_object(
        'method','Official GoMotion lead-off','observationId',o.id,'decisionId',row_review.id,
        'verified',true,'flatStart',true,'timingVerified',true,'leadOffStatus','OK',
        'sourceUrl',coalesce(row_review.evidence_url,o.source_url),'sourceMeetId',o.source_meet_id,
        'workbookSha256',o.workbook_sha256,'sourceRow',o.source_row,'memberIdHash',o.member_id_hash);
      proposed := proposed || jsonb_build_object('resultOrigin','relay_leadoff',
        'leadOffVerification',official_lead_verification);
      if not private.velocity_official_source_leadoff(proposed) then
        return jsonb_build_object('state','held','blocker','A lead-off requires a verified parent relay or an explicitly reviewed official source first-leg result.');
      end if;
    else
    if o.kind <> 'swim' or parent_data is null$after$;
  if (length(definition)-length(replace(definition,before_text,'')))/length(before_text)<>1 then
    raise exception 'Expected one held lead-off source branch edit';
  end if;
  definition := replace(definition,before_text,after_text);

  before_text := $before$      ) end, current_data->'leadOffVerification')
    );
  end if;$before$;
  after_text := $after$      ) end, current_data->'leadOffVerification')
    );
    end if;
  end if;$after$;
  if (length(definition)-length(replace(definition,before_text,'')))/length(before_text)<>1 then
    raise exception 'Expected one held linked-parent branch closure edit';
  end if;
  definition := replace(definition,before_text,after_text);

  before_text := $before$    proposed := current_data || corrections;$before$;
  after_text := $after$    if official_lead_verification is not null then
      -- Corroborating observations and later reviews retain the live versioned
      -- proof when the same actual start remains valid, avoiding metadata churn.
      if not (private.velocity_official_source_leadoff(current_data || corrections)
        and private.result_identity_base('swim',current_data) is not distinct from private.result_identity_base('swim',proposed)
        and row(current_data->>'timeMs',current_data->>'status',current_data->>'gender',
          coalesce(current_data#>>'{raceIdentity,occurrence}','single'))
          is not distinct from row(proposed->>'timeMs',proposed->>'status',proposed->>'gender',
          coalesce(proposed#>>'{raceIdentity,occurrence}','single'))) then
        corrections := corrections || jsonb_build_object('leadOffVerification',official_lead_verification);
      end if;
    end if;
    proposed := current_data || corrections;$after$;
  if (length(definition)-length(replace(definition,before_text,'')))/length(before_text)<>1 then
    raise exception 'Expected one held versioned-proof correction edit';
  end if;
  execute replace(definition,before_text,after_text);
end;
$migration$;
