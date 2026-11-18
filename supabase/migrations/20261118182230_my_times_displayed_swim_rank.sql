-- Rank the displayed personal best in that swim's recorded age and gender.
-- Age/year filters choose the displayed result; the comparison cohort always
-- includes all eligible history. Keep the season and legacy bests RPCs intact.
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
    -- Preserve the informational latest-age metadata, including DQs, without
    -- using it to choose the historical swim's ranking category.
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
  ), targets as (
    select b.*, public.ies_times_age(b.age, false, '') as age_group,
      public.ies_times_age_range(public.ies_times_age(b.age, false, '')) as ages
    from bests b where b.age is not null and b.gender in ('F', 'M', 'X')
  ), ranked as (
    select b.event, b.id, b.gender, b.age_group, p.cohort_count,
      p.rank_position - case when exists (
        -- The displayed swim replaces this athlete's other best in the cohort.
        -- A newer/faster swim by the same athlete cannot push them down a place.
        select 1 from course_swims own
        where own.event = b.event and own.gender = b.gender and b.ages @> own.age and own.time < b.time
      ) then 1 else 0 end as position
    from targets b
    cross join lateral private.ies_my_times_peer_counts(
      chosen_course, b.event, b.gender, b.ages, null, null, b.time
    ) p
  )
  select jsonb_build_object('myTimes', jsonb_build_object(
    'period', 'all', 'athleteId', chosen_athlete,
    'ages', coalesce((select jsonb_agg(age order by age) from (select distinct age from course_swims where age is not null) a), '[]'),
    'years', coalesce((select jsonb_agg(year order by year desc) from (select distinct left(date, 4) as year from course_swims) y), '[]'),
    'latestAge', (select age from latest), 'latestAgeGroup', (select age_group from latest),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
      'event', e.event, 'race', case when b.id is not null then public.ies_times_json_id(b.id) end,
      'rankRace', case when r.id is not null then public.ies_times_json_id(r.id) end,
      'allTimeRank', r.position, 'allTimeCount', coalesce(r.cohort_count, 0),
      'rankAgeGroup', r.age_group, 'rankGender', r.gender
    ) order by e.event) from events e left join bests b using (event) left join ranked r using (event)), '[]')
  )) into answer;
  return answer;
end $$;
revoke all on function public.ies_my_times_all_time(jsonb) from public;
grant execute on function public.ies_my_times_all_time(jsonb) to anon, authenticated, service_role;
comment on function public.ies_my_times_all_time(jsonb) is
  'Velocity displayed personal bests by age range, exact age or calendar years, ranked against complete all-time history in the displayed swim''s age group and gender.';

notify pgrst, 'reload schema';
