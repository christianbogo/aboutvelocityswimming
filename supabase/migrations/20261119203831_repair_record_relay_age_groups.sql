-- Keep original meet categories while allowing reviewed, four-member record eligibility.
-- An explicit empty recordAgeGroup excludes a mixed-band relay from records.
-- No date cutoff: historical eligible swims remain included.

CREATE OR REPLACE FUNCTION public.ies_times_age_range(age_group text)
 RETURNS int4range
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare key text:=upper(regexp_replace(age_group,'[[:space:]]','','g')); parts text[];
begin
 key:=replace(replace(key,'&UNDER','&U'),'&OVER','&O');
 if key='OPEN' then return int4range(0,null,'[]'); end if;
 parts:=regexp_match(key,'^([0-9]{1,3})[-–]([0-9]{1,3})$');
 if parts is not null then
  if parts[1]::int>parts[2]::int then return null; end if;
  return int4range(parts[1]::int,parts[2]::int,'[]');
 end if;
 parts:=regexp_match(key,'^([0-9]{1,3})&(U|O)$');
 if parts is null then return null; end if;
 return case when parts[2]='U' then int4range(0,parts[1]::int,'[]') else int4range(parts[1]::int,null,'[]') end;
end; $function$
;
CREATE OR REPLACE FUNCTION private.publish_relay_result()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare members jsonb:=private.public_relay_members(new.data);
begin
 insert into public.public_relay_results(id,team_id,swim_date,data)
 values(new.id,new.team_id,new.data#>>'{meet,date}',jsonb_strip_nulls(jsonb_build_object(
  'id',new.id,'eventCode',new.event_code,'course',new.course,'timeMs',new.time_ms,
  'timeDisplay',case when new.status='OK' and new.time_ms>0 then private.format_time(new.time_ms::integer) else new.status end,
  'status',new.status,'round',new.data->'round','isRelay',true,'isOfficial',new.data->'isOfficial',
  'teamId',new.team_id,'teamName',(select data->>'name' from public.teams where id=new.team_id),
  'gender',new.data->'gender','ageGroup',new.data->'ageGroup',
  'recordAgeGroup',new.data->'recordAgeGroup',
  'relay',jsonb_build_object('teamName',coalesce(new.data#>>'{relay,teamName}',new.data->>'relayName'),'leg',null),
  'meet',jsonb_build_object('id',new.meet_id,'name',new.data#>>'{meet,name}','date',new.data#>>'{meet,date}'),
  'members',members,'lineupCoverage',case when jsonb_array_length(members)=4 and not exists(select 1 from jsonb_array_elements(members) m where nullif(m->>'athleteId','') is null) then 'complete' when jsonb_array_length(members)>0 then 'partial' else 'unavailable' end,'splits',private.public_race_splits(new.data),
  'splitCoverage',new.data->'splitCoverage')))
 on conflict(id) do update set team_id=excluded.team_id,swim_date=excluded.swim_date,data=excluded.data;
 return new;
end; $function$
;
CREATE OR REPLACE FUNCTION private.refresh_team_records()
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare consumed bigint[];
begin
  if not pg_try_advisory_xact_lock(hashtext('velocity-team-record-refresh')) then return false; end if;
  select array_agg(transaction_id) into consumed from private.team_record_refresh_queue;
  if consumed is null then return false; end if;

  delete from public.team_record_holders;
  insert into public.team_record_holders
    (team,course,event,gender,age_group,result_type,result_id,athlete_id,swim_date,time_ms,relay,age,relay_age)
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
    where s.times_status='OK' and s.times_time>0 and s.times_gender in ('F','M','X')
      and s.times_leg is null and not s.times_split
      and not exists (select 1 from flagged_swims m where m.result_id=s.id)
      and not exists (select 1 from flagged_relays m where m.result_id=s.data->>'parentRelayResultId')
    union all
    select s.team_id,s.id,''::text,s.swim_date,s.times_course,s.times_event,s.times_time,true,
      s.data->>'gender',null::integer,coalesce(s.data->>'ageGroup',''),coalesce(s.data->>'recordAgeGroup',s.data->>'ageGroup',''),'relay'
    from public.public_relay_results s join public.public_times_teams t on t.id=s.team_id
    where s.data->>'status'='OK' and s.times_time>0 and s.data->>'gender' in ('F','M','X')
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

  update public.team_record_refresh_state set refreshed_at=clock_timestamp() where id;
  delete from private.team_record_refresh_queue where transaction_id=any(consumed);
  return true;
end;
$function$
;
