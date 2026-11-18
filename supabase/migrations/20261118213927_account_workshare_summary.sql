-- Account holders can read their own totals without gaining roster or ticket access.
-- Resolve the current verified email inside the database; never accept an email
-- or account identifier from the browser as evidence of account ownership.
create function private.read_my_workshare_summary(season_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  account_email text;
  selected_season uuid := season_id;
  today date := (current_timestamp at time zone 'America/Los_Angeles')::date;
  season_list jsonb;
  account_list jsonb;
begin
  select lower(btrim(u.email)) into account_email
    from auth.users u where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and not coalesce(u.is_anonymous, false);
  if account_email is null then
    raise insufficient_privilege using message = 'A verified sign-in email is required.';
  end if;

  if selected_season is not null then
    if not exists(select 1 from public.workshare_seasons s where s.id = selected_season) then
      raise no_data_found using message = 'Season no longer exists.';
    end if;
  else
    select s.id into selected_season from public.workshare_seasons s
      order by
        case when today between s.starts_on and s.ends_on then 0
          when s.starts_on <= today then 1 else 2 end,
        case when s.starts_on <= today then s.starts_on end desc,
        s.starts_on asc, s.id
      limit 1;
  end if;

  select coalesce(jsonb_agg(private.workshare_season_json(s) order by s.starts_on desc, s.id), '[]'::jsonb)
    into season_list from public.workshare_seasons s;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'fullName', a.full_name, 'isArchived', a.is_archived,
    'requirements', jsonb_build_object(
      'generalHoursRequired', case when selected_season is null then a.general_hours_required else r.general_hours_required end,
      'starlightHoursRequired', case when selected_season is null then a.starlight_hours_required else r.starlight_hours_required end,
      'appleCapitalHoursRequired', case when selected_season is null then a.apple_capital_hours_required else r.apple_capital_hours_required end),
    'completed', jsonb_build_object(
      'general', coalesce(t.general, 0), 'starlight', coalesce(t.starlight, 0),
      'appleCapital', coalesce(t.apple_capital, 0))
    ) order by a.full_name, a.id), '[]'::jsonb)
    into account_list
    from public.workshare_accounts a
    left join public.workshare_account_requirements r
      on r.account_id = a.id and r.season_id = selected_season
    left join lateral (
      select sum(t.hours) filter(where t.category = 'general') as general,
        sum(t.hours) filter(where t.category = 'starlight') as starlight,
        sum(t.hours) filter(where t.category = 'apple_capital') as apple_capital
      from public.workshare_tickets t
      where t.account_id = a.id and t.season_id = selected_season
    ) t on true
    where exists(select 1 from public.workshare_account_emails e
      where e.account_id = a.id and e.email = account_email);

  return jsonb_build_object('seasons', season_list, 'seasonId', selected_season, 'accounts', account_list);
end;
$$;

create function public.read_my_workshare_summary(season_id uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.read_my_workshare_summary(season_id);
$$;

revoke all on function private.read_my_workshare_summary(uuid), public.read_my_workshare_summary(uuid) from public, anon;
grant execute on function private.read_my_workshare_summary(uuid), public.read_my_workshare_summary(uuid) to authenticated;
notify pgrst, 'reload schema';
