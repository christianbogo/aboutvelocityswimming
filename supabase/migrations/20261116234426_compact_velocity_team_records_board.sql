-- Read the current projections for stored winners in one statement. The
-- legacy Records response continues to return full race details for callers.
create function public.ies_team_records_board(input jsonb default '{}') returns jsonb
language sql stable security invoker set search_path = '' as $$
  with selected as materialized (
    select h.*
    from public.team_record_holders h
    where h.team = coalesce(nullif(input->>'team', ''), 'velocity-swimming')
      and exists (select 1 from public.public_times_teams t where t.id = h.team)
  ), winner_ids as materialized (
    select distinct result_type, result_id from selected
  ), excluded_swims as materialized (
    select m.result_id
    from public.result_moderation m
    where m.flagged and m.result_type = 'swim'
    union
    select child.id
    from public.result_moderation m
    cross join lateral (
      select s.id
      from public.public_swims s
      where s.data ? 'parentRelayResultId'
        and s.data->>'parentRelayResultId' = m.result_id
      offset 0
    ) child
    where m.flagged and m.result_type = 'relay'
  ), hydrated as materialized (
    select i.result_type, i.result_id,
      s.times_team as team, s.times_course as course, s.times_event as event,
      s.times_gender as gender, case when s.times_relay then '' else s.athlete_id end as athlete_id,
      s.swim_date, s.times_time as time_ms, s.times_relay as relay, s.times_age as age,
      s.times_official as official, s.times_meet as meet_id, s.times_meet_name as meet,
      s.athlete_name, s.data
    from winner_ids i
    cross join lateral (
      -- Keep the lookup keyed by the winner's primary key even if the planner
      -- estimates that joining the wider public projection would be cheaper.
      select p.*, coalesce(nullif(trim(coalesce(a.data#>>'{name,first}', '')||' '||
        coalesce(a.data#>>'{name,last}', '')), ''), p.athlete_id) as athlete_name
      from public.public_swims p
      join public.public_athletes a on a.id = p.athlete_id
      where p.id = i.result_id and p.times_status = 'OK' and p.times_time > 0
        and p.times_leg is null and not p.times_split
      offset 0
    ) s
    where i.result_type = 'swim'
      and not exists (select 1 from excluded_swims e where e.result_id = i.result_id)
    union all
    select i.result_type, i.result_id,
      s.team_id, s.times_course, s.times_event, s.data->>'gender', '', s.swim_date,
      s.times_time, true, null::integer,
      case when jsonb_typeof(s.data->'isOfficial') = 'boolean' then (s.data->>'isOfficial')::boolean end,
      s.times_meet, coalesce(nullif(s.data#>>'{meet,name}', ''), 'Unnamed meet'), '', s.data
    from winner_ids i
    cross join lateral (
      select p.*
      from public.public_relay_results p
      where p.id = i.result_id and p.data->>'status' = 'OK' and p.times_time > 0
      offset 0
    ) s
    where i.result_type = 'relay'
      and not exists (
        select 1 from public.result_moderation m
        where m.flagged and m.result_type = 'relay' and m.result_id = i.result_id
      )
  ), current_holders as materialized (
    select h.*
    from selected h
    join hydrated r using (result_type, result_id)
    where r.team = h.team and r.course = h.course and r.event = h.event
      and r.gender = h.gender and r.athlete_id = h.athlete_id and r.swim_date = h.swim_date
      and r.time_ms = h.time_ms and r.relay = h.relay
      and (h.relay or r.age is not distinct from h.age)
      and (not h.relay or coalesce(r.data->>'ageGroup', '') = h.relay_age)
  ), cells as (
    select course||':'||age_group||':'||event||':'||gender as key,
      jsonb_agg(result_id order by swim_date, athlete_id, result_id) as holders
    from current_holders
    group by course, age_group, event, gender
  ), board_races as (
    select r.course, r.event, r.gender, r.swim_date, r.result_id,
      jsonb_build_object(
        'id', r.result_id, 'resultType', r.result_type, 'athleteId', r.athlete_id,
        'athleteName', r.athlete_name, 'date', r.swim_date, 'event', r.event, 'course', r.course,
        'time', r.time_ms, 'status', 'OK', 'round', coalesce(r.data->>'round', ''),
        'team', r.team, 'teamName', coalesce(r.data->>'teamName', ''), 'gender', r.gender,
        'ageAtSwim', r.age, 'official', r.official, 'relay', r.relay, 'relayLeg', null,
        'relayName', coalesce(r.data#>>'{relay,teamName}', ''),
        'relayAgeGroup', coalesce(r.data->>'ageGroup', ''), 'split', false,
        'meetId', r.meet_id, 'meet', r.meet, 'moderationStatus', 'clear',
        'moderationInherited', false, 'calculationEligible', true
      ) || jsonb_strip_nulls(jsonb_build_object(
        'members', case when jsonb_typeof(r.data->'members') = 'array' then (
          select coalesce(jsonb_agg(jsonb_build_object('leg', m.member->'leg', 'name', m.member->'name')
            order by m.member_order), '[]')
          from jsonb_array_elements(r.data->'members') with ordinality m(member, member_order)
        ) end,
        'lineupCoverage', r.data->'lineupCoverage', 'resultOrigin', r.data->'resultOrigin'
      )) as race
    from hydrated r
    where exists (
      select 1 from current_holders h
      where h.result_type = r.result_type and h.result_id = r.result_id
    )
  )
  select jsonb_build_object(
    'records', coalesce((select jsonb_object_agg(key, holders) from cells), '{}'),
    'races', coalesce((select jsonb_agg(race order by course, event, gender, swim_date, result_id)
      from board_races), '[]'),
    'recordsUpdatedAt', (select refreshed_at from public.team_record_refresh_state where id)
  );
$$;

revoke all on function public.ies_team_records_board(jsonb) from public;
grant execute on function public.ies_team_records_board(jsonb) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
