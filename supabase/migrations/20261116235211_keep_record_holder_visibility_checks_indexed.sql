-- Use a single indexed lookup for each stored winner. The projections have
-- unique result IDs, so a scalar subquery has the same visibility rule as
-- EXISTS without allowing the planner to hash the entire public swim archive.
alter policy public_read on public.team_record_holders
using (
  exists (select 1 from public.public_times_teams t where t.id = team_record_holders.team)
  and case when result_type = 'relay' then
    (select true from public.public_relay_results r where r.id = team_record_holders.result_id) is true
  else
    (select true
      from public.public_swims s
      join public.public_athletes a on a.id = s.athlete_id
      where s.id = team_record_holders.result_id) is true
  end
);
