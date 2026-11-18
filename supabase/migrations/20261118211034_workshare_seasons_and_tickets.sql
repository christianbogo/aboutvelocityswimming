-- Season requirements and completed tickets have independent versions. Legacy
-- account quotas are adopted once and never used as a hidden active season.
create table public.workshare_seasons (
  id uuid primary key,
  name text not null check (name = btrim(name) and length(name) between 1 and 100),
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  copy_from_season_id uuid references public.workshare_seasons(id),
  created_at timestamptz not null default clock_timestamp(),
  exclude using gist (daterange(starts_on, ends_on, '[]') with &&)
);
create index workshare_seasons_copy_from_idx on public.workshare_seasons(copy_from_season_id);

create table public.workshare_account_requirements (
  account_id text not null references public.workshare_accounts(id) on delete cascade,
  season_id uuid not null references public.workshare_seasons(id),
  general_hours_required numeric check (general_hours_required between 0 and 10000 and general_hours_required = round(general_hours_required, 2)),
  starlight_hours_required numeric check (starlight_hours_required between 0 and 10000 and starlight_hours_required = round(starlight_hours_required, 2)),
  apple_capital_hours_required numeric check (apple_capital_hours_required between 0 and 10000 and apple_capital_hours_required = round(apple_capital_hours_required, 2)),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (season_id, account_id)
);
create index workshare_requirements_account_idx on public.workshare_account_requirements(account_id);

