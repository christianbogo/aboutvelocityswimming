-- Let Postgres anti-join moderation decisions and check age eligibility once
-- per distinct individual age or relay category.
do $$
declare
  definition text;
  previous_section text := $previous$ elsif query_kind='records' then
 with eligible as (
  select s.id,s.athlete_id,s.swim_date as date,s.times_course as course,s.times_event as event,s.times_time as time,false as relay,s.times_gender as gender,
   s.times_age as age,''::text as relay_age
  from public.unflagged_times_swims s join public.public_times_teams t on t.id=s.times_team
  where s.times_team=input->>'team' and s.times_status='OK' and s.times_time>0 and s.times_gender in ('F','M','X')
   and not s.times_relay and s.times_leg is null and not s.times_split
  union all
  select s.id,''::text,s.swim_date,s.times_course,s.times_event,s.times_time,true,s.times_gender,null::integer,coalesce(s.data->>'ageGroup','')
  from public.unflagged_times_swims s join public.public_times_teams t on t.id=s.times_team
  where s.times_team=input->>'team' and s.times_status='OK' and s.times_time>0 and s.times_gender in ('F','M','X')
   and s.times_relay and s.times_leg is null and not s.times_split
  union all
  select s.id,''::text,s.swim_date,s.times_course,s.times_event,s.times_time,true,s.data->>'gender',null::integer,coalesce(s.data->>'ageGroup','')
  from public.unflagged_times_relays s join public.public_times_teams t on t.id=s.team_id
  where s.team_id=input->>'team' and s.data->>'status'='OK' and s.times_time>0 and s.data->>'gender' in ('F','M','X')
 ),
 groups as (
  select unnest(array['8&U','9-10','11-12','13-14','15-16','17-18','19&O','10&U','12&U','13&O','15&O','Open']) as age_group
  union select relay_age from eligible where relay and relay_age<>''
 ), categorized as (
  select e.*,g.age_group from eligible e join groups g
   on public.ies_times_age_matches(e.age,e.relay,e.relay_age,jsonb_build_array(g.age_group))
 ),$previous$;
  new_section text := $new$ elsif query_kind='records' then
 with flagged_swims as (
  select result_id from public.result_moderation where flagged and result_type='swim'
 ), flagged_relays as (
  select result_id from public.result_moderation where flagged and result_type='relay'
 ), eligible as materialized (
  select s.id,
   case when s.times_relay then '' else s.athlete_id end as athlete_id,
   s.swim_date as date,s.times_course as course,s.times_event as event,s.times_time as time,
   s.times_relay as relay,s.times_gender as gender,
   case when not s.times_relay then s.times_age end as age,
   case when s.times_relay then coalesce(s.data->>'ageGroup','') else '' end as relay_age
  from public.public_swims s join public.public_times_teams t on t.id=s.times_team
  where s.times_team=input->>'team' and s.times_status='OK' and s.times_time>0 and s.times_gender in ('F','M','X')
   and s.times_leg is null and not s.times_split
   and not exists (select 1 from flagged_swims m where m.result_id=s.id)
   and not exists (select 1 from flagged_relays m where m.result_id=s.data->>'parentRelayResultId')
  union all
  select s.id,''::text,s.swim_date,s.times_course,s.times_event,s.times_time,true,s.data->>'gender',null::integer,coalesce(s.data->>'ageGroup','')
  from public.public_relay_results s join public.public_times_teams t on t.id=s.team_id
  where s.team_id=input->>'team' and s.data->>'status'='OK' and s.times_time>0 and s.data->>'gender' in ('F','M','X')
   and not exists (select 1 from flagged_relays m where m.result_id=s.id)
 ), age_buckets as (
  select distinct age,relay,relay_age from eligible
 ), groups as (
  select unnest(array['8&U','9-10','11-12','13-14','15-16','17-18','19&O','10&U','12&U','13&O','15&O','Open']) as age_group
  union select relay_age from age_buckets where relay and relay_age<>''
 ), age_memberships as materialized (
  select b.relay,coalesce(b.age,-1) as age_key,b.relay_age,g.age_group
  from age_buckets b join groups g
   on public.ies_times_age_matches(b.age,b.relay,b.relay_age,jsonb_build_array(g.age_group))
 ), fastest_by_age as (
  -- Swims in this partition share every age group. Only the fastest time
  -- and its ties can win any of those groups.
  select e.*,rank() over(partition by course,event,gender,relay,age,relay_age order by time) as age_rank
  from eligible e
 ), categorized as (
  select e.id,e.athlete_id,e.date,e.course,e.event,e.time,e.relay,e.gender,m.age_group
  from fastest_by_age e join age_memberships m
   on m.relay=e.relay and m.age_key=coalesce(e.age,-1) and m.relay_age=e.relay_age
  where e.age_rank=1
 ),$new$;
begin
  select pg_get_functiondef('public.ies_times_query(text,jsonb)'::regprocedure) into definition;
  if strpos(definition, new_section) > 0 then return; end if;
  if strpos(definition, previous_section) = 0 then
    raise exception 'Team records eligibility query changed. Inspect before applying.';
  end if;
  execute replace(definition, previous_section, new_section);
end $$;
