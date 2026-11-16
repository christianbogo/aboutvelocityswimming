-- Keep moderation live, while letting PostgreSQL plan both exclusions as joins.
create or replace view public.unflagged_times_swims with (security_invoker = true) as
select s.* from public.public_swims s
where not exists (
  select 1 from public.result_moderation m
  where m.flagged and m.result_type = 'swim' and m.result_id = s.id
) and not exists (
  select 1 from public.result_moderation m
  where m.flagged and m.result_type = 'relay' and m.result_id = s.data->>'parentRelayResultId'
);

create or replace view public.unflagged_times_relays with (security_invoker = true) as
select s.* from public.public_relay_results s
where not exists (
  select 1 from public.result_moderation m
  where m.flagged and m.result_type = 'relay' and m.result_id = s.id
);

create or replace function public.ies_times_candidates(input jsonb)
returns table(id text, athlete_id text, date text, course text, event text, "time" bigint, relay boolean, search_name text)
language plpgsql stable security invoker set search_path = '' set plan_cache_mode = 'force_custom_plan' as $$
declare
  relay_only boolean := coalesce((input->>'relay')::boolean, false);
  needle text := lower(trim(coalesce(input->>'search', '')));
  age_filter boolean;
  age_ranges int4multirange;
  age_bounds int4range;
