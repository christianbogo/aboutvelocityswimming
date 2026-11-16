-- Add all-time team ranks without changing the deployed season RPC.
-- The latest recorded age group defines the cohort; personal-best age/year
-- filters never constrain that complete all-time cohort. Existing public Times
-- indexes and moderation rules apply before choosing each athlete's best.
create function public.ies_my_times_all_time(input jsonb default '{}') returns jsonb
language plpgsql stable security invoker set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare
  chosen_athlete text:=nullif(input->>'athleteId','');
  chosen_course text:=coalesce(nullif(input->>'course',''),'SCY');
  chosen_age integer:=nullif(input->>'ageAtSwim','')::integer;
  start_year text:=nullif(input->>'startYear','');
  end_year text:=nullif(input->>'endYear','');
  today date:=(current_timestamp at time zone 'America/Los_Angeles')::date;
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
  ), rank_candidates as materialized (
    select c.*,s.times_gender as gender from public.ies_times_candidates(jsonb_build_object(
      'team','velocity-swimming','course',chosen_course,
      'ageGroups',jsonb_build_array(coalesce((select age_group from latest),'unknown'))
    )) c join public.public_swims s on s.id=c.id
  ), rank_bests as (
    select distinct on (event,gender,athlete_id) * from rank_candidates
    where gender in ('F','M','X') order by event,gender,athlete_id,time,date desc,id
  ), ranked as (
    select b.*,rank() over(partition by event,gender order by time) as position,
      count(*) over(partition by event,gender) as cohort_count
    from rank_bests b
  ), own_rank as (
    select distinct on (event) * from ranked where athlete_id=chosen_athlete
    order by event,time,date desc,id
  )
  select jsonb_build_object('myTimes',jsonb_build_object(
    'period','all','athleteId',chosen_athlete,
    'ages',coalesce((select jsonb_agg(age order by age) from (select distinct age from course_swims where age is not null) a),'[]'),
    'years',coalesce((select jsonb_agg(year order by year desc) from (select distinct left(date,4) as year from course_swims) y),'[]'),
    'latestAge',(select age from latest),'latestAgeGroup',(select age_group from latest),
    'events',coalesce((select jsonb_agg(jsonb_build_object(
      'event',e.event,'race',case when b.id is not null then public.ies_times_json_id(b.id) end,
      'rankRace',case when s.id is not null then public.ies_times_json_id(s.id) end,
      'allTimeRank',s.position,'allTimeCount',coalesce(s.cohort_count,0),
      'rankAgeGroup',case when s.id is not null then (select age_group from latest) end,'rankGender',s.gender
    ) order by e.event) from events e left join bests b using(event) left join own_rank s using(event)),'[]')
  )) into answer;
  return answer;
end $$;
revoke all on function public.ies_my_times_all_time(jsonb) from public;
grant execute on function public.ies_my_times_all_time(jsonb) to anon,authenticated,service_role;
comment on function public.ies_my_times_all_time(jsonb) is
  'Velocity personal bests by exact age/calendar years, plus complete all-time team ranks in the latest recorded age group. Public projections only.';

NOTIFY pgrst, 'reload schema';
