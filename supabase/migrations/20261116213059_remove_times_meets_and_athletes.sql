-- Retire the Meets and Athletes browsers while retaining all shared Times queries.
-- Existing race, athlete, meet, and imported evidence records are preserved.
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
 page as (select * from searched order by time,case when input->>'mode'='performances' or relay then id else athlete_id end,id limit size offset start_at)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('race',public.ies_times_json_id(p.id),'rank',p.position) order by p.time,case when input->>'mode'='performances' or p.relay then p.id else p.athlete_id end,p.id) from page p),'[]'),'total',(select count(*) from searched)) into answer;
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

-- These helpers and projection triggers served only the retired meet navigation.
-- No CASCADE: any unexpected dependent consumer must prevent removal.
drop function if exists public.ies_meet_navigation_query(text,jsonb);
drop function if exists public.ies_meet_event_rows(text);
drop trigger if exists project_meet_event_metadata on public.public_swims;
drop trigger if exists project_meet_event_metadata on public.public_relay_results;
drop function if exists private.project_meet_event_metadata();
drop function if exists private.public_meet_event_metadata(jsonb);

NOTIFY pgrst, 'reload schema';
