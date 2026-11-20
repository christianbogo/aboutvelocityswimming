-- Hydrate a whole page in one statement. Preserve the public serializer's
-- payload and moderation rules without replanning its nested lookups per row.
create function private.ies_times_json_ids(race_ids text[])
returns table(id text, race jsonb)
language sql stable security invoker set search_path = '' as $$
  with selected as materialized (
    select distinct on (r.id) r.*
    from public.ies_times_races r
    where r.id = any(race_ids)
    -- Match the individual-before-relay view order used by ies_times_json_id if a
    -- legacy source happens to have reused an ID across the two result types.
    order by r.id, case when r.athlete_id = '' and r.relay then 1 else 0 end
  ), hydrated as (
    select r.*, coalesce(relay.data, swim.data) as source_data,
      case when r.athlete_id = '' and r.relay then 'relay' else 'swim' end as result_type,
      case when swim.athlete_id = r.athlete_id then swim.data->>'parentRelayResultId' end as parent_id
    from selected r
    left join public.public_swims swim on swim.id = r.id
    left join public.public_relay_results relay on relay.id = r.id
  )
  select r.id, jsonb_build_object(
    'id', r.id, 'athleteId', case when r.relay and r.relay_leg is null then '' else r.athlete_id end,
    'athleteName', r.athlete_name, 'date', r.date, 'event', r.event, 'course', r.course,
    'time', r.time, 'status', r.status, 'round', r.round, 'team', r.team,
    'teamName', r.team_name, 'gender', r.gender, 'ageAtSwim', r.age, 'official', r.official,
    'relay', r.relay, 'relayLeg', r.relay_leg, 'relayName', r.relay_name,
    'relayAgeGroup', r.relay_age, 'split', r.split, 'meetId', r.meet_id, 'meet', r.meet
  ) || jsonb_strip_nulls(jsonb_build_object(
    'members', r.source_data->'members', 'lineupCoverage', r.source_data->'lineupCoverage',
    'splits', r.source_data->'splits', 'splitCoverage', r.source_data->'splitCoverage',
    'resultOrigin', r.source_data->'resultOrigin', 'parentRelayResultId', r.source_data->'parentRelayResultId'
  )) || jsonb_build_object(
    'resultType', r.result_type,
    'moderationStatus', case when coalesce(direct.flagged, false) or coalesce(parent.flagged, false) then 'flagged' else 'clear' end,
    'moderationInherited', coalesce(parent.flagged, false),
    'calculationEligible', not (coalesce(direct.flagged, false) or coalesce(parent.flagged, false))
      and r.status = 'OK' and r.time > 0 and not r.split and r.relay_leg is null
  )
  from hydrated r
  left join public.result_moderation direct on direct.result_type = r.result_type and direct.result_id = r.id
  left join public.result_moderation parent on parent.result_type = 'relay' and parent.result_id = r.parent_id;
$$;
revoke all on function private.ies_times_json_ids(text[]) from public;
grant execute on function private.ies_times_json_ids(text[]) to anon, authenticated, service_role;

-- Replace only the rankings branch; all other query kinds retain their current
-- definitions, including deployments with historical compatibility branches.
do $migration$
declare
  definition text := pg_get_functiondef('public.ies_times_query(text,jsonb)'::regprocedure);
  first_marker text := 'elsif query_kind=''rankings'' then';
  last_marker text := 'elsif query_kind=''race'' then';
  first_at integer;
  last_at integer;
begin
  first_at := strpos(definition, first_marker);
  last_at := strpos(definition, last_marker);
  if first_at = 0 or last_at <= first_at then
    raise exception 'Cannot locate the supported leaderboard query branch';
  end if;
  definition := left(definition, first_at - 1) || $replacement$
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
 $replacement$ || substr(definition, last_at);
  execute definition;
end $migration$;

create or replace function public.ies_times_recent(input jsonb default '{}') returns jsonb
language plpgsql stable security invoker set search_path = '' set extra_float_digits = 3 set plan_cache_mode = 'force_custom_plan' as $$
declare
  start_at int := coalesce((input->>'offset')::int, 0);
  page_size int := coalesce((input->>'limit')::int, 25);
  needle text := lower(trim(coalesce(input->>'search', '')));
  answer jsonb;
begin
  if start_at < 0 or page_size not between 1 and 100 or length(needle) > 100 then
    raise exception 'Invalid pagination or search';
  end if;
  with matching as materialized (
    select id, nullif(date, '') as swim_date, time
    from public.ies_times_candidates(input)
    where needle = '' or position(needle in lower(search_name)) > 0
  ), page as materialized (
    select * from matching order by swim_date desc nulls last, time, id limit page_size offset start_at
  ), races as materialized (
    select * from private.ies_times_json_ids(array(select id from page))
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('race', r.race)
      order by p.swim_date desc nulls last, p.time, p.id)
      from page p left join races r using(id)), '[]'::jsonb),
    'total', (select count(*) from matching)
  ) into answer;
  return answer;
end;
$$;

create or replace function public.ies_my_times_all_time(input jsonb default '{}') returns jsonb
language plpgsql stable security invoker set search_path = '' set plan_cache_mode = 'force_custom_plan' as $$
declare
  chosen_athlete text := nullif(input->>'athleteId', '');
  chosen_course text := coalesce(nullif(input->>'course', ''), 'SCY');
  chosen_age integer := nullif(input->>'ageAtSwim', '')::integer;
  chosen_group text := nullif(input->>'ageGroup', '');
  chosen_ages int4range;
  start_year text := nullif(input->>'startYear', '');
  end_year text := nullif(input->>'endYear', '');
  today date := (current_timestamp at time zone 'America/Los_Angeles')::date;
  answer jsonb;
