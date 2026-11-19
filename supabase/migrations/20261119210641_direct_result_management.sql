-- Direct, owner-only result management. No pending state or approval queue.
create function private.is_data_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.users where id = auth.uid()
    and lower(btrim(email)) = 'christiancutter02@gmail.com'
    and email_confirmed_at is not null and not coalesce(is_anonymous, false));
$$;
revoke all on function private.is_data_owner() from public, anon, authenticated;

-- Source-to-person links outlive the review system, including ambiguous links.
create table private.retained_athlete_identity_links (
 member_hash text not null, athlete_id text not null references public.athletes(id),
 evidence jsonb not null, primary key(member_hash,athlete_id)
);
alter table private.retained_athlete_identity_links enable row level security;
revoke all on private.retained_athlete_identity_links from public,anon,authenticated,service_role;
insert into private.retained_athlete_identity_links
 select distinct on (r.member_hash,r.athlete_id) r.member_hash,r.athlete_id,
 jsonb_build_object('reason',r.reason,'actor',r.reviewed_by,'at',r.reviewed_at)
 from private.velocity_import_swimmer_resolutions r join public.athletes a on a.id=r.athlete_id
 order by r.member_hash,r.athlete_id,r.reviewed_at desc;
create function private.source_swimmer_targets(member_hash text) returns table(athlete_id text)
language sql stable set search_path='' as $$
 select s.athlete_id from private.athlete_source_identities s where s.namespace='hytek-member' and s.source_id=$1
 union select a.id from public.athletes a where a.data#>>'{sourceObservation,memberIdHash}'=$1
 union select r.athlete_id from private.retained_athlete_identity_links r where r.member_hash=$1;
$$;
revoke all on function private.source_swimmer_targets(text) from public,anon,authenticated,service_role;

create table private.result_change_log (
  id uuid primary key default gen_random_uuid(),
  record_path text not null, actor_id uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(), source jsonb not null,
  changes jsonb not null
);
create index result_change_log_record_idx on private.result_change_log(record_path, changed_at desc);
alter table private.result_change_log enable row level security;
revoke all on private.result_change_log from public, anon, authenticated;

create function private.result_record(kind text, rid text) returns jsonb
language plpgsql stable set search_path = '' as $$
declare body jsonb;
begin
 case kind
 when 'athlete' then select private.athlete_snapshot(data,person_id,group_id) into body from public.athletes where id=rid;
 when 'swim' then select data into body from public.swims where id=rid;
 when 'relay' then select data into body from public.relay_results where id=rid;
 when 'meet' then select data into body from public.meets where id=rid;
 when 'standard' then select data into body from public.standards where id=rid;
 else raise invalid_parameter_value using message='Unknown record type.';
 end case;
 return body;
end; $$;
create function private.result_path(kind text,rid text) returns text
language sql immutable set search_path='' as $$
 select (case kind when 'swim' then 'swims' when 'relay' then 'relay_results' when 'athlete' then 'athletes' when 'meet' then 'meets' when 'standard' then 'standards' end)||'/'||rid;
$$;
create function private.result_audit(path text, previous jsonb, replacement jsonb, source jsonb) returns void
language sql set search_path='' as $$
 insert into private.result_change_log(record_path,actor_id,source,changes)
 select path,auth.uid(),source,coalesce(jsonb_object_agg(key,jsonb_build_object('before',previous->key,'after',replacement->key)),'{}'::jsonb)
 from (select jsonb_object_keys(coalesce(previous,'{}')||coalesce(replacement,'{}')) as key) keys
 where previous->key is distinct from replacement->key;
$$;

