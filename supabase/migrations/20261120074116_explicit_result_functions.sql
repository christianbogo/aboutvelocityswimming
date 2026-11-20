-- Current definitions for the Times dispatcher and direct result-management
-- functions. Future changes edit complete definitions in a new migration;
-- they do not patch pg_get_functiondef() text or alter applied history.
-- CREATE OR REPLACE retains each existing function's owner and grants.

-- One eligibility and tie-breaking calculation for both refresh paths.
-- NULL selects the whole board; a bounded event list keeps direct edits local.
CREATE OR REPLACE FUNCTION private.team_record_winners(event_codes text[] DEFAULT NULL)
RETURNS SETOF public.team_record_holders
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
SET plan_cache_mode = 'force_custom_plan'
AS $function$
with flagged_swims as (
    select result_id from public.result_moderation where flagged and result_type='swim'
  ), flagged_relays as (
    select result_id from public.result_moderation where flagged and result_type='relay'
  ), eligible as materialized (
    select s.times_team as team,s.id,s.athlete_id,s.swim_date as date,s.times_course as course,
      s.times_event as event,s.times_time as time,s.times_relay as relay,s.times_gender as gender,
      case when not s.times_relay then s.times_age end as age,
      case when s.times_relay then coalesce(s.data->>'ageGroup','') else '' end as relay_age,
      case when s.times_relay then coalesce(s.data->>'recordAgeGroup',s.data->>'ageGroup','') else '' end as record_age_group,
      'swim'::text as result_type
    from public.public_swims s
    join public.public_times_teams t on t.id=s.times_team
    join public.public_athletes a on a.id=s.athlete_id
    where (event_codes is null or (s.times_event,s.times_course) in (select split_part(code,'_',1)||'_'||split_part(code,'_',2),split_part(code,'_',3) from unnest(event_codes) code)) and s.times_status='OK' and s.times_time>0 and s.times_gender in ('F','M','X')
      and s.times_leg is null and not s.times_split
      and not exists (select 1 from flagged_swims m where m.result_id=s.id)
      and not exists (select 1 from flagged_relays m where m.result_id=s.data->>'parentRelayResultId')
    union all
    select s.team_id,s.id,''::text,s.swim_date,s.times_course,s.times_event,s.times_time,true,
      s.data->>'gender',null::integer,coalesce(s.data->>'ageGroup',''),coalesce(s.data->>'recordAgeGroup',s.data->>'ageGroup',''),'relay'
    from public.public_relay_results s join public.public_times_teams t on t.id=s.team_id
    where (event_codes is null or (s.times_event,s.times_course) in (select split_part(code,'_',1)||'_'||split_part(code,'_',2),split_part(code,'_',3) from unnest(event_codes) code)) and s.data->>'status'='OK' and s.times_time>0 and s.data->>'gender' in ('F','M','X')
      and not exists (select 1 from flagged_relays m where m.result_id=s.id)
  ), fastest_by_age as (
    -- Preserve the upstream optimization: a slower swim in an identical age
    -- category cannot win any enclosing age group. Expand only its fastest ties.
    select e.*,rank() over(partition by team,course,event,gender,relay,age,relay_age,record_age_group order by time) as age_rank
    from eligible e
  ), defaults as materialized (
    select unnest(array['8&U','9-10','11-12','13-14','15-16','17-18','19&O','10&U','12&U','13&O','15&O','Open']) as age_group
  ), groups as materialized (
    select null::text as team,age_group,public.ies_times_age_range(age_group) as ages from defaults
    union all
    select distinct team,relay_age,public.ies_times_age_range(relay_age) from eligible
    where relay and relay_age<>'' and relay_age not in (select age_group from defaults)
  ), categorized as (
    select e.*,g.age_group from fastest_by_age e join groups g
      on (g.team is null or g.team=e.team)
      and case when e.relay then e.record_age_group<>'' and
        (e.record_age_group=g.age_group or g.ages @> public.ies_times_age_range(e.record_age_group))
      else g.ages @> e.age end
    where e.age_rank=1
  ), fastest as (
    select e.*,min(time) over(partition by team,course,event,gender,age_group) as fastest from categorized e
  ), holders as (
    select f.*,row_number() over(partition by team,course,event,gender,age_group,
      case when relay then id else athlete_id end order by date,id) as pick
    from fastest f where time=fastest
  )
  select team,course,event,gender,age_group,result_type,id,
    case when relay then '' else athlete_id end,date,time,relay,age,relay_age
  from holders where pick=1;
