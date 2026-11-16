-- Resolve the small set of inherited exclusions before scanning a candidate
-- cohort. Otherwise the moderation join needs each candidate's race JSON.
create index public_swims_parent_relay_idx
  on public.public_swims ((data->>'parentRelayResultId'))
  where data ? 'parentRelayResultId';

create or replace view public.unflagged_times_swims with (security_invoker = true) as
with inherited_flags as materialized (
  select child.id
  from public.result_moderation m
  cross join lateral (
    select s.id
    from public.public_swims s
    where s.data ? 'parentRelayResultId'
      and s.data->>'parentRelayResultId' = m.result_id
    -- Keep the indexed lookup driven by the flagged parent relays.
    offset 0
  ) child
  where m.flagged and m.result_type = 'relay'
)
select s.* from public.public_swims s
where not exists (
  select 1 from public.result_moderation m
  where m.flagged and m.result_type = 'swim' and m.result_id = s.id
) and not exists (
  select 1 from inherited_flags f where f.id = s.id
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
  selected_genders text[];
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
    -- Keep the JSON membership rules while using an indexable comparison on
    -- the only values the generated gender column can hold.
    selected_genders := array(
      select g.code from unnest(array['F', 'M', 'X', '']) g(code)
      where input->'genders' ? g.code
    );
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
      and (not (input ? 'genders') or s.times_gender = any(selected_genders))
      -- The outer bounds work with the age index. Exact membership still
      -- excludes gaps between selected groups and returns each swim once.
      and (not age_filter or (
        s.times_age >= lower(age_bounds)
        and (upper_inf(age_bounds) or s.times_age < upper(age_bounds))
        and age_ranges @> s.times_age
      ));
  end if;
end $$;