-- These keys survive deletion. A delayed POST can never recreate an undone
-- ticket. Only a creation fingerprint is retained, rather than revision history.
create table public.workshare_ticket_create_keys (
  id uuid primary key,
  payload_fingerprint text not null check (length(payload_fingerprint) = 64)
);
create table public.workshare_tickets (
  id uuid primary key references public.workshare_ticket_create_keys(id),
  account_id text not null references public.workshare_accounts(id) on delete cascade,
  season_id uuid not null references public.workshare_seasons(id),
  completed_on date not null,
  description text not null check (description = btrim(description) and length(description) between 1 and 500),
  category text not null check (category in ('general', 'starlight', 'apple_capital')),
  hours numeric not null check (hours > 0 and hours <= 10000 and hours = round(hours, 2)),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index workshare_tickets_totals_idx on public.workshare_tickets(season_id, account_id, category);
create index workshare_tickets_date_idx on public.workshare_tickets(season_id, completed_on desc, id);
create index workshare_tickets_account_idx on public.workshare_tickets(account_id);

alter table public.workshare_seasons enable row level security;
alter table public.workshare_account_requirements enable row level security;
alter table public.workshare_ticket_create_keys enable row level security;
alter table public.workshare_tickets enable row level security;
create policy workshare_seasons_staff on public.workshare_seasons for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy workshare_requirements_staff on public.workshare_account_requirements for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy workshare_ticket_keys_staff on public.workshare_ticket_create_keys for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy workshare_tickets_staff on public.workshare_tickets for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
revoke all on public.workshare_seasons, public.workshare_account_requirements,
  public.workshare_ticket_create_keys, public.workshare_tickets from anon;
grant select, insert, update, delete on public.workshare_seasons, public.workshare_account_requirements,
  public.workshare_ticket_create_keys, public.workshare_tickets to authenticated, service_role;
revoke update, delete on public.workshare_ticket_create_keys from authenticated;

create function private.workshare_require_staff() returns void language plpgsql
security invoker set search_path = '' as $$
begin
  if current_user not in ('postgres', 'service_role') and not private.is_staff() then
    raise insufficient_privilege using message = 'Staff access is required';
  end if;
end;
$$;

create function private.workshare_legacy_quota_guard() returns trigger language plpgsql
security invoker set search_path = '' as $$
begin
  if exists(select 1 from public.workshare_seasons) and (
    (tg_op = 'INSERT' and (new.current_season is not null or new.general_hours_required is not null
      or new.starlight_hours_required is not null or new.apple_capital_hours_required is not null))
    or (tg_op = 'UPDATE' and row(new.current_season, new.general_hours_required, new.starlight_hours_required, new.apple_capital_hours_required)
      is distinct from row(old.current_season, old.general_hours_required, old.starlight_hours_required, old.apple_capital_hours_required))
  ) then
    raise invalid_parameter_value using message = 'Legacy hour requirements are frozen. Select a season to edit its requirements.';
  end if;
  return new;
end;
$$;
create trigger workshare_legacy_quota_guard before insert or update on public.workshare_accounts
  for each row execute function private.workshare_legacy_quota_guard();
create trigger workshare_requirements_version before update on public.workshare_account_requirements
  for each row execute function private.workshare_account_version();

create function private.workshare_season_guard() returns trigger language plpgsql
security invoker set search_path = '' as $$
begin
  if new is distinct from old then
    raise feature_not_supported using message = 'Seasons cannot be changed after creation';
  end if;
  return new;
end;
$$;
create trigger workshare_season_guard before update on public.workshare_seasons
  for each row execute function private.workshare_season_guard();

create function private.workshare_ticket_guard() returns trigger language plpgsql
security invoker set search_path = '' as $$
declare season public.workshare_seasons;
begin
  if tg_op = 'UPDATE' then
    if row(new.id,new.account_id,new.season_id,new.created_at) is distinct from row(old.id,old.account_id,old.season_id,old.created_at) then
      raise invalid_parameter_value using message = 'A ticket account and season cannot be changed';
    end if;
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  end if;
  select * into season from public.workshare_seasons where id = new.season_id;
  if not found or new.completed_on not between season.starts_on and season.ends_on then
    raise check_violation using message = 'Ticket date must be within the selected season';
  end if;
  return new;
end;
$$;
create trigger workshare_ticket_guard before insert or update on public.workshare_tickets
  for each row execute function private.workshare_ticket_guard();

create function private.workshare_season_json(season public.workshare_seasons) returns jsonb language sql immutable
security invoker set search_path = '' as $$
  select jsonb_build_object('id',season.id,'name',season.name,'startsOn',season.starts_on,'endsOn',season.ends_on);
$$;
create function private.workshare_requirements_snapshot(account_id text, season_id uuid) returns jsonb language sql stable
security invoker set search_path = '' as $$
  select jsonb_build_object('accountId',$1,'seasonId',$2,
    'generalHoursRequired',r.general_hours_required,'starlightHoursRequired',r.starlight_hours_required,
    'appleCapitalHoursRequired',r.apple_capital_hours_required,'updatedAt',r.updated_at)
  from (select 1) seed left join public.workshare_account_requirements r on r.account_id=$1 and r.season_id=$2;
$$;
create function private.workshare_ticket_json(ticket public.workshare_tickets) returns jsonb language sql immutable
security invoker set search_path = '' as $$
  select jsonb_build_object('id',ticket.id,'accountId',ticket.account_id,'seasonId',ticket.season_id,
    'completedOn',ticket.completed_on,'description',ticket.description,'category',ticket.category,
    'hours',ticket.hours,'createdAt',ticket.created_at,'updatedAt',ticket.updated_at);
$$;

create function public.list_workshare_seasons() returns jsonb language plpgsql stable
security invoker set search_path = '' as $$
begin
  perform private.workshare_require_staff();
  return coalesce((select jsonb_agg(private.workshare_season_json(s) order by s.starts_on desc,s.id) from public.workshare_seasons s),'[]');
end;
$$;
create function public.create_workshare_season(input jsonb) returns jsonb language plpgsql
security invoker set search_path = '' as $$
declare existing public.workshare_seasons; created public.workshare_seasons; source_id uuid;
begin
  perform private.workshare_require_staff();
  if jsonb_typeof(input) is distinct from 'object' or input - array['id','name','startsOn','endsOn','copyFromSeasonId'] <> '{}'
    or jsonb_typeof(input->'id') is distinct from 'string' or jsonb_typeof(input->'name') is distinct from 'string'
    or length(btrim(input->>'name')) not between 1 and 100
    or jsonb_typeof(input->'startsOn') is distinct from 'string' or input->>'startsOn' !~ '^\d{4}-\d{2}-\d{2}$'
    or jsonb_typeof(input->'endsOn') is distinct from 'string' or input->>'endsOn' !~ '^\d{4}-\d{2}-\d{2}$'
    or not input ? 'copyFromSeasonId' or jsonb_typeof(input->'copyFromSeasonId') not in ('null','string') then
    raise invalid_parameter_value using message = 'Send a season name, date range, ID, and source season';
  end if;
  source_id := (input->>'copyFromSeasonId')::uuid;
  lock table public.workshare_seasons in share row exclusive mode;
  select * into existing from public.workshare_seasons where id = (input->>'id')::uuid;
  if found then
    if row(existing.name,existing.starts_on,existing.ends_on,existing.copy_from_season_id)
      is distinct from row(btrim(input->>'name'),(input->>'startsOn')::date,(input->>'endsOn')::date,source_id) then
      raise unique_violation using message = 'This season creation ID was already used with different details';
    end if;
    return private.workshare_season_json(existing);
  end if;
  if exists(select 1 from public.workshare_seasons) then
    if source_id is null or not exists(select 1 from public.workshare_seasons where id=source_id) then
      raise invalid_parameter_value using message = 'Select a source season to copy requirements';
    end if;
  elsif source_id is not null then
    raise invalid_parameter_value using message = 'The first season adopts the existing account requirements';
  end if;
  -- Account writes cannot race the first adoption snapshot.
  lock table public.workshare_accounts in share row exclusive mode;
  insert into public.workshare_seasons(id,name,starts_on,ends_on,copy_from_season_id)
    values((input->>'id')::uuid,btrim(input->>'name'),(input->>'startsOn')::date,(input->>'endsOn')::date,source_id)
    returning * into created;
  if source_id is null then
    insert into public.workshare_account_requirements(account_id,season_id,general_hours_required,starlight_hours_required,apple_capital_hours_required)
      select id,created.id,general_hours_required,starlight_hours_required,apple_capital_hours_required from public.workshare_accounts;
  else
    insert into public.workshare_account_requirements(account_id,season_id,general_hours_required,starlight_hours_required,apple_capital_hours_required)
      select a.id,created.id,r.general_hours_required,r.starlight_hours_required,r.apple_capital_hours_required
      from public.workshare_accounts a left join public.workshare_account_requirements r on r.account_id=a.id and r.season_id=source_id;
  end if;
  return private.workshare_season_json(created);
end;
$$;

create function public.list_workshare_account_summaries(season_id uuid) returns jsonb language plpgsql stable
security invoker set search_path = '' as $$
begin
  perform private.workshare_require_staff();
  if not exists(select 1 from public.workshare_seasons s where s.id=season_id) then
    raise no_data_found using message = 'Season no longer exists';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('account',private.workshare_account_snapshot(a.id),
    'requirements',private.workshare_requirements_snapshot(a.id,season_id),
    'completed',jsonb_build_object('general',coalesce(t.general,0),'starlight',coalesce(t.starlight,0),'appleCapital',coalesce(t.apple_capital,0)))
    order by a.full_name,a.id)
    from public.workshare_accounts a left join (
      select account_id,sum(hours) filter(where category='general') as general,
        sum(hours) filter(where category='starlight') as starlight,
        sum(hours) filter(where category='apple_capital') as apple_capital
      from public.workshare_tickets t where t.season_id=list_workshare_account_summaries.season_id group by account_id
    ) t on t.account_id=a.id),'[]');