$function$;
REVOKE ALL ON FUNCTION private.team_record_winners(text[]) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.refresh_team_records()
RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE consumed bigint[];
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('velocity-team-record-refresh')) THEN
    RETURN false;
  END IF;
  SELECT array_agg(transaction_id) INTO consumed FROM private.team_record_refresh_queue;
  IF consumed IS NULL THEN RETURN false; END IF;

  DELETE FROM public.team_record_holders WHERE true;
  INSERT INTO public.team_record_holders
    SELECT * FROM private.team_record_winners(NULL);
  UPDATE public.team_record_refresh_state SET refreshed_at = clock_timestamp() WHERE id;
  DELETE FROM private.team_record_refresh_queue WHERE transaction_id = ANY(consumed);
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION private.refresh_result_record_events(event_codes text[])
RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF coalesce(cardinality(event_codes), 0) = 0 THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('velocity-team-record-refresh'));
  DELETE FROM public.team_record_holders h
  WHERE (h.event, h.course) IN (
    SELECT split_part(code, '_', 1) || '_' || split_part(code, '_', 2), split_part(code, '_', 3)
    FROM unnest(event_codes) code
  );
  INSERT INTO public.team_record_holders
    SELECT * FROM private.team_record_winners(event_codes);
  -- Leave the queue and whole-board timestamp to the full refresh worker.
  RETURN true;
END;
$function$;

-- public.ies_times_query
CREATE OR REPLACE FUNCTION public.ies_times_query(query_kind text, input jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET extra_float_digits TO '3'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare answer jsonb; start_at int:=coalesce((input->>'offset')::int,0); size int:=coalesce((input->>'limit')::int,25); needle text:=lower(trim(coalesce(input->>'search',''))); chosen public.ies_times_races;
begin
 if start_at<0 or size not between 1 and 100 or length(needle)>100 then raise exception 'Invalid pagination or search'; end if;
 if query_kind='facets' then
 with individual as materialized (
  select s.times_event as event,left(s.swim_date,4) as year
  from public.public_swims s join public.public_times_teams t on t.id=s.times_team where not s.times_relay
 ), legacy_relays as materialized (
  select s.times_event as event,left(s.swim_date,4) as year,s.times_leg as leg,coalesce(s.data->>'ageGroup','') as age,
   s.times_status='OK' and s.times_time>0 as eligible
  from public.public_swims s join public.public_times_teams t on t.id=s.times_team where s.times_relay
 ), relays as materialized (
  select s.times_event as event,left(s.swim_date,4) as year,coalesce(s.data->>'ageGroup','') as age,
   s.data->>'status'='OK' and s.times_time>0 as eligible
  from public.public_relay_results s join public.public_times_teams t on t.id=s.team_id
 )
 select jsonb_build_object('teams',(select coalesce(jsonb_agg(jsonb_build_array(id,name) order by name,id),'[]') from public.public_times_teams),
  'events',(select coalesce(jsonb_agg(event order by event),'[]') from (select distinct event from individual) e),
  'relayEvents',(select coalesce(jsonb_agg(event order by event),'[]') from (select event from relays union select event from legacy_relays where leg is null) e),
  'years',(select coalesce(jsonb_agg(year order by year desc),'[]') from (select year from individual union select year from relays union select year from legacy_relays) y),
  'relayAges',(select coalesce(jsonb_agg(age order by age),'[]') from (select age from relays where eligible and age<>'' union select age from legacy_relays where eligible and leg is null and age<>'') a)) into answer;

 elsif query_kind='rankings' then
 with eligible as materialized (select * from public.ies_times_candidates(input)),
 best as (select e.*,row_number() over(partition by athlete_id,event,course order by time,date desc,id) as pick from eligible e),
 selected as (select b.* from best b where input->>'mode'='performances' or b.relay or pick=1),
 ranked as (select s.*,rank() over(order by time) as position from selected s),
 searched as (select r.* from ranked r where needle='' or position(needle in lower(search_name))>0),
 page as materialized (
   select * from searched
   order by time,case when input->>'mode'='performances' or relay then id else athlete_id end,id
   limit size offset start_at
 ), races as materialized (
   select * from private.ies_times_json_ids(array(select id from page))
 )
 select jsonb_build_object(
   'rows',coalesce((select jsonb_agg(jsonb_build_object('race',r.race,'rank',p.position)
     order by p.time,case when input->>'mode'='performances' or p.relay then p.id else p.athlete_id end,p.id)
     from page p left join races r using(id)),'[]'),
   'total',(select count(*) from searched)
 ) into answer;
 elsif query_kind='race' then
 select jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('race',public.ies_times_json(r))),'[]'),'total',count(*)) into answer from public.ies_times_races r join public.public_times_teams t on t.id=r.team where r.id=input->>'raceId';
 elsif query_kind='analysis' then
 select * into chosen from public.ies_times_races where id=input->>'raceId';
 with eligible as (select * from public.ies_times_candidates(input||jsonb_build_object('event',chosen.event,'course',chosen.course,'relay',chosen.relay))),
 best as (select e.*,row_number() over(partition by athlete_id,event,course order by time,date desc,id) as pick from eligible e),
 cohort as (select * from best where chosen.relay or input->>'basis'='swims' or pick=1),
 counts as (select count(*) as n,count(*) filter(where time<chosen.time) as faster,count(*) filter(where time=chosen.time) as tied,count(*) filter(where time>chosen.time) as slower from cohort)
 select jsonb_build_object('count',n,'stats',case when n>0 and not chosen.relay and not chosen.split and chosen.relay_leg is null and chosen.status='OK' and chosen.time>0 and public.race_moderation(chosen)->>'moderationStatus'='clear' then jsonb_build_object('value',((slower::double precision+tied::double precision/2)/n::double precision)*100,'count',n,'faster',faster,'tied',tied,'slower',slower,'rank',faster+1) else null end) into answer from counts;
 elsif query_kind='record_teams' then
  select jsonb_build_object('teams',coalesce(jsonb_agg(jsonb_build_array(id,name) order by name,id),'[]'))
  into answer from public.public_times_teams;
 elsif query_kind='records' then
  answer:=public.ies_team_records(input->>'team');
 else raise exception 'Unknown times view'; end if;
 return answer;