begin
  if chosen_athlete is null or length(chosen_athlete) > 200 then raise exception 'Select an athlete'; end if;
  if chosen_course not in ('SCY', 'SCM', 'LCM') then raise exception 'Invalid course'; end if;
  if chosen_group is not null then
    if chosen_group not in ('8&U', '9-10', '11-12', '13-14', '15-16', '17-18', '19&O', '10&U', '12&U', '13&O', '15&O', 'Open') then
      raise exception 'Invalid age group';
    end if;
    chosen_ages := public.ies_times_age_range(chosen_group);
    if chosen_age is not null or start_year is not null or end_year is not null then
      raise exception 'Choose an age range or a year range';
    end if;
  end if;
  if chosen_age is not null and (chosen_age not between 0 and 120 or start_year is not null or end_year is not null) then
    raise exception 'Choose an age or a year range';
  end if;
  if (start_year is not null and start_year !~ '^[1-9][0-9]{3}$')
    or (end_year is not null and end_year !~ '^[1-9][0-9]{3}$')
    or start_year > end_year then raise exception 'Invalid year range';
  end if;

  with athlete_history as materialized (
    select s.id, s.times_course as course, s.times_event as event, s.times_time as time,
      s.swim_date as date, s.times_age as age, s.times_gender as gender, s.times_status as status
    from public.unflagged_times_swims s
    join public.public_times_teams t on t.id = s.times_team
    join public.public_athletes a on a.id = s.athlete_id
    where s.athlete_id = chosen_athlete and s.times_team = 'velocity-swimming'
      and not s.times_relay and s.times_leg is null and not s.times_split
  ), course_swims as materialized (
    select * from athlete_history where course = chosen_course and status = 'OK' and time > 0
  ), latest as (
    select age, public.ies_times_age(age, false, '') as age_group
    from athlete_history where age is not null and date < (today + 1)::text
    order by left(date, 10) desc, age desc, date desc, id desc limit 1
  ), events as (
    select distinct event from course_swims
  ), bests as materialized (
    select distinct on (event) * from course_swims
    where (chosen_age is null or age = chosen_age)
      and (chosen_group is null or chosen_ages @> age)
      and (start_year is null or date >= start_year||'-01-01')
      and (end_year is null or date < (end_year::integer + 1)::text||'-01-01')
    order by event, time, date desc, id
  ), targets as materialized (
    select b.*, public.ies_times_age(b.age, false, '') as age_group,
      public.ies_times_age_range(public.ies_times_age(b.age, false, '')) as ages
    from bests b where b.age is not null and b.gender in ('F', 'M', 'X')
  ), peer_bests as materialized (
    -- Calculate the requested event cohorts together, retaining one time per
    -- athlete. This replaces a separately planned COUNT(DISTINCT) RPC per event.
    select b.event, s.athlete_id, min(s.times_time) as time
    from targets b
    join public.unflagged_times_swims s on s.times_course = chosen_course
      and s.times_event = b.event and s.times_gender = b.gender
      and s.times_age >= lower(b.ages)
      and (upper_inf(b.ages) or s.times_age < upper(b.ages))
    join public.public_times_teams t on t.id = s.times_team
    join public.public_athletes a on a.id = s.athlete_id
    where s.times_team = 'velocity-swimming' and s.times_status = 'OK' and s.times_time > 0
      and not s.times_relay and s.times_leg is null and not s.times_split
    group by b.event, s.athlete_id
  ), ranked as (
    select b.event, b.id, b.gender, b.age_group, count(p.athlete_id) as cohort_count,
      1 + count(p.athlete_id) filter (where p.time < b.time and p.athlete_id <> chosen_athlete) as position
    from targets b left join peer_bests p using(event)
    group by b.event, b.id, b.gender, b.age_group, b.time
  ), races as materialized (
    -- race and rankRace are the same displayed swim; hydrate it only once.
    select * from private.ies_times_json_ids(array(select id from bests))
  )
  select jsonb_build_object('myTimes', jsonb_build_object(
    'period', 'all', 'athleteId', chosen_athlete,
    'ages', coalesce((select jsonb_agg(age order by age) from (select distinct age from course_swims where age is not null) a), '[]'),
    'years', coalesce((select jsonb_agg(year order by year desc) from (select distinct left(date, 4) as year from course_swims) y), '[]'),
    'latestAge', (select age from latest), 'latestAgeGroup', (select age_group from latest),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
      'event', e.event, 'race', h.race,
      'rankRace', case when r.id is not null then h.race end,
      'allTimeRank', r.position, 'allTimeCount', coalesce(r.cohort_count, 0),
      'rankAgeGroup', r.age_group, 'rankGender', r.gender
    ) order by e.event) from events e left join bests b using(event)
      left join ranked r using(event) left join races h on h.id = b.id), '[]')
  )) into answer;
  return answer;
end;
$$;

revoke all on function public.ies_times_recent(jsonb), public.ies_my_times_all_time(jsonb) from public;
grant execute on function public.ies_times_recent(jsonb), public.ies_my_times_all_time(jsonb) to anon, authenticated, service_role;
notify pgrst, 'reload schema';