end;
$$;

create function public.save_workshare_requirements(account_id text,input jsonb) returns jsonb language plpgsql
security invoker set search_path = '' as $$
declare season uuid; current_version timestamptz; field text;
begin
  perform private.workshare_require_staff();
  if jsonb_typeof(input) is distinct from 'object' or input - array['seasonId','updatedAt','generalHoursRequired','starlightHoursRequired','appleCapitalHoursRequired'] <> '{}'
    or jsonb_typeof(input->'seasonId') is distinct from 'string' or not input ? 'updatedAt'
    or jsonb_typeof(input->'updatedAt') not in ('null','string') then
    raise invalid_parameter_value using message = 'Send season requirements and their version';
  end if;
  season := (input->>'seasonId')::uuid;
  foreach field in array array['generalHoursRequired','starlightHoursRequired','appleCapitalHoursRequired'] loop
    if not input ? field or jsonb_typeof(input->field) not in ('null','number') or (jsonb_typeof(input->field)='number' and
      ((input->>field)::numeric not between 0 and 10000 or (input->>field)::numeric <> round((input->>field)::numeric,2))) then
      raise invalid_parameter_value using message = 'Required hours must be blank or between 0 and 10000 with at most two decimal places';
    end if;
  end loop;
  -- Serialize creation of an initially missing requirements row without touching
  -- the account version. The lock is held until this transaction commits.
  perform 1 from public.workshare_accounts a where a.id=account_id for update;
  if not found then raise no_data_found using message = 'Account no longer exists'; end if;
  select r.updated_at into current_version from public.workshare_account_requirements r
    where r.account_id=save_workshare_requirements.account_id and r.season_id=season for update;
  if current_version is distinct from (input->>'updatedAt')::timestamptz then
    raise serialization_failure using message = 'These season requirements changed. Reload before saving.';
  end if;
  insert into public.workshare_account_requirements(account_id,season_id,general_hours_required,starlight_hours_required,apple_capital_hours_required)
    values(account_id,season,(input->>'generalHoursRequired')::numeric,(input->>'starlightHoursRequired')::numeric,(input->>'appleCapitalHoursRequired')::numeric)
    on conflict on constraint workshare_account_requirements_pkey do update set general_hours_required=excluded.general_hours_required,
      starlight_hours_required=excluded.starlight_hours_required,apple_capital_hours_required=excluded.apple_capital_hours_required;
  return private.workshare_requirements_snapshot(account_id,season);