end; $function$;

-- private.save_result_record
CREATE OR REPLACE FUNCTION private.save_result_record(kind text, rid text, body jsonb, expected text, source jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare previous jsonb; next jsonb:=body; events text[]; a jsonb; current_version text;
begin
 if not private.is_data_owner() then raise insufficient_privilege using message='Only the data owner can save records.'; end if;
 perform pg_advisory_xact_lock(hashtext('velocity-records'));
 previous:=private.result_record(kind,rid); current_version:=coalesce(md5(previous::text),'new');
 if expected is distinct from current_version then raise serialization_failure using message='This record changed. Reload it before saving.'; end if;
 if previous=next then return jsonb_build_object('id',rid,'data',previous,'version',current_version); end if;
 if kind in ('swim','relay') then
  if previous is not null and (previous->'externalResult' is distinct from next->'externalResult'
   or previous#>'{sourceObservation,memberIdHash}' is distinct from next#>'{sourceObservation,memberIdHash}') then
   raise invalid_parameter_value using message='Keep the existing source identity when editing a result.'; end if;
  if previous is null or private.result_identity_base(kind,previous) is distinct from private.result_identity_base(kind,next) or previous#>'{raceIdentity,occurrence}' is distinct from next#>'{raceIdentity,occurrence}' then
   next:=next||jsonb_build_object('raceIdentity',jsonb_build_object('occurrence',coalesce(next#>>'{raceIdentity,occurrence}','single'),
    'reviewed',true,'method','manual','basis','Direct owner entry or correction'));
  end if;
  if kind='swim' then
   a:=private.result_record('athlete',next->>'athleteId'); next:=next||jsonb_build_object('athleteName',a->'name');
  end if;
 end if;
 if kind='meet' then next:=next||jsonb_build_object('startsOn',next#>>'{dates,startDate}','endsOn',next#>>'{dates,endDate}'); end if;
 perform private.validate_managed_result(kind,rid,next);
 perform set_config('velocity.defer_bests','true',true);
 perform private.put_record(private.result_path(kind,rid),next);
 if kind='athlete' and next#>>'{sourceObservation,memberIdHash}' is not null and exists(select 1 from private.source_swimmer_targets(next#>>'{sourceObservation,memberIdHash}') t where t.athlete_id<>rid) then raise unique_violation using message='This source swimmer identity is already linked to another profile.'; end if;
 perform private.result_audit(private.result_path(kind,rid),previous,next,source);
 perform set_config('velocity.defer_bests','false',true);
 if kind in ('swim','relay') then events:=array_remove(array[previous->>'eventCode',next->>'eventCode'],null);
 elsif kind='athlete' then select array_agg(distinct event_code) into events from (select event_code from public.swims where athlete_id=rid union select event_code from public.relay_results where data->'members' @> jsonb_build_array(jsonb_build_object('athleteId',rid))) affected; end if;
 if cardinality(events)>0 then perform private.rebuild_bests_for_events(events); end if;
 if cardinality(events)>0 then perform private.refresh_result_record_events(events); end if;
 next:=private.result_record(kind,rid);
 return jsonb_build_object('id',rid,'data',next,'version',md5(next::text));
end; $function$;

-- public.import_meet_results
CREATE OR REPLACE FUNCTION public.import_meet_results(input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '45s'
AS $function$
declare row jsonb; source jsonb; meet jsonb; ids text[]; mid text; aid text; rid text; body jsonb; current_data jsonb;
 outcomes jsonb:='[]'; members jsonb; member jsonb; athlete jsonb; code text; changed_events text[]:='{}';
 source_hash text; row_status text; imported integer:=0; age_n integer; candidate_base jsonb; match_count integer;
begin
 if not private.is_data_owner() then raise insufficient_privilege using message='Only the data owner can import results.'; end if;
 if jsonb_typeof(input->'rows') is distinct from 'array' or jsonb_array_length(input->'rows')>100 or pg_column_size(input)>1500000 then raise invalid_parameter_value using message='Import at most 100 bounded result rows per request.'; end if;
 perform pg_advisory_xact_lock(hashtext('velocity-records'));
 perform set_config('velocity.defer_bests','true',true);
 for row in select * from jsonb_array_elements(input->'rows') loop
  begin
   source:=row->'source'; rid:=null; aid:=null; mid:=null; current_data:=null; age_n:=null;
   if row->>'issue' is not null then raise exception '%',row->>'issue'; end if;
   if row->>'kind' not in ('swim','relay') or coalesce(source->>'format','') not in ('hy3','cl2','sd3')
    or coalesce(source->>'sha256','') !~ '^[a-f0-9]{64}$' or coalesce(source->>'line','') !~ '^[1-9][0-9]{0,7}$'
    or source-array['filename','sha256','line','format','companion'] <> '{}'::jsonb
    or (source ? 'companion' and ((source->'companion')-array['filename','sha256','line']<>'{}'::jsonb or coalesce(source#>>'{companion,sha256}','') !~ '^[a-f0-9]{64}$' or coalesce(source#>>'{companion,line}','') !~ '^[1-9][0-9]{0,7}$' or length(coalesce(source#>>'{companion,filename}','')) not between 1 and 300))
    or length(coalesce(source->>'filename','')) not between 1 and 300 then raise exception 'Invalid result file provenance.'; end if;
   if row#>>'{team,lscCode}' is distinct from 'IE' or not coalesce((row#>>'{team,clubCode}' in ('VS','IEVS') or (row#>>'{team,clubCode}'='CUDA' and input->>'includeHistoricalCuda'='true')),false) then
    outcomes:=outcomes||jsonb_build_array(jsonb_build_object('filename',source->>'filename','line',source->'line','status','skipped','message','Outside the Velocity club scope. IE-CUDA requires an explicit historical-program choice.'));
    continue;
   end if;
   meet:=row->'meet';
   if nullif(btrim(meet->>'name'),'') is null or coalesce(meet->>'startsOn','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(meet->>'endsOn','') !~ '^\d{4}-\d{2}-\d{2}$' or not pg_input_is_valid(meet->>'startsOn','date')
    or not pg_input_is_valid(meet->>'endsOn','date') or meet->>'endsOn'<meet->>'startsOn' then raise exception 'Invalid meet header.'; end if;
   mid:=nullif(input->>'meetId','');
   if mid is not null then
    if private.result_record('meet',mid) is null then raise exception 'Selected meet no longer exists.'; end if;
   else
    select array_agg(id) into ids from public.meets where lower(btrim(data->>'name'))=lower(btrim(meet->>'name'))
     and coalesce(data->>'startsOn',data->>'startDate',data#>>'{dates,startDate}')=meet->>'startsOn';
    if cardinality(ids)>1 then raise exception 'Multiple meets match. Select the existing meet before retrying.'; end if;
    mid:=ids[1];
    if mid is null then
     mid:='meet_file_'||md5(lower(btrim(meet->>'name'))||'|'||(meet->>'startsOn'));
     body:=jsonb_build_object('id',mid,'name',meet->>'name','dates',jsonb_build_object('startDate',meet->>'startsOn','endDate',meet->>'endsOn'),
      'startsOn',meet->>'startsOn','endsOn',meet->>'endsOn');
     perform private.validate_managed_result('meet',mid,body);
     perform private.put_record('meets/'||mid,body); perform private.result_audit('meets/'||mid,null,body,source);
    end if;
   end if;
   meet:=private.result_record('meet',mid);
   if row->>'kind'='swim' then aid:=private.file_athlete(row->'athlete',source); athlete:=private.result_record('athlete',aid);
   else
    if jsonb_typeof(row->'members') is distinct from 'array' or jsonb_array_length(row->'members')>4 then raise exception 'Invalid relay lineup.'; end if;
    members:='[]';
    for member in select * from jsonb_array_elements(row->'members') loop
     aid:=private.file_athlete(member->'athlete',source); athlete:=private.result_record('athlete',aid);
     members:=members||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('leg',member->'leg','athleteId',aid,
      'name',trim((athlete#>>'{name,first}')||' '||(athlete#>>'{name,last}')),'gender',athlete->'gender','timeMs',member->'timeMs')));
    end loop;
   end if;
   code:=(row->>'distance')||'_'||(case when row->>'kind'='relay' then case when row->>'stroke'='IM' then 'MED-R' else 'FR-R' end else row->>'stroke' end)||'_'||(row->>'course');
   body:=jsonb_build_object('teamId','velocity-swimming','distance',row->'distance','stroke',row->'stroke','course',row->'course',
    'eventCode',code,'round',row->'round','status',row->'status','timeMs',row->'timeMs','gender',row->'gender','isOfficial',true,
    'isRelay',false,'meet',jsonb_build_object('id',mid,'name',meet->>'name','date',row->>'date'),
    'splits',coalesce(row->'splits','[]'),'splitCoverage',coalesce(row->>'splitCoverage','unavailable'),
    'sourceObservation',source||jsonb_build_object('eventNumber',row->>'eventNumber','affiliation',jsonb_build_object('lscCode',row#>>'{team,lscCode}','clubCode',row#>>'{team,clubCode}'),'historicalAffiliationVerified',case when row#>>'{team,clubCode}'='CUDA' then true else null end),
    'metadata',jsonb_build_object('source','meet_file','createdAt',now()));
   if row->>'kind'='swim' then
    if row ? 'ageAtSwim' then age_n:=(row->>'ageAtSwim')::integer;
    elsif athlete->>'dob' is not null then age_n:=extract(year from age((row->>'date')::date,(athlete->>'dob')::date)); end if;
    body:=body||jsonb_build_object('athleteId',aid,'athleteName',athlete->'name','ageGroup',coalesce(row->>'ageGroup','Open'));
    if age_n is not null then body:=body||jsonb_build_object('ageAtSwim',age_n); end if;
    if row#>>'{athlete,memberHash}' is not null then body:=jsonb_set(body,'{sourceObservation,memberIdHash}',row#>'{athlete,memberHash}'); end if;
   else body:=(body-'isRelay')||jsonb_build_object('relayName',coalesce(nullif(row->>'relayName',''),'A'),'ageGroup',coalesce(row->>'ageGroup','Open'),'members',members,'timeDisplay',case when row->>'status'='OK' then ((row->>'timeMs')::bigint/60000)::text||':'||lpad((((row->>'timeMs')::bigint%60000)/1000)::text,2,'0')||'.'||lpad((((row->>'timeMs')::bigint%1000)/10)::text,2,'0') else row->>'status' end); end if;
   candidate_base:=private.result_identity_base(row->>'kind',body);
   select count(*),min(id) into match_count,rid from (
    select id,data from public.swims where row->>'kind'='swim' and athlete_id=aid and meet_id=mid and event_code=code
    union all select id,data from public.relay_results where row->>'kind'='relay' and meet_id=mid and event_code=code
   ) candidates where private.result_identity_base(row->>'kind',data)=candidate_base;
   if match_count>1 then raise exception 'Multiple existing occurrences match; choose the correct result in the editor.'; end if;
   if rid is not null then
    current_data:=private.result_record(row->>'kind',rid);
    if current_data->'timeMs' is distinct from body->'timeMs' or current_data->'status' is distinct from body->'status' or current_data->'gender' is distinct from body->'gender'
     or (row ? 'ageAtSwim' and current_data ? 'ageAtSwim' and current_data->'ageAtSwim' is distinct from body->'ageAtSwim')
     or (body->'splits'<>'[]'::jsonb and coalesce(current_data->'splits','[]') is distinct from body->'splits')
     or (row->>'kind'='relay' and body->'members'<>'[]'::jsonb and current_data->'members' is distinct from body->'members') then
     raise exception 'Existing result has different facts. Edit it manually; files never overwrite results.'; end if;
    row_status:='duplicate';
   else
    rid:='file_'||md5(candidate_base::text);
    body:=body||jsonb_build_object('id',rid,'raceIdentity',jsonb_build_object('occurrence','single','reviewed',true,'method','meet_file',
      'basis','One identified start in the supplied meet results file','sha256',source->>'sha256','line',source->'line'));
    source_hash:=(source->>'sha256')||':'||(source->>'line')||':'||(row->>'round');
    body:=body||jsonb_build_object('externalResult',jsonb_build_object('namespace','meet-file','id',source_hash));
    perform private.validate_managed_result(row->>'kind',rid,body);
    perform private.put_record(private.result_path(row->>'kind',rid),body);
    perform private.result_audit(private.result_path(row->>'kind',rid),null,body,source);
    changed_events:=array_append(changed_events,code);
    imported:=imported+1; row_status:='saved';
   end if;
   outcomes:=outcomes||jsonb_build_array(jsonb_build_object('filename',source->>'filename','line',source->'line','status',row_status,'id',rid,
    'message',case when row_status='duplicate' then 'Already recorded.' else 'Saved.' end));
  exception when others then
   outcomes:=outcomes||jsonb_build_array(jsonb_build_object('filename',source->>'filename','line',source->'line','status','error','message',left(sqlerrm,400)));
  end;
 end loop;
 perform set_config('velocity.defer_bests','false',true);
 if cardinality(changed_events)>0 then perform private.rebuild_bests_for_events(array(select distinct unnest(changed_events))); end if;
 if imported>0 then perform private.refresh_result_record_events(array(select distinct unnest(changed_events))); end if;
 return jsonb_build_object('outcomes',outcomes,'saved',imported);
end; $function$;

-- private.read_result_moderation
CREATE OR REPLACE FUNCTION private.read_result_moderation(kind text, rid text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare raw jsonb; state public.result_moderation; history jsonb; sources jsonb; race jsonb;
begin
 if not private.is_data_owner() then raise insufficient_privilege using message='Only the data owner can review results'; end if;
 if kind='swim' then select data into raw from public.swims where id=rid;
 elsif kind='relay' then select data into raw from public.relay_results where id=rid;
 else raise exception 'Invalid result type' using errcode='22023'; end if;
 if raw is null and not exists(select 1 from private.result_moderation_events where result_type=kind and result_id=rid) then
  raise exception 'Result not found' using errcode='P0002'; end if;
 select * into state from public.result_moderation where result_type=kind and result_id=rid;
 select coalesce(jsonb_agg(to_jsonb(e)-'snapshot' order by version desc),'[]') into history
 from private.result_moderation_events e where result_type=kind and result_id=rid;
 select coalesce(jsonb_agg(to_jsonb(s)),'[]') into sources from (
  select source_url,evidence,captured_at from private.retained_result_sources
  where record_path=private.result_path(kind,rid)
  order by captured_at desc limit 3
 ) s;
 select public.ies_times_json(r) into race from public.ies_times_races r where r.id=rid and
  (case when r.athlete_id='' and r.relay then 'relay' else 'swim' end)=kind;
 return jsonb_build_object('resultType',kind,'resultId',rid,'version',coalesce(state.version,0),
  'flagged',coalesce(state.flagged,false),'available',raw is not null,'race',race,'history',history,'sources',sources,
  'sourceData',raw,'originalSnapshot',(select snapshot from private.result_moderation_events where result_type=kind and result_id=rid order by version limit 1));
end; $function$;

-- private.list_result_moderation
CREATE OR REPLACE FUNCTION private.list_result_moderation(page_from integer, page_size integer, include_restored boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not private.is_data_owner() then raise insufficient_privilege using message='Only the data owner can review results'; end if;
 if page_from is null or page_size is null or page_from<0 or page_size not between 1 and 50 then raise exception 'Invalid pagination' using errcode='22023'; end if;
 return jsonb_build_object('total',(select count(*) from public.result_moderation where flagged or include_restored),
 'results',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.result_type,p.result_id) from (
  select m.*,e.reason,e.note,e.created_at,public.ies_times_json_id(m.result_id) as race
  from public.result_moderation m join private.result_moderation_events e using(result_type,result_id,version)
  where m.flagged or include_restored order by e.created_at desc,m.result_type,m.result_id limit page_size offset page_from
 ) p),'[]'));
end; $function$;

-- private.moderate_result
CREATE OR REPLACE FUNCTION private.moderate_result(kind text, rid text, decision text, reason_code text, review_note text, expected_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare raw jsonb; current_version integer; current_flag boolean; events text[];
begin
 if not private.is_data_owner() then raise insufficient_privilege using message='Only the data owner can review results'; end if;
 if kind is null or kind not in ('swim','relay') or rid is null or length(rid) not between 1 and 200
  or decision is null or decision not in ('flag','restore') or expected_version is null or expected_version<0
  or review_note is null or length(review_note)>4000 then raise exception 'Invalid moderation request' using errcode='22023'; end if;
 review_note:=trim(review_note);
 if decision='flag' and (reason_code is null or reason_code not in ('incorrect_time','incorrect_event_course','incorrect_swimmer_age','duplicate','other')) then
  raise exception 'Choose a reason' using errcode='22023'; end if;
 if (decision='restore' or reason_code='other') and review_note='' then raise exception 'An explanation is required' using errcode='22023'; end if;
 -- Share the import lock: moderation, source snapshots and bests commit together.
 perform pg_advisory_xact_lock(hashtext('velocity-records'));
 if kind='swim' then select data into raw from public.swims where id=rid;
 else select data into raw from public.relay_results where id=rid; end if;
 if raw is null then raise exception 'Result not found' using errcode='P0002'; end if;
 select version,flagged into current_version,current_flag from public.result_moderation where result_type=kind and result_id=rid;
 if coalesce(current_version,0)<>expected_version or coalesce(current_flag,false)=(decision='flag') then
  raise exception 'This result changed. Refresh before reviewing it again.' using errcode='40001'; end if;
 current_version:=coalesce(current_version,0)+1;
 insert into public.result_moderation values(kind,rid,decision='flag',current_version)
 on conflict(result_type,result_id) do update set flagged=excluded.flagged,version=excluded.version;
 insert into private.result_moderation_events(result_type,result_id,version,action,reason,note,actor_id,actor_email,snapshot)
 values(kind,rid,current_version,decision,case when decision='flag' then reason_code end,review_note,auth.uid(),
  (select email from auth.users where id=auth.uid()),raw);
 select array_agg(distinct event_code) into events from public.swims
 where (kind='swim' and id=rid) or (kind='relay' and data->>'parentRelayResultId'=rid);
 if events is not null then perform private.rebuild_bests_for_events(events); end if;
 if kind='relay' then events:=array_append(coalesce(events,'{}'::text[]),raw->>'eventCode'); end if; perform private.refresh_result_record_events(events); return private.read_result_moderation(kind,rid);
end; $function$;

NOTIFY pgrst, 'reload schema';
