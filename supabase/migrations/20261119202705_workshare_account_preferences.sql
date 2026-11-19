-- Account-wide workshare policy and a note visible only to associated accounts.
alter table public.workshare_accounts
  add column require_workshare boolean not null default true,
  add column workshare_note text not null default '' check (length(workshare_note) <= 2000);

create or replace function private.workshare_account_snapshot(account_id text) returns jsonb language sql stable
security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', a.id, 'fullName', a.full_name, 'isArchived', a.is_archived,
    'requireWorkshare', a.require_workshare, 'workshareNote', a.workshare_note,
    'currentSeason', a.current_season,
    'generalHoursRequired', a.general_hours_required,
    'starlightHoursRequired', a.starlight_hours_required,
    'appleCapitalHoursRequired', a.apple_capital_hours_required,
    'updatedAt', a.updated_at,
    'emails', coalesce((select jsonb_agg(e.email order by e.email) from public.workshare_account_emails e where e.account_id = a.id), '[]'::jsonb),
    'athletes', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'fullName', r.full_name, 'trainingGroup', r.training_group,
      'timesAthleteId', r.times_athlete_id, 'isArchived', r.is_archived
    ) order by r.full_name, r.id) from public.workshare_athletes r where r.account_id = a.id), '[]'::jsonb)
  ) from public.workshare_accounts a where a.id = account_id;
$$;

create or replace function public.save_workshare_account(input jsonb) returns jsonb language plpgsql
security invoker set search_path = '' as $$
declare legacy jsonb; saved_account jsonb; preferences jsonb;
begin
  perform private.workshare_require_staff();
  if input ? 'requireWorkshare' and jsonb_typeof(input->'requireWorkshare') is distinct from 'boolean' then
    raise check_violation using message = 'Require Workshare must be true or false';
  end if;
  if input ? 'workshareNote' and (jsonb_typeof(input->'workshareNote') is distinct from 'string'
      or length(btrim(input->>'workshareNote')) > 2000) then
    raise check_violation using message = 'Note to Account must be text of at most 2000 characters';
  end if;
  preferences := input;
  input := input - array['requireWorkshare', 'workshareNote'];
  if not input ?| array['currentSeason','generalHoursRequired','starlightHoursRequired','appleCapitalHoursRequired'] then
    if input ? 'id' then
      select private.workshare_account_snapshot(a.id) into legacy from public.workshare_accounts a where a.id=input->>'id' for update;
      if not found then raise no_data_found using message = 'Account no longer exists'; end if;
    else
      legacy := '{"currentSeason":null,"generalHoursRequired":null,"starlightHoursRequired":null,"appleCapitalHoursRequired":null}';
    end if;
    input := input || jsonb_build_object('currentSeason',legacy->'currentSeason','generalHoursRequired',legacy->'generalHoursRequired',
      'starlightHoursRequired',legacy->'starlightHoursRequired','appleCapitalHoursRequired',legacy->'appleCapitalHoursRequired');
  end if;
  saved_account := private.save_workshare_account_legacy(input);
  -- Omitted fields from older clients preserve existing values; new rows use defaults.
  if preferences ?| array['requireWorkshare', 'workshareNote'] then
    update public.workshare_accounts a set
      require_workshare = case when preferences ? 'requireWorkshare' then (preferences->>'requireWorkshare')::boolean else a.require_workshare end,
      workshare_note = case when preferences ? 'workshareNote' then btrim(preferences->>'workshareNote') else a.workshare_note end
      where a.id = saved_account->>'id';
  end if;
  return private.workshare_account_snapshot(saved_account->>'id');
end;
$$;

create or replace function private.read_my_workshare_summary(season_id uuid default null)
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
    'requireWorkshare', a.require_workshare, 'workshareNote', a.workshare_note,
    'emails', coalesce((select jsonb_agg(e.email order by e.email)
      from public.workshare_account_emails e where e.account_id = a.id), '[]'::jsonb),
    'athletes', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'fullName', r.full_name, 'trainingGroup', r.training_group,
      'isArchived', r.is_archived
    ) order by r.full_name, r.id) from public.workshare_athletes r
      where r.account_id = a.id), '[]'::jsonb),
    'requirements', jsonb_build_object(
      'generalHoursRequired', case when not a.require_workshare then 0 when selected_season is null then a.general_hours_required else r.general_hours_required end,
      'starlightHoursRequired', case when not a.require_workshare then 0 when selected_season is null then a.starlight_hours_required else r.starlight_hours_required end,
      'appleCapitalHoursRequired', case when not a.require_workshare then 0 when selected_season is null then a.apple_capital_hours_required else r.apple_capital_hours_required end),
    'completed', jsonb_build_object(
      'general', coalesce(t.general, 0), 'starlight', coalesce(t.starlight, 0),
      'appleCapital', coalesce(t.apple_capital, 0)),
    'tickets', coalesce(t.tickets, '[]'::jsonb)
    ) order by a.full_name, a.id), '[]'::jsonb)
    into account_list
    from public.workshare_accounts a
    left join public.workshare_account_requirements r
      on r.account_id = a.id and r.season_id = selected_season
    left join lateral (
      select sum(t.hours) filter(where t.category = 'general') as general,
        sum(t.hours) filter(where t.category = 'starlight') as starlight,
        sum(t.hours) filter(where t.category = 'apple_capital') as apple_capital,
        jsonb_agg(jsonb_build_object(
          'id', t.id, 'completedOn', t.completed_on,
          'description', t.description, 'category', t.category, 'hours', t.hours
        ) order by t.completed_on desc, t.id desc) as tickets
      from public.workshare_tickets t
      where t.account_id = a.id and t.season_id = selected_season
    ) t on true
    where exists(select 1 from public.workshare_account_emails e
      where e.account_id = a.id and e.email = account_email);

  return jsonb_build_object('seasons', season_list, 'seasonId', selected_season, 'accounts', account_list);
end;
$$;

notify pgrst, 'reload schema';
