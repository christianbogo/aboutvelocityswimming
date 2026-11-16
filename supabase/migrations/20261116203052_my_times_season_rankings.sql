-- Extend the existing ranked/recent/analysis candidate set, preserving its
-- moderation and relay rules. ISO dates compare lexically without casting the
-- indexed date column; the exclusive following-day bound includes timestamps.
do $$
declare
  definition text;
  previous_clause text := $previous$and (coalesce(input->>'year','')='' or left(s.swim_date,4)=input->>'year')$previous$;
  next_clause text := $next$and (coalesce(input->>'year','')='' or left(s.swim_date,4)=input->>'year')
   and (coalesce(input->>'startDate','')='' or s.swim_date>=input->>'startDate')
   and (coalesce(input->>'endDate','')='' or s.swim_date<((input->>'endDate')::date+1)::text)$next$;
begin
  select pg_get_functiondef('public.ies_times_candidates(jsonb)'::regprocedure) into definition;
  if strpos(definition,next_clause)>0 then return; end if;
  if (length(definition)-length(replace(definition,previous_clause,'')))/length(previous_clause)<>3 then
    raise exception 'Times candidates changed. Inspect before applying date ranges.';
  end if;
  execute replace(definition,previous_clause,next_clause);
end $$;

-- Restrict the season cohort before ranking. Athlete history uses its existing
-- athlete_id index; this index supports the bounded team/course/date scan.
create index public_times_season_idx on public.public_swims(times_team,times_course,swim_date)
  include(athlete_id,times_event,times_gender,times_age,times_time)
  where not times_relay and times_leg is null and not times_split and times_status='OK' and times_time>0;

create function public.ies_my_times(input jsonb default '{}') returns jsonb
language plpgsql stable security invoker set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare
  chosen_athlete text:=nullif(input->>'athleteId','');
  chosen_course text:=coalesce(nullif(input->>'course',''),'SCY');
  chosen_age integer:=nullif(input->>'ageAtSwim','')::integer;
  start_year text:=nullif(input->>'startYear','');
  end_year text:=nullif(input->>'endYear','');
  today date:=(current_timestamp at time zone 'America/Los_Angeles')::date;
  season_start date;
  season_end date;
  answer jsonb;
begin
  if chosen_athlete is null or length(chosen_athlete)>200 then raise exception 'Select an athlete'; end if;
  if chosen_course not in ('SCY','SCM','LCM') then raise exception 'Invalid course'; end if;
  if chosen_age is not null and (chosen_age not between 0 and 120 or start_year is not null or end_year is not null) then
    raise exception 'Choose an age or a year range';
  end if;
  if (start_year is not null and start_year !~ '^[1-9][0-9]{3}$')
    or (end_year is not null and end_year !~ '^[1-9][0-9]{3}$')
    or start_year>end_year then raise exception 'Invalid year range';
  end if;
  season_start:=make_date(extract(year from today)::integer-case when extract(month from today)<9 then 1 else 0 end,9,1);
  season_end:=(season_start+interval '1 year'-interval '1 day')::date;

  with athlete_history as materialized (
    select s.id,s.times_course as course,s.times_event as event,s.times_time as time,
      s.swim_date as date,s.times_age as age,s.times_gender as gender,s.times_status as status
    from public.unflagged_times_swims s
    join public.public_times_teams t on t.id=s.times_team
    join public.public_athletes a on a.id=s.athlete_id
    where s.athlete_id=chosen_athlete and s.times_team='velocity-swimming'
      and not s.times_relay and s.times_leg is null and not s.times_split
  ), athlete_swims as materialized (
    select * from athlete_history where status='OK' and time>0
  ), latest as (
    -- The public projection contains age at swim, never a date of birth. Use the
    -- latest known age across courses, even from a DQ, so aging up cannot retain
    -- an old rank. Invalid times still never become personal bests or ranks.
    select age,public.ies_times_age(age,false,'') as age_group
    from athlete_history where age is not null and date<(today+1)::text
    order by left(date,10) desc,age desc,date desc,id desc limit 1
  ), course_swims as materialized (
    select * from athlete_swims where course=chosen_course
  ), events as (
    select distinct event from course_swims
  ), bests as (
    select distinct on (event) event,id from course_swims
    where (chosen_age is null or age=chosen_age)
      and (start_year is null or date>=start_year||'-01-01')
      and (end_year is null or date<(end_year::integer+1)::text||'-01-01')
    order by event,time,date desc,id
  ), season_candidates as materialized (
    select c.*,s.times_gender as gender from public.ies_times_candidates(jsonb_build_object(
      'team','velocity-swimming','course',chosen_course,'startDate',season_start,'endDate',season_end,
      'ageGroups',jsonb_build_array(coalesce((select age_group from latest),'unknown'))
    )) c join public.public_swims s on s.id=c.id
  ), season_bests as (
    select distinct on (event,gender,athlete_id) * from season_candidates
    where gender in ('F','M','X') order by event,gender,athlete_id,time,date desc,id
  ), ranked as (
    select b.*,rank() over(partition by event,gender order by time) as position,
      count(*) over(partition by event,gender) as cohort_count
    from season_bests b
  ), own_season as (
    select distinct on (event) * from ranked where athlete_id=chosen_athlete
    order by event,time,date desc,id
  )
  select jsonb_build_object('myTimes',jsonb_build_object(
    'athleteId',chosen_athlete,
    'ages',coalesce((select jsonb_agg(age order by age) from (select distinct age from course_swims where age is not null) a),'[]'),
    'years',coalesce((select jsonb_agg(year order by year desc) from (select distinct left(date,4) as year from course_swims) y),'[]'),
    'seasonStart',season_start,'seasonEnd',season_end,
    'seasonLabel',extract(year from season_start)::text||'–'||right(extract(year from season_end)::text,2),
    'seasonAge',(select age from latest),'seasonAgeGroup',(select age_group from latest),
    'events',coalesce((select jsonb_agg(jsonb_build_object(
      'event',e.event,'race',case when b.id is not null then public.ies_times_json_id(b.id) end,
      'seasonRace',case when s.id is not null then public.ies_times_json_id(s.id) end,
      'seasonRank',s.position,'seasonCount',coalesce(s.cohort_count,0),
      'rankAgeGroup',case when s.id is not null then (select age_group from latest) end,'rankGender',s.gender
    ) order by e.event) from events e left join bests b using(event) left join own_season s using(event)),'[]')
  )) into answer;
  return answer;
end $$;
revoke all on function public.ies_my_times(jsonb) from public;
grant execute on function public.ies_my_times(jsonb) to anon,authenticated,service_role;
comment on function public.ies_my_times(jsonb) is
  'Velocity personal bests by exact age/calendar years, plus complete current Sep–Aug season team ranks in the latest recorded age group. Public projections only.';
