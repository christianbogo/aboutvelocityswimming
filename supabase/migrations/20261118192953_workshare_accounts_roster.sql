-- Registration accounts are separate from sign-in profiles and Times athletes.
-- Legacy volunteer shifts and totals are deliberately not copied into this schema.
create table public.workshare_accounts (
  id text primary key default gen_random_uuid()::text check (length(id) between 1 and 1500),
  full_name text not null check (full_name = btrim(full_name) and length(full_name) between 1 and 200),
  is_archived boolean not null default false,
  current_season text check (current_season = btrim(current_season) and length(current_season) between 1 and 100),
  general_hours_required numeric check (general_hours_required between 0 and 10000 and general_hours_required = round(general_hours_required, 2)),
  starlight_hours_required numeric check (starlight_hours_required between 0 and 10000 and starlight_hours_required = round(starlight_hours_required, 2)),
  apple_capital_hours_required numeric check (apple_capital_hours_required between 0 and 10000 and apple_capital_hours_required = round(apple_capital_hours_required, 2)),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.workshare_account_emails (
  account_id text not null references public.workshare_accounts(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  primary key (account_id, email)
);

create index workshare_account_emails_email_idx on public.workshare_account_emails(email);

create table public.workshare_athletes (
  id text primary key default gen_random_uuid()::text check (length(id) between 1 and 1500),
  account_id text not null references public.workshare_accounts(id) on delete cascade,
  full_name text not null check (full_name = btrim(full_name) and length(full_name) between 1 and 200),
  training_group text not null default '' check (training_group = btrim(training_group) and length(training_group) <= 100),
  times_athlete_id text references public.athletes(id),
  is_archived boolean not null default false
);

create index workshare_athletes_account_idx on public.workshare_athletes(account_id);
create index workshare_athletes_times_idx on public.workshare_athletes(times_athlete_id) where times_athlete_id is not null;

alter table public.workshare_accounts enable row level security;
alter table public.workshare_account_emails enable row level security;
alter table public.workshare_athletes enable row level security;

create policy workshare_accounts_staff on public.workshare_accounts for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy workshare_account_emails_staff on public.workshare_account_emails for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy workshare_athletes_staff on public.workshare_athletes for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

revoke all on public.workshare_accounts, public.workshare_account_emails, public.workshare_athletes from anon;
grant select, insert, update, delete on public.workshare_accounts, public.workshare_account_emails, public.workshare_athletes to authenticated, service_role;

-- Direct table edits, including AI-assisted SQL changes, invalidate stale editors.
create function private.workshare_account_version() returns trigger language plpgsql
security invoker set search_path = '' as $$
begin
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;

create trigger workshare_account_version before update on public.workshare_accounts
  for each row execute function private.workshare_account_version();

create function private.workshare_child_version() returns trigger language plpgsql
security invoker set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.workshare_accounts set updated_at = clock_timestamp() where id = old.account_id;
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.account_id is distinct from old.account_id) then
    update public.workshare_accounts set updated_at = clock_timestamp() where id = new.account_id;
  end if;
  return null;
end;
$$;

create trigger workshare_email_version after insert or update or delete on public.workshare_account_emails
  for each row execute function private.workshare_child_version();
create trigger workshare_athlete_version after insert or update or delete on public.workshare_athletes
  for each row execute function private.workshare_child_version();

create function private.workshare_account_snapshot(account_id text) returns jsonb language sql stable
security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', a.id, 'fullName', a.full_name, 'isArchived', a.is_archived,
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

create function public.list_workshare_accounts() returns jsonb language plpgsql stable
security invoker set search_path = '' as $$
begin
  if current_user not in ('postgres', 'service_role') and not private.is_staff() then
    raise insufficient_privilege using message = 'Administrator access required';
  end if;
  return coalesce((select jsonb_agg(private.workshare_account_snapshot(a.id) order by a.full_name, a.id)
    from public.workshare_accounts a), '[]'::jsonb);
end;
$$;

create function public.save_workshare_account(input jsonb) returns jsonb language plpgsql
security invoker set search_path = '' as $$
#variable_conflict use_variable
declare
  account_id text;
  account_version timestamptz;
  athlete jsonb;
  athlete_id text;
  kept_ids text[] := array[]::text[];
  key text;
begin
  if current_user not in ('postgres', 'service_role') and not private.is_staff() then
    raise insufficient_privilege using message = 'Administrator access required';
  end if;
  if jsonb_typeof(input) is distinct from 'object' or input - array[
    'id','fullName','emails','athletes','currentSeason','generalHoursRequired',
    'starlightHoursRequired','appleCapitalHoursRequired','isArchived','updatedAt'
  ] <> '{}'::jsonb then
    raise check_violation using message = 'Invalid account fields';
  end if;
  if jsonb_typeof(input->'fullName') is distinct from 'string'
    or length(btrim(input->>'fullName')) not between 1 and 200
    or jsonb_typeof(input->'isArchived') is distinct from 'boolean'
    or jsonb_typeof(input->'emails') is distinct from 'array'
    or jsonb_typeof(input->'athletes') is distinct from 'array' then
    raise check_violation using message = 'Account name, emails, athletes and archive status are required';
  end if;
  if jsonb_array_length(input->'emails') > 100 or jsonb_array_length(input->'athletes') > 100 then
    raise check_violation using message = 'Use at most 100 emails and 100 athletes per account';
  end if;
  if exists(select 1 from jsonb_array_elements(input->'emails') e
    where jsonb_typeof(e) <> 'string' or length(btrim(e#>>'{}')) > 254
      or btrim(e#>>'{}') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise check_violation using message = 'Enter valid account emails';
  end if;
  if not input ? 'currentSeason' or jsonb_typeof(input->'currentSeason') not in ('null', 'string')
    or length(btrim(input->>'currentSeason')) > 100 then
    raise check_violation using message = 'Enter a season of at most 100 characters or null';
  end if;
  foreach key in array array['generalHoursRequired','starlightHoursRequired','appleCapitalHoursRequired'] loop
    if not input ? key or jsonb_typeof(input->key) not in ('null','number') then
      raise check_violation using message = 'Required hours must be a number or null';
    end if;
    if jsonb_typeof(input->key) = 'number' and (
      (input->>key)::numeric not between 0 and 10000
      or (input->>key)::numeric <> round((input->>key)::numeric, 2)
    ) then
      raise check_violation using message = 'Required hours must be between 0 and 10000 with at most two decimal places';
    end if;
  end loop;

  if input ? 'id' then
    if jsonb_typeof(input->'id') is distinct from 'string' or length(input->>'id') not between 1 and 1500
      or jsonb_typeof(input->'updatedAt') is distinct from 'string' or length(input->>'updatedAt') > 100 then
      raise check_violation using message = 'An existing account requires its ID and updatedAt version';
    end if;
    account_id := input->>'id';
    select a.updated_at into account_version from public.workshare_accounts a where a.id = account_id for update;
    if not found then raise no_data_found using message = 'Account no longer exists'; end if;
    if account_version is distinct from (input->>'updatedAt')::timestamptz then
      raise serialization_failure using message = 'This account changed. Reload it before saving.';
    end if;
    update public.workshare_accounts a set full_name = btrim(input->>'fullName'),
      is_archived = (input->>'isArchived')::boolean,
      current_season = nullif(btrim(input->>'currentSeason'), ''),
      general_hours_required = (input->>'generalHoursRequired')::numeric,
      starlight_hours_required = (input->>'starlightHoursRequired')::numeric,
      apple_capital_hours_required = (input->>'appleCapitalHoursRequired')::numeric
      where a.id = account_id;
  else
    if input ? 'updatedAt' then raise check_violation using message = 'New accounts cannot specify a version'; end if;
    insert into public.workshare_accounts(full_name,is_archived,current_season,general_hours_required,starlight_hours_required,apple_capital_hours_required)
    values(btrim(input->>'fullName'),(input->>'isArchived')::boolean,nullif(btrim(input->>'currentSeason'), ''),
      (input->>'generalHoursRequired')::numeric,(input->>'starlightHoursRequired')::numeric,(input->>'appleCapitalHoursRequired')::numeric)
    returning id into account_id;
  end if;

  delete from public.workshare_account_emails e where e.account_id = account_id;
  insert into public.workshare_account_emails(account_id,email)
    select distinct account_id, lower(btrim(e#>>'{}')) from jsonb_array_elements(input->'emails') e;

  for athlete in select value from jsonb_array_elements(input->'athletes') loop
    if jsonb_typeof(athlete) is distinct from 'object' or athlete - array[
      'id','fullName','trainingGroup','timesAthleteId','isArchived'
    ] <> '{}'::jsonb or jsonb_typeof(athlete->'fullName') is distinct from 'string'
      or length(btrim(athlete->>'fullName')) not between 1 and 200
      or jsonb_typeof(athlete->'trainingGroup') is distinct from 'string'
      or length(btrim(athlete->>'trainingGroup')) > 100
      or jsonb_typeof(athlete->'isArchived') is distinct from 'boolean'
      or not athlete ? 'timesAthleteId' or jsonb_typeof(athlete->'timesAthleteId') not in ('null','string')
      or (jsonb_typeof(athlete->'timesAthleteId') = 'string' and length(btrim(athlete->>'timesAthleteId')) not between 1 and 1500) then
      raise check_violation using message = 'Invalid athlete fields';
    end if;
    if athlete ? 'id' then
      athlete_id := athlete->>'id';
      if jsonb_typeof(athlete->'id') is distinct from 'string' or length(athlete_id) not between 1 and 1500
        or athlete_id = any(kept_ids) then
        raise check_violation using message = 'Athlete IDs must be distinct valid IDs';
      end if;
      update public.workshare_athletes r set full_name = btrim(athlete->>'fullName'), training_group = btrim(athlete->>'trainingGroup'),
        times_athlete_id = athlete->>'timesAthleteId', is_archived = (athlete->>'isArchived')::boolean
        where r.id = athlete_id and r.account_id = account_id;
      if not found then raise check_violation using message = 'Athlete does not belong to this account'; end if;
    else
      insert into public.workshare_athletes(account_id,full_name,training_group,times_athlete_id,is_archived)
        values(account_id,btrim(athlete->>'fullName'),btrim(athlete->>'trainingGroup'),athlete->>'timesAthleteId',(athlete->>'isArchived')::boolean)
        returning id into athlete_id;
    end if;
    kept_ids := array_append(kept_ids, athlete_id);
  end loop;
  delete from public.workshare_athletes r where r.account_id = account_id and not r.id = any(kept_ids);
  return private.workshare_account_snapshot(account_id);
end;
$$;

revoke all on function private.workshare_account_version(), private.workshare_child_version(), private.workshare_account_snapshot(text) from public;
grant execute on function private.workshare_account_snapshot(text) to authenticated, service_role;
revoke all on function public.list_workshare_accounts(), public.save_workshare_account(jsonb) from public, anon;
grant execute on function public.list_workshare_accounts(), public.save_workshare_account(jsonb) to authenticated, service_role;

comment on table public.workshare_accounts is 'Staff-managed registration accounts. NULL hour requirements mean unset; zero means no hours required. No legacy Workshare totals are carried forward.';
comment on table public.workshare_athletes is 'Registration roster with an optional explicit Times athlete linkage. Editing these records never changes Times swimmer identities.';
comment on function public.save_workshare_account(jsonb) is 'Atomic account editor for staff and AI clients. Omit account id to create; include id and exact updatedAt to update. Omit id only for newly added athletes. Missing athletes are removed; use isArchived to retain them.';

create function public.import_workshare_accounts(input jsonb) returns jsonb language plpgsql
security invoker set search_path = '' as $$
declare account jsonb; athlete_count integer := 0;
begin
  if current_user not in ('postgres', 'service_role') and not private.is_staff() then
    raise insufficient_privilege using message = 'Administrator access required';
  end if;
  if jsonb_typeof(input) is distinct from 'object' or input - 'accounts' <> '{}'::jsonb
    or jsonb_typeof(input->'accounts') is distinct from 'array' then
    raise check_violation using message = 'Import requires an accounts array';
  end if;
  if jsonb_array_length(input->'accounts') not between 1 and 1000 then
    raise check_violation using message = 'Import between 1 and 1000 accounts';
  end if;
  lock table public.workshare_accounts in share row exclusive mode;
  if exists(select 1 from public.workshare_accounts) then
    raise unique_violation using message = 'Accounts have already been populated. Edit the existing records instead of importing again.';
  end if;
  for account in select value from jsonb_array_elements(input->'accounts') loop
    if jsonb_typeof(account) is distinct from 'object' or account ?| array['id','updatedAt'] then
      raise check_violation using message = 'Import only new accounts without IDs or versions';
    end if;
    if jsonb_typeof(account->'athletes') = 'array' and exists(
      select 1 from jsonb_array_elements(account->'athletes') athlete where athlete ? 'id'
    ) then
      raise check_violation using message = 'Imported athletes must not specify IDs';
    end if;
    perform public.save_workshare_account(account);
    athlete_count := athlete_count + jsonb_array_length(account->'athletes');
  end loop;
  return jsonb_build_object('accountCount',jsonb_array_length(input->'accounts'),'athleteCount',athlete_count);
end;
$$;
revoke all on function public.import_workshare_accounts(jsonb) from public, anon;
grant execute on function public.import_workshare_accounts(jsonb) to authenticated, service_role;