create function private.validate_managed_result(kind text, rid text, body jsonb) returns void
language plpgsql stable set search_path='' as $$
declare start_date text; end_date text; athlete jsonb;
begin
 if kind not in ('swim','relay','athlete','meet','standard') or rid !~ '^[a-zA-Z0-9_-]{1,128}$'
  or jsonb_typeof(body) is distinct from 'object' or body->>'id' is distinct from rid or pg_column_size(body)>1000000 then
  raise invalid_parameter_value using message='Invalid record.'; end if;
 if kind='athlete' then
  if nullif(btrim(body#>>'{name,first}'),'') is null or nullif(btrim(body#>>'{name,last}'),'') is null
   or coalesce(body->>'gender','') not in ('F','M','X') or coalesce(body->>'status','') not in ('active','inactive','alumni','taking_break')
   or (body ? 'dob' and (not pg_input_is_valid(body->>'dob','date') or body->>'dob' !~ '^\d{4}-\d{2}-\d{2}$'))
   or (body->>'teamId' is not null and body->>'teamId'<>'velocity-swimming') then
   raise invalid_parameter_value using message='A swimmer needs a name, category, and roster status; birthdays must be valid.'; end if;
 elsif kind='meet' then
  start_date:=body#>>'{dates,startDate}'; end_date:=body#>>'{dates,endDate}';
  if nullif(btrim(body->>'name'),'') is null or coalesce(start_date,'') !~ '^\d{4}-\d{2}-\d{2}$'
   or coalesce(end_date,'') !~ '^\d{4}-\d{2}-\d{2}$' or not pg_input_is_valid(start_date,'date') or not pg_input_is_valid(end_date,'date') or end_date<start_date then
   raise invalid_parameter_value using message='A meet needs a name and valid chronological dates.'; end if;
  if exists(select 1 from public.swims where meet_id=rid and data#>>'{meet,date}' not between start_date and end_date) or exists(select 1 from public.relay_results where meet_id=rid and data#>>'{meet,date}' not between start_date and end_date) then raise invalid_parameter_value using message='These dates would exclude existing results. Correct their meet or race date first.'; end if;
 elsif kind in ('swim','relay') then
  if body->>'teamId' is distinct from 'velocity-swimming' or coalesce(body->>'gender','') not in ('F','M','X')
   or coalesce(body->>'round','') not in ('F','P','S','TT') or coalesce(body->>'status','') not in ('OK','DQ','DFS','NS','DNF','SCR')
   or jsonb_typeof(body->'isOfficial') is distinct from 'boolean'
   or coalesce(body->>'timeMs','') !~ '^[0-9]{1,9}$' or (body->>'status'='OK' and (body->>'timeMs')::bigint=0)
   or coalesce(body#>>'{meet,date}','') !~ '^\d{4}-\d{2}-\d{2}$' or not pg_input_is_valid(body#>>'{meet,date}','date')
   or coalesce(body->>'course','') not in ('SCY','SCM','LCM') or split_part(body->>'eventCode','_',3) is distinct from body->>'course'
   or split_part(body->>'eventCode','_',1) is distinct from body->>'distance' then
   raise invalid_parameter_value using message='Invalid result event, date, status, or timing.'; end if;
  select coalesce(data->>'startsOn',data->>'startDate',data#>>'{dates,startDate}'),
    coalesce(data->>'endsOn',data->>'endDate',data#>>'{dates,endDate}',data->>'startsOn',data->>'startDate',data#>>'{dates,startDate}')
   into start_date,end_date from public.meets where id=body#>>'{meet,id}';
  if start_date is null or body#>>'{meet,date}' not between start_date and end_date then
   raise invalid_parameter_value using message='Choose an existing meet and a race date within it.'; end if;
  if kind='swim' then
   if coalesce(body->>'eventCode','') !~ '^(25|50|100|200|400|500|800|1000|1500|1650)_(FR|BK|BR|FL|IM)_(SCY|SCM|LCM)$'
    or split_part(body->>'eventCode','_',2) is distinct from body->>'stroke'
    or not exists(select 1 from public.athletes where id=body->>'athleteId')
    or (body ? 'ageAtSwim' and (coalesce(body->>'ageAtSwim','') !~ '^[0-9]{1,3}$' or (body->>'ageAtSwim')::int>120)) then
    raise invalid_parameter_value using message='Choose a swimmer, valid event, and valid age or leave age unknown.'; end if;
  end if;
  perform private.validate_result_splits(body,(body->>'distance')::integer,(body->>'timeMs')::bigint);
 end if;
 -- Standards and relays additionally use their existing database validators.
end; $$;

-- DNF and SCR are outcomes, never rankable times. Preserve their source status.
do $$ declare definition text; constraint_name text; begin
 select conname into constraint_name from pg_constraint where conrelid='public.swims'::regclass and contype='c'
  and pg_get_constraintdef(oid) like '%status%' and pg_get_constraintdef(oid) like '%DFS%';
 if constraint_name is not null then execute format('alter table public.swims drop constraint %I',constraint_name); end if;
 alter table public.swims add constraint swims_result_status_check check(status in ('OK','DQ','DFS','NS','DNF','SCR'));
 definition:=pg_get_functiondef('private.validate_relay_result()'::regprocedure);
 if position('(''OK'',''DQ'',''DFS'',''NS'')' in definition)=0 then raise exception 'Expected relay outcome validator'; end if;
 execute replace(definition,'(''OK'',''DQ'',''DFS'',''NS'')','(''OK'',''DQ'',''DFS'',''NS'',''DNF'',''SCR'')');
 -- A file or an authenticated manual edit is valid occurrence evidence; no fabricated URL.
 definition:=pg_get_functiondef('private.claim_result_identity(text,text,jsonb)'::regprocedure);
 definition:=replace(definition,
  'or coalesce(proof->>''sourceUrl'','''') !~ ''^https?://[^[:space:]]+$''',
  'or not (coalesce(proof->>''sourceUrl'','''') ~ ''^https?://[^[:space:]]+$'' or exists(select 1 from private.result_occurrences o where o.kind=k and o.result_id=rid and o.base_key=base and o.occurrence=proof->>''occurrence'' and o.evidence=proof) or (private.is_data_owner() and ((proof->>''method''=''manual'') or (proof->>''method''=''meet_file'' and coalesce(proof->>''sha256'','''') ~ ''^[a-f0-9]{64}$'' and coalesce(proof->>''line'','''') ~ ''^[1-9][0-9]*$''))))');
 execute definition;
end; $$;

-- The existing cron refresh is also called by authenticated saves now. Preserve
-- its eligibility logic while satisfying PostgREST's safe-update guard.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('private.refresh_team_records()'::regprocedure);
 definition:=replace(definition,'delete from public.team_record_holders;','delete from public.team_record_holders where true;');
 execute definition;
end $$;

create function private.save_result_record(kind text, rid text, body jsonb, expected text, source jsonb)
returns jsonb language plpgsql set search_path='' as $$
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
 if kind='swim' then events:=array_remove(array[previous->>'eventCode',next->>'eventCode'],null);
 elsif kind='athlete' then select array_agg(distinct event_code) into events from public.swims where athlete_id=rid; end if;
 if cardinality(events)>0 then perform private.rebuild_bests_for_events(events); end if;
 if kind in ('swim','relay','athlete') then perform pg_advisory_xact_lock(hashtext('velocity-team-record-refresh')); perform private.refresh_team_records(); end if;
 next:=private.result_record(kind,rid);
 return jsonb_build_object('id',rid,'data',next,'version',md5(next::text));
end; $$;

create function public.manage_result_records(input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare kind text:=input->>'kind'; rid text:=input->>'id'; body jsonb; tab text; rows jsonb; offset_n integer:=coalesce((input->>'offset')::int,0); query text:=coalesce(input->>'search',''); related jsonb; saved jsonb; parent_id text:=nullif(input->>'parentRelayId','');
begin
 if not private.is_data_owner() then raise insufficient_privilege using message='Only the data owner can manage records.'; end if;
 if kind is null or kind not in ('swim','relay','athlete','meet','standard') or offset_n<0 or offset_n>1000000 or length(query)>100 then raise invalid_parameter_value; end if;
 if input->>'action'='save' then
  if input ? 'related' and (kind<>'relay' or jsonb_typeof(input->'related') is distinct from 'array' or jsonb_array_length(input->'related')>10) then raise invalid_parameter_value using message='Save at most ten linked first-leg corrections with a relay.'; end if;
  if input ? 'related' then set constraints public.relay_leadoff_children_consistent deferred; end if;
  saved:=private.save_result_record(kind,rid,input->'data',input->>'version',jsonb_build_object('method','manual'));
  for related in select * from jsonb_array_elements(coalesce(input->'related','[]')) loop
   if related#>>'{data,parentRelayResultId}' is distinct from rid or not exists(select 1 from public.swims where id=related#>>'{data,id}' and parent_relay_result_id=rid) then raise invalid_parameter_value using message='A related correction must belong to this relay.'; end if;
   perform private.save_result_record('swim',related#>>'{data,id}',related->'data',related->>'version',jsonb_build_object('method','manual','relatedRelay',rid));
  end loop;
  if input ? 'related' then set constraints public.relay_leadoff_children_consistent immediate; end if;
  return saved;
 elsif input->>'action'='get' then
  body:=private.result_record(kind,rid);
  if body is null then raise no_data_found using message='Record not found.'; end if;
  return jsonb_build_object('id',rid,'data',body,'version',md5(body::text));
 elsif input->>'action' is distinct from 'list' then raise invalid_parameter_value; end if;
 tab:=split_part(private.result_path(kind,''),'/',1);
 if kind='athlete' then
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'data',data,'version',md5(data::text))),'[]') into rows
  from (select a.id,private.athlete_snapshot(a.data,a.person_id,a.group_id) data from public.athletes a join public.people p on p.id=a.person_id
    where query='' or p.name ilike '%'||query||'%' or a.id=query order by p.name,a.id limit 51 offset offset_n) found;
 else
  execute format('select coalesce(jsonb_agg(jsonb_build_object(''id'',id,''data'',data,''version'',md5(data::text))),''[]'') from (select id,data from public.%I where ($3 is null or ($4=''swim'' and data->>''parentRelayResultId''=$3)) and ($1='''' or id=$1 or coalesce(data->>''name'',data#>>''{meet,name}'','''') ilike ''%%''||$1||''%%'' or trim(coalesce(data#>>''{athleteName,first}'','''')||'' ''||coalesce(data#>>''{athleteName,last}'','''')) ilike ''%%''||$1||''%%'') order by id limit 51 offset $2) found',tab) into rows using query,offset_n,parent_id,kind;
 end if;
 return jsonb_build_object('rows',case when jsonb_array_length(rows)>50 then rows-50 else rows end,'hasMore',jsonb_array_length(rows)>50);
end; $$;
revoke all on function public.manage_result_records(jsonb) from public,anon;
grant execute on function public.manage_result_records(jsonb) to authenticated;

create function private.file_athlete(candidate jsonb, source jsonb) returns text
language plpgsql set search_path='' as $$
declare aid text; ids text[]; current_data jsonb; member_hash text:=nullif(candidate->>'memberHash','');
 first_name text:=btrim(candidate->>'first'); last_name text:=btrim(candidate->>'last'); fullname text; body jsonb;
begin
 fullname:=lower(first_name||' '||last_name);
 if coalesce(first_name,'')='' or coalesce(last_name,'')='' or coalesce(candidate->>'gender','') not in ('F','M','X') then raise exception 'Swimmer identity is incomplete.'; end if;
 if member_hash is not null then
  if member_hash !~ '^[a-f0-9]{24}$' then raise exception 'Invalid stable swimmer identity.'; end if;
  select array_agg(distinct t.athlete_id) into ids from private.source_swimmer_targets(member_hash) t;
  if cardinality(ids)>1 then raise exception 'Source swimmer identity is ambiguous.'; end if;
  aid:=ids[1];
 end if;
 if aid is null then
  select array_agg(a.id) into ids from public.athletes a join public.people p on p.id=a.person_id
   where lower(btrim(p.name))=fullname or exists(select 1 from jsonb_array_elements_text(coalesce(a.data->'aliases','[]')) alias where lower(btrim(alias))=fullname);
  if cardinality(ids)>0 then
   select array_agg(id) into ids from public.athletes where id=any(ids) and data->>'dob'=candidate->>'dob' and data->>'gender'=candidate->>'gender';
   if coalesce(cardinality(ids),0)<>1 then raise exception 'Name matches need one verified birthday/category match. Link the swimmer manually.'; end if;
   aid:=ids[1];
  end if;
 end if;
 if aid is not null then
  current_data:=private.result_record('athlete',aid);
  if (candidate->>'dob' is not null and current_data->>'dob' is not null and candidate->>'dob'<>current_data->>'dob')
   or (current_data->>'gender' is not null and candidate->>'gender'<>current_data->>'gender') then raise exception 'Source identity disagrees with the existing swimmer.'; end if;
 else
  if member_hash is null or coalesce(candidate->>'dob','') !~ '^\d{4}-\d{2}-\d{2}$' or not pg_input_is_valid(candidate->>'dob','date') then
   raise exception 'A new swimmer requires a stable source ID, full name, birthday, and category.'; end if;
  aid:='ath_file_'||member_hash;
  if exists(select 1 from public.athletes where id=aid) then raise exception 'Swimmer ID conflict. Link the existing profile manually.'; end if;
  body:=jsonb_build_object('id',aid,'name',jsonb_build_object('first',first_name,'last',last_name),'gender',candidate->>'gender',
   'dob',candidate->>'dob','teamId','velocity-swimming','status','inactive','aliases',jsonb_build_array(first_name||' '||last_name),
   'sourceObservation',jsonb_build_object('memberIdHash',member_hash));
  perform private.validate_managed_result('athlete',aid,body);
  perform private.put_record('athletes/'||aid,body);
  perform private.result_audit('athletes/'||aid,null,body,source);
 end if;
 if member_hash is not null then perform private.claim_athlete_identity('hytek-member',member_hash,aid,source); end if;
 return aid;
end; $$;

create function public.import_meet_results(input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
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
    if row->>'kind'='swim' then changed_events:=array_append(changed_events,code); end if;
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
 if imported>0 then perform pg_advisory_xact_lock(hashtext('velocity-team-record-refresh')); perform private.refresh_team_records(); end if;
 return jsonb_build_object('outcomes',outcomes,'saved',imported);
end; $$;
revoke all on function public.import_meet_results(jsonb) from public,anon;
grant execute on function public.import_meet_results(jsonb) to authenticated;
revoke all on function private.result_record(text,text),private.result_path(text,text),private.result_audit(text,jsonb,jsonb,jsonb),
 private.validate_managed_result(text,text,jsonb),private.save_result_record(text,text,jsonb,text,jsonb),private.file_athlete(jsonb,jsonb)
 from public,anon,authenticated,service_role;

-- Close the older generic writer for these records without changing Workshare access.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.commit_records(jsonb,jsonb)'::regprocedure);
 definition:=replace(definition,'perform pg_advisory_xact_lock(hashtext(''velocity-records''));',
  'if exists(select 1 from jsonb_array_elements(writes) w where split_part(w->>''path'',''/'',1) in (''swims'',''relay_results'',''athletes'',''meets'',''standards'')) then raise insufficient_privilege using message=''Use the owner-only Data editor.''; end if; perform pg_advisory_xact_lock(hashtext(''velocity-records''));');
 execute definition;
end; $$;
