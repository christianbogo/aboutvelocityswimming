-- Rankings needs the calendar years represented in the published results.
-- Include every result status and course, just as the full facets query does.
create function public.ies_times_ranking_years(input jsonb default '{}') returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('years', coalesce(jsonb_agg(year order by year desc), '[]'::jsonb))
  from (
    -- The swim projection includes legacy whole relays and relay splits.
    select left(s.swim_date, 4) as year
    from public.public_swims s
    join public.public_times_teams t on t.id = s.times_team
    where s.times_team = 'velocity-swimming'
    union
    select left(r.swim_date, 4) as year
    from public.public_relay_results r
    join public.public_times_teams t on t.id = r.team_id
    where r.team_id = 'velocity-swimming'
  ) published_years;
$$;

revoke all on function public.ies_times_ranking_years(jsonb) from public;
grant execute on function public.ies_times_ranking_years(jsonb) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
