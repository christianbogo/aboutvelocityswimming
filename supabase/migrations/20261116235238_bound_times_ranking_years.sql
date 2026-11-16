-- Index the published year expression itself. Comparing full dates with an
-- extracted prefix can skip distinct legacy prefixes under locale collations.
create index public_times_ranking_year_idx
  on public.public_swims ((left(swim_date, 4)) desc) include (swim_date)
  where times_team = 'velocity-swimming';

create index public_relay_results_ranking_year_idx
  on public.public_relay_results ((left(swim_date, 4)) desc) include (swim_date)
  where team_id = 'velocity-swimming';

create or replace function public.ies_times_ranking_years(input jsonb default '{}') returns jsonb
language sql stable security invoker set search_path = '' as $$
  with recursive swim_years(year) as (
    (
      select left(s.swim_date, 4)
      from public.public_swims s
      where s.times_team = 'velocity-swimming'
      order by 1 desc limit 1
    )
    union all
    select earlier.next_year
    from swim_years previous
    cross join lateral (
      select left(s.swim_date, 4) as next_year
      from public.public_swims s
      where s.times_team = 'velocity-swimming'
        and left(s.swim_date, 4) < previous.year
      order by next_year desc limit 1
    ) earlier
  ), relay_years(year) as (
    (
      select left(r.swim_date, 4)
      from public.public_relay_results r
      where r.team_id = 'velocity-swimming'
      order by 1 desc limit 1
    )
    union all
    select earlier.next_year
    from relay_years previous
    cross join lateral (
      select left(r.swim_date, 4) as next_year
      from public.public_relay_results r
      where r.team_id = 'velocity-swimming'
        and left(r.swim_date, 4) < previous.year
      order by next_year desc limit 1
    ) earlier
  )
  select jsonb_build_object('years', coalesce(jsonb_agg(year order by year desc), '[]'::jsonb))
  from (select year from swim_years union select year from relay_years) published_years
  where exists (select 1 from public.public_times_teams where id = 'velocity-swimming');
$$;