end;
$$;

-- Preserve the legacy RPC and CLI shape. Core-only requests fill the untouched
-- legacy values from the database, never from a selected season's summary.
alter function public.save_workshare_account(jsonb) rename to save_workshare_account_legacy;
alter function public.save_workshare_account_legacy(jsonb) set schema private;
create function public.save_workshare_account(input jsonb) returns jsonb language plpgsql
security invoker set search_path = '' as $$
declare legacy jsonb;
begin
  perform private.workshare_require_staff();
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
  return private.save_workshare_account_legacy(input);
end;
$$;

create function private.workshare_validate_ticket_fields(input jsonb) returns void language plpgsql
security invoker set search_path = '' as $$
begin
  if jsonb_typeof(input->'completedOn') is distinct from 'string' or input->>'completedOn' !~ '^\d{4}-\d{2}-\d{2}$'
    or jsonb_typeof(input->'description') is distinct from 'string' or length(btrim(input->>'description')) not between 1 and 500
    or jsonb_typeof(input->'category') is distinct from 'string' or input->>'category' not in ('general','starlight','apple_capital')
    or jsonb_typeof(input->'hours') is distinct from 'number' or (input->>'hours')::numeric <= 0 or (input->>'hours')::numeric > 10000
    or (input->>'hours')::numeric <> round((input->>'hours')::numeric,2) then
    raise invalid_parameter_value using message = 'A ticket requires a date, description, category and positive hours with at most two decimal places';
  end if;
