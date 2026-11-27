-- Expose only competitive roster names, groups and explicit Times links.
-- Account contacts and registration details remain behind staff RLS.
create function private.team_competitive_roster()
returns table(id text, name text, "group" text, "athleteId" text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from auth.users u where u.id = auth.uid()
    and u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false)) then
    raise exception 'Verified sign-in required' using errcode = '42501';
  end if;
  return query select r.id, r.full_name, r.training_group, r.times_athlete_id
    from public.workshare_athletes r
    join public.workshare_accounts a on a.id = r.account_id
    where not r.is_archived and not a.is_archived
      and r.training_group in ('Prep', 'Age Groupers', 'Juniors', 'Seniors')
    order by r.full_name, r.id;
end $$;
revoke all on function private.team_competitive_roster() from public, anon;
grant execute on function private.team_competitive_roster() to authenticated;

create function public.team_dashboard(selected_meet text default null) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare answer jsonb;
begin
  if length(selected_meet) > 1500 then raise exception 'Invalid meet'; end if;
  with roster as materialized (select * from private.team_competitive_roster()),
  history as materialized (
    select s.id, s.athlete_id, s.swim_date, s.times_event, s.times_course,
      s.times_time, s.times_status, s.times_meet, s.times_meet_name
    from public.unflagged_times_swims s
    join public.public_athletes a on a.id = s.athlete_id
    where s.times_team = 'velocity-swimming' and not s.times_relay
      and s.times_leg is null and not s.times_split
      and s.swim_date < (((current_timestamp at time zone 'America/Los_Angeles')::date + 1)::text)
  ), meets as materialized (
    select times_meet as id, max(times_meet_name) as name,
      min(left(swim_date,10)) as start, max(left(swim_date,10)) as date
    from history where nullif(times_meet,'') is not null group by times_meet
  ), chosen as (
    select * from meets where selected_meet is null or id = selected_meet
    order by date desc, id limit 1
  ), meet_swims as materialized (
    select h.* from history h join chosen m on h.times_meet = m.id
  ), bests as (
    select distinct on (h.athlete_id, h.times_event, h.times_course) h.id
    from history h where h.times_status = 'OK' and h.times_time > 0
      and exists (select 1 from roster r where r."athleteId" = h.athlete_id)
    order by h.athlete_id, h.times_event, h.times_course, h.times_time, h.swim_date desc, h.id
  ), before_bests as (
    select distinct on (h.athlete_id, h.times_event, h.times_course) h.id
    from history h where h.times_status = 'OK' and h.times_time > 0
      and h.swim_date < (select start from chosen)
      and exists (select 1 from meet_swims m where m.athlete_id = h.athlete_id)
    order by h.athlete_id, h.times_event, h.times_course, h.times_time, h.swim_date desc, h.id
  ), hydrated as materialized (
    select * from private.ies_times_json_ids(array(
      select id from bests union select id from before_bests union select id from meet_swims
    ))
  )
  select jsonb_build_object(
    'roster', coalesce((select jsonb_agg(to_jsonb(r)) from roster r), '[]'),
    'bests', coalesce((select jsonb_agg(h.race) from bests b join hydrated h using(id)), '[]'),
    'meets', coalesce((select jsonb_agg(to_jsonb(m) order by m.date desc, m.id) from meets m), '[]'),
    'meet', (select to_jsonb(m) from chosen m),
    'before', coalesce((select jsonb_agg(h.race) from before_bests b join hydrated h using(id)), '[]'),
    'swims', coalesce((select jsonb_agg(h.race order by m.swim_date, m.id) from meet_swims m join hydrated h using(id)), '[]')
  ) into answer;
  return answer;
end $$;
revoke all on function public.team_dashboard(text) from public, anon;
grant execute on function public.team_dashboard(text) to authenticated;
notify pgrst, 'reload schema';