begin
  if relay_only then
    return query
    select s.id, ''::text, s.swim_date, s.times_course, s.times_event, s.times_time, true,
      case when needle = '' then '' else coalesce(nullif(s.data#>>'{relay,teamName}', ''), coalesce(s.data->>'teamName', '')||' relay') end
    from public.unflagged_times_relays s join public.public_times_teams t on t.id = s.team_id
    where s.data->>'status' = 'OK' and s.times_time > 0
      and (coalesce(input->>'team', '') = '' or s.team_id = input->>'team')
      and (coalesce(input->>'course', '') = '' or s.times_course = input->>'course')
      and (coalesce(input->>'event', '') = '' or s.times_event = input->>'event')
      and (coalesce(input->>'year', '') = '' or left(s.swim_date, 4) = input->>'year')
      and (coalesce(input->>'startDate', '') = '' or s.swim_date >= input->>'startDate')
      and (coalesce(input->>'endDate', '') = '' or s.swim_date < ((input->>'endDate')::date + 1)::text)
      and (coalesce(input->>'round', '') = '' or coalesce(s.data->>'round', '') = input->>'round')
      and (coalesce(input->>'official', '') = '' or (s.data->>'isOfficial')::boolean = (input->>'official' = 'official'))
      and (not (input ? 'genders') or input->'genders' ? coalesce(s.data->>'gender', ''))
      and public.ies_times_age_matches(null, true, coalesce(s.data->>'ageGroup', ''), input->'ageGroups')
    union all
    select s.id, s.athlete_id, s.swim_date, s.times_course, s.times_event, s.times_time, true,
      case when needle = '' then '' else coalesce(nullif(s.data#>>'{relay,teamName}', ''), coalesce(s.data->>'teamName', '')||' relay') end
    from public.unflagged_times_swims s join public.public_times_teams t on t.id = s.times_team
    join public.public_athletes a on a.id = s.athlete_id
    where s.times_relay and s.times_leg is null and not s.times_split and s.times_status = 'OK' and s.times_time > 0
      and (coalesce(input->>'team', '') = '' or s.times_team = input->>'team')
      and (coalesce(input->>'course', '') = '' or s.times_course = input->>'course')
      and (coalesce(input->>'event', '') = '' or s.times_event = input->>'event')
      and (coalesce(input->>'year', '') = '' or left(s.swim_date, 4) = input->>'year')
      and (coalesce(input->>'startDate', '') = '' or s.swim_date >= input->>'startDate')
      and (coalesce(input->>'endDate', '') = '' or s.swim_date < ((input->>'endDate')::date + 1)::text)
      and (coalesce(input->>'round', '') = '' or coalesce(s.data->>'round', '') = input->>'round')
      and (coalesce(input->>'official', '') = '' or s.times_official = (input->>'official' = 'official'))
      and (not (input ? 'genders') or input->'genders' ? s.times_gender)
      and public.ies_times_age_matches(null, true, coalesce(s.data->>'ageGroup', ''), input->'ageGroups');
  else
    age_filter := coalesce(jsonb_array_length(input->'ageGroups'), 0) > 0;
    if age_filter then
      select range_agg(public.ies_times_age_range(g.label)) into age_ranges
      from jsonb_array_elements_text(input->'ageGroups') g(label);
      age_bounds := range_merge(age_ranges);
    end if;

    return query
    select s.id, s.athlete_id, s.swim_date, s.times_course, s.times_event, s.times_time, false,
      case when needle = '' then '' else coalesce(nullif(trim(coalesce(a.data#>>'{name,first}', '')||' '||coalesce(a.data#>>'{name,last}', '')), ''), s.athlete_id) end
    from public.unflagged_times_swims s join public.public_times_teams t on t.id = s.times_team
    join public.public_athletes a on a.id = s.athlete_id
    where not s.times_relay and s.times_leg is null and not s.times_split and s.times_status = 'OK' and s.times_time > 0
      and (coalesce(input->>'team', '') = '' or s.times_team = input->>'team')
      and (coalesce(input->>'course', '') = '' or s.times_course = input->>'course')
      and (coalesce(input->>'event', '') = '' or s.times_event = input->>'event')
      and (coalesce(input->>'year', '') = '' or left(s.swim_date, 4) = input->>'year')
      and (coalesce(input->>'startDate', '') = '' or s.swim_date >= input->>'startDate')
      and (coalesce(input->>'endDate', '') = '' or s.swim_date < ((input->>'endDate')::date + 1)::text)
      and (coalesce(input->>'round', '') = '' or coalesce(s.data->>'round', '') = input->>'round')
      and (coalesce(input->>'official', '') = '' or s.times_official = (input->>'official' = 'official'))
      and (not (input ? 'genders') or input->'genders' ? s.times_gender)
      -- The outer bounds work with the age index. Exact membership still
      -- excludes gaps between selected groups and returns each swim once.
      and (not age_filter or (
        s.times_age >= lower(age_bounds)
        and (upper_inf(age_bounds) or s.times_age < upper(age_bounds))
        and age_ranges @> s.times_age
      ));
  end if;
end $$;

-- Only compare the cohorts of the chosen athlete's qualifying race per event.
-- A swimmer contributes once if they swam at all, and once to the faster
-- count if any of their eligible swims is strictly faster than that race.
create function private.ies_my_times_peer_counts(
  chosen_course text, chosen_event text, chosen_gender text, chosen_ages int4range,
  start_on text, before_date text, target_time bigint
) returns table(rank_position bigint, cohort_count bigint)
language sql stable security invoker set search_path = '' set plan_cache_mode = 'force_custom_plan' as $$
  select 1 + count(distinct s.athlete_id) filter (where s.times_time < target_time),
    count(distinct s.athlete_id)
  from public.unflagged_times_swims s
  join public.public_times_teams t on t.id = s.times_team
  join public.public_athletes a on a.id = s.athlete_id
  where s.times_team = 'velocity-swimming' and s.times_course = chosen_course
    and s.times_event = chosen_event and s.times_gender = chosen_gender
    and s.times_status = 'OK' and s.times_time > 0
    and not s.times_relay and s.times_leg is null and not s.times_split
    and s.times_age >= lower(chosen_ages)
    and (upper_inf(chosen_ages) or s.times_age < upper(chosen_ages))
    and (start_on is null or s.swim_date >= start_on)
    and (before_date is null or s.swim_date < before_date)
$$;
revoke all on function private.ies_my_times_peer_counts(text, text, text, int4range, text, text, bigint) from public;
grant execute on function private.ies_my_times_peer_counts(text, text, text, int4range, text, text, bigint) to anon, authenticated, service_role;

create function private.ies_my_times_read(input jsonb, read_period text) returns jsonb
language plpgsql stable security invoker set search_path = '' set plan_cache_mode = 'force_custom_plan' as $$
declare
  chosen_athlete text := nullif(input->>'athleteId', '');
  chosen_course text := coalesce(nullif(input->>'course', ''), 'SCY');
  chosen_age integer := nullif(input->>'ageAtSwim', '')::integer;
  start_year text := nullif(input->>'startYear', '');
  end_year text := nullif(input->>'endYear', '');
  today date := (current_timestamp at time zone 'America/Los_Angeles')::date;
  season_start date;
  season_end date;
  season_end_exclusive date;
  answer jsonb;
begin
  if chosen_athlete is null or length(chosen_athlete) > 200 then raise exception 'Select an athlete'; end if;
  if chosen_course not in ('SCY', 'SCM', 'LCM') then raise exception 'Invalid course'; end if;
  if chosen_age is not null and (chosen_age not between 0 and 120 or start_year is not null or end_year is not null) then
    raise exception 'Choose an age or a year range';
  end if;
  if (start_year is not null and start_year !~ '^[1-9][0-9]{3}$')
    or (end_year is not null and end_year !~ '^[1-9][0-9]{3}$')
    or start_year > end_year then raise exception 'Invalid year range';
  end if;
  if read_period = 'season' then
    season_start := make_date(extract(year from today)::integer - case when extract(month from today) < 9 then 1 else 0 end, 9, 1);
    season_end_exclusive := (season_start + interval '1 year')::date;
    season_end := season_end_exclusive - 1;
  end if;

  with athlete_history as materialized (
    select s.id, s.times_course as course, s.times_event as event, s.times_time as time,
      s.swim_date as date, s.times_age as age, s.times_gender as gender, s.times_status as status
    from public.unflagged_times_swims s
    join public.public_times_teams t on t.id = s.times_team
    join public.public_athletes a on a.id = s.athlete_id
    where s.athlete_id = chosen_athlete and s.times_team = 'velocity-swimming'
      and not s.times_relay and s.times_leg is null and not s.times_split
      and (read_period <> 'bests' or s.times_course = chosen_course)
  ), course_swims as materialized (
    select * from athlete_history where course = chosen_course and status = 'OK' and time > 0
  ), bests as (
    select distinct on (event) event, id from course_swims
    where (chosen_age is null or age = chosen_age)
      and (start_year is null or date >= start_year||'-01-01')
      and (end_year is null or date < (end_year::integer + 1)::text||'-01-01')
    order by event, time, date desc, id
  )
  select case when read_period = 'bests' then jsonb_build_object('personalBests', coalesce((
    select jsonb_agg(jsonb_build_object('event', event, 'race', public.ies_times_json_id(id)) order by event)
    from bests
  ), '[]')) else (
    with latest as materialized (
      -- Age may come from any course, including an invalid time such as a DQ.
      select age, public.ies_times_age(age, false, '') as age_group
      from athlete_history where age is not null and date < (today + 1)::text
      order by left(date, 10) desc, age desc, date desc, id desc limit 1
    ), cohort as materialized (
      select public.ies_times_age_range(age_group) as ages from latest
    ), own_swims as (
      -- The best race across the swimmer's gender categories is also the best
      -- among each gender's winners. Keep the existing date and ID tiebreaks.
      select distinct on (s.event) s.event, s.id, s.gender, s.time, c.ages
      from course_swims s cross join cohort c
      where s.gender in ('F', 'M', 'X') and c.ages @> s.age
        and (season_start is null or s.date >= season_start::text)
        and (season_end_exclusive is null or s.date < season_end_exclusive::text)
      order by s.event, s.time, s.date desc, s.id
    ), ranked as (
      select s.event, s.id, s.gender, p.rank_position, p.cohort_count
      from own_swims s
      cross join lateral private.ies_my_times_peer_counts(chosen_course, s.event, s.gender, s.ages,
        season_start::text, season_end_exclusive::text, s.time) p
    ), events as (
      select distinct event from course_swims
    )
    select jsonb_build_object('myTimes', jsonb_build_object(
      'athleteId', chosen_athlete,
      'ages', coalesce((select jsonb_agg(age order by age) from (select distinct age from course_swims where age is not null) a), '[]'),
      'years', coalesce((select jsonb_agg(year order by year desc) from (select distinct left(date, 4) as year from course_swims) y), '[]'),
      'events', coalesce((select jsonb_agg(jsonb_build_object(
        'event', e.event, 'race', case when b.id is not null then public.ies_times_json_id(b.id) end,
        'rankAgeGroup', case when r.id is not null then (select age_group from latest) end, 'rankGender', r.gender
      ) || case when read_period = 'season' then jsonb_build_object(
        'seasonRace', case when r.id is not null then public.ies_times_json_id(r.id) end,
        'seasonRank', r.rank_position, 'seasonCount', coalesce(r.cohort_count, 0)
      ) else jsonb_build_object(
        'rankRace', case when r.id is not null then public.ies_times_json_id(r.id) end,
        'allTimeRank', r.rank_position, 'allTimeCount', coalesce(r.cohort_count, 0)
      ) end order by e.event) from events e left join bests b using (event) left join ranked r using (event)), '[]')
    ) || case when read_period = 'season' then jsonb_build_object(
      'seasonStart', season_start, 'seasonEnd', season_end,
      'seasonLabel', extract(year from season_start)::text||'–'||right(extract(year from season_end)::text, 2),
      'seasonAge', (select age from latest), 'seasonAgeGroup', (select age_group from latest)
    ) else jsonb_build_object(
      'period', 'all', 'latestAge', (select age from latest), 'latestAgeGroup', (select age_group from latest)
    ) end)
  ) end into answer;
  return answer;
end $$;
revoke all on function private.ies_my_times_read(jsonb, text) from public;
grant execute on function private.ies_my_times_read(jsonb, text) to anon, authenticated, service_role;

create or replace function public.ies_my_times(input jsonb default '{}') returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.ies_my_times_read(input, 'season')
$$;

create or replace function public.ies_my_times_all_time(input jsonb default '{}') returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.ies_my_times_read(input, 'all')
$$;

create function public.ies_my_times_bests(input jsonb default '{}') returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.ies_my_times_read(input, 'bests')
$$;
revoke all on function public.ies_my_times_bests(jsonb) from public;
grant execute on function public.ies_my_times_bests(jsonb) to anon, authenticated, service_role;
comment on function public.ies_my_times_bests(jsonb) is 'Velocity personal bests by exact age or calendar years.';

notify pgrst, 'reload schema';