end;
$$;
create function public.create_workshare_ticket(input jsonb) returns jsonb language plpgsql
security invoker set search_path = '' as $$
declare key_id uuid; fingerprint text; existing_fingerprint text; ticket public.workshare_tickets; inserted boolean;
begin
  perform private.workshare_require_staff();
  if jsonb_typeof(input) is distinct from 'object' or input - array['id','accountId','seasonId','completedOn','description','category','hours'] <> '{}'
    or jsonb_typeof(input->'id') is distinct from 'string' or jsonb_typeof(input->'accountId') is distinct from 'string'
    or length(input->>'accountId') not between 1 and 1500 or jsonb_typeof(input->'seasonId') is distinct from 'string' then
    raise invalid_parameter_value using message = 'Send a ticket creation ID, account and season';
  end if;
  perform private.workshare_validate_ticket_fields(input);
  key_id := (input->>'id')::uuid;
  fingerprint := encode(sha256(convert_to(jsonb_build_object('accountId',input->>'accountId','seasonId',(input->>'seasonId')::uuid,
    'completedOn',(input->>'completedOn')::date,'description',btrim(input->>'description'),
    'category',input->>'category','hours',trim_scale((input->>'hours')::numeric))::text,'UTF8')),'hex');
  insert into public.workshare_ticket_create_keys(id,payload_fingerprint) values(key_id,fingerprint) on conflict do nothing;
  inserted := found;
  select payload_fingerprint into existing_fingerprint from public.workshare_ticket_create_keys where id=key_id;
  if existing_fingerprint <> fingerprint then
    raise unique_violation using message = 'This ticket creation ID was already used with different details';
  end if;
  if not inserted then
    select * into ticket from public.workshare_tickets where id=key_id;
    if not found then raise sqlstate 'P0410' using message = 'This ticket was already deleted and will not be recreated'; end if;
    return private.workshare_ticket_json(ticket);
  end if;
  insert into public.workshare_tickets(id,account_id,season_id,completed_on,description,category,hours)
    values(key_id,input->>'accountId',(input->>'seasonId')::uuid,(input->>'completedOn')::date,btrim(input->>'description'),input->>'category',(input->>'hours')::numeric)
    returning * into ticket;
  return private.workshare_ticket_json(ticket);
end;
$$;
create function public.update_workshare_ticket(ticket_id uuid,input jsonb) returns jsonb language plpgsql
security invoker set search_path = '' as $$
declare ticket public.workshare_tickets;
begin
  perform private.workshare_require_staff();
  if jsonb_typeof(input) is distinct from 'object' or input - array['updatedAt','completedOn','description','category','hours'] <> '{}'
    or jsonb_typeof(input->'updatedAt') is distinct from 'string' then
    raise invalid_parameter_value using message = 'Send editable ticket fields and their version';
  end if;
  perform private.workshare_validate_ticket_fields(input);
  select * into ticket from public.workshare_tickets where id=ticket_id for update;
  if not found then raise no_data_found using message = 'Ticket no longer exists'; end if;
  if ticket.updated_at is distinct from (input->>'updatedAt')::timestamptz then
    raise serialization_failure using message = 'This ticket changed. Reload before saving.';
  end if;
  update public.workshare_tickets set completed_on=(input->>'completedOn')::date,description=btrim(input->>'description'),
    category=input->>'category',hours=(input->>'hours')::numeric where id=ticket_id returning * into ticket;
  return private.workshare_ticket_json(ticket);
end;
$$;
create function public.delete_workshare_ticket(ticket_id uuid,expected_version timestamptz) returns jsonb language plpgsql
security invoker set search_path = '' as $$
declare version timestamptz;
begin
  perform private.workshare_require_staff();
  select updated_at into version from public.workshare_tickets where id=ticket_id for update;
  if not found then return 'null'; end if;
  if version is distinct from expected_version then
    raise serialization_failure using message = 'This ticket changed. Reload before deleting.';
  end if;
  delete from public.workshare_tickets where id=ticket_id;
  return 'null';
end;
$$;
create function public.list_workshare_tickets(input jsonb) returns jsonb language plpgsql stable
security invoker set search_path = '' as $$
declare season uuid; page_number integer; from_date date; to_date date;
begin
  perform private.workshare_require_staff();
  if jsonb_typeof(input) is distinct from 'object' or input - array['seasonId','accountId','category','from','to','q','page'] <> '{}'
    or jsonb_typeof(input->'seasonId') is distinct from 'string' then
    raise invalid_parameter_value using message = 'Select a season for tickets';
  end if;
  season := (input->>'seasonId')::uuid;
  page_number := coalesce((input->>'page')::integer,1);
  from_date := (input->>'from')::date;
  to_date := (input->>'to')::date;
  if page_number not between 1 and 1000000 or (from_date is not null and to_date is not null and from_date > to_date)
    or length(coalesce(input->>'q','')) > 200 or (input ? 'category' and input->>'category' not in ('general','starlight','apple_capital')) then
    raise invalid_parameter_value using message = 'Invalid ticket filters';
  end if;
  if not exists(select 1 from public.workshare_seasons where id=season) then raise no_data_found using message = 'Season no longer exists'; end if;
  return (with filtered as materialized (
    select t.* from public.workshare_tickets t join public.workshare_accounts a on a.id=t.account_id
    where t.season_id=season and (not input ? 'accountId' or t.account_id=input->>'accountId')
      and (not input ? 'category' or t.category=input->>'category')
      and (from_date is null or t.completed_on >= from_date) and (to_date is null or t.completed_on <= to_date)
      and (coalesce(input->>'q','')='' or strpos(lower(t.description || ' ' || a.full_name),lower(input->>'q')) > 0)
  ), paged as (select * from filtered order by completed_on desc,created_at desc,id limit 50 offset (page_number-1)*50)
  select jsonb_build_object('tickets',coalesce((select jsonb_agg(private.workshare_ticket_json(p::public.workshare_tickets) order by p.completed_on desc,p.created_at desc,p.id) from paged p),'[]'),
    'total',(select count(*) from filtered),'page',page_number,'pageSize',50));
end;
$$;

revoke all on function private.workshare_require_staff(),private.workshare_legacy_quota_guard(),private.workshare_season_guard(),private.workshare_ticket_guard(),
  private.workshare_season_json(public.workshare_seasons),private.workshare_requirements_snapshot(text,uuid),
  private.workshare_ticket_json(public.workshare_tickets),private.workshare_validate_ticket_fields(jsonb),private.save_workshare_account_legacy(jsonb) from public,anon;
grant execute on function private.workshare_require_staff(),private.workshare_legacy_quota_guard(),private.workshare_season_guard(),private.workshare_ticket_guard(),
  private.workshare_season_json(public.workshare_seasons),private.workshare_requirements_snapshot(text,uuid),
  private.workshare_ticket_json(public.workshare_tickets),private.workshare_validate_ticket_fields(jsonb),private.save_workshare_account_legacy(jsonb) to authenticated,service_role;
revoke all on function public.list_workshare_seasons(),public.create_workshare_season(jsonb),public.list_workshare_account_summaries(uuid),
  public.save_workshare_requirements(text,jsonb),public.save_workshare_account(jsonb),public.create_workshare_ticket(jsonb),
  public.update_workshare_ticket(uuid,jsonb),public.delete_workshare_ticket(uuid,timestamptz),public.list_workshare_tickets(jsonb) from public,anon;
grant execute on function public.list_workshare_seasons(),public.create_workshare_season(jsonb),public.list_workshare_account_summaries(uuid),
  public.save_workshare_requirements(text,jsonb),public.save_workshare_account(jsonb),public.create_workshare_ticket(jsonb),
  public.update_workshare_ticket(uuid,jsonb),public.delete_workshare_ticket(uuid,timestamptz),public.list_workshare_tickets(jsonb) to authenticated,service_role;

notify pgrst, 'reload schema';
