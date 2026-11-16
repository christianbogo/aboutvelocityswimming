do $migration$
begin
  -- These are private follow preferences, never claims of athlete ownership.
  create table public.account_followed_athletes (
    user_id uuid not null references auth.users(id) on delete cascade,
    athlete_id text not null references public.public_athletes(id) on delete cascade,
    is_primary boolean not null default false,
    primary key (user_id, athlete_id)
  );
  create unique index account_followed_athletes_one_primary
    on public.account_followed_athletes(user_id) where is_primary;
  create index account_followed_athletes_athlete_idx
    on public.account_followed_athletes(athlete_id);
  alter table public.account_followed_athletes enable row level security;
  revoke all on public.account_followed_athletes from anon, authenticated;
  grant select, insert, update, delete on public.account_followed_athletes to authenticated;
  grant all on public.account_followed_athletes to service_role;
  create policy "Read own followed athletes" on public.account_followed_athletes
    for select to authenticated using ((select auth.uid()) = user_id);
  create policy "Create own followed athletes" on public.account_followed_athletes
    for insert to authenticated with check ((select auth.uid()) = user_id);
  create policy "Update own followed athletes" on public.account_followed_athletes
    for update to authenticated using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);
  create policy "Delete own followed athletes" on public.account_followed_athletes
    for delete to authenticated using ((select auth.uid()) = user_id);

  create function public.search_account_athletes(search_text text)
  returns table(id text, name text, team_name text)
  language sql stable security invoker set search_path = '' as $function$
    with named as (
      select a.id, coalesce(nullif(trim(coalesce(a.data#>>'{name,first}', '') || ' ' ||
        coalesce(a.data#>>'{name,last}', '')), ''), a.id) as name
      from public.public_athletes a
    ), matched as (
      select a.id, a.name from named a
      where char_length(trim(search_text)) between 2 and 100
        and position(lower(trim(search_text)) in lower(a.name)) > 0
      order by lower(a.name), a.id limit 20
    )
    select a.id, a.name, t.name from matched a
    left join lateral (
      select s.times_team from public.public_swims s
      where s.athlete_id = a.id and s.times_team is not null
      order by s.swim_date desc, s.id limit 1
    ) latest on true
    left join public.public_times_teams t on t.id = latest.times_team
    order by lower(a.name), a.id;
  $function$;

  create function public.get_account_athletes(account_user_id uuid)
  returns table(id text, name text, team_name text, is_primary boolean)
  language sql stable security invoker set search_path = '' as $function$
    select a.id, coalesce(nullif(trim(coalesce(a.data#>>'{name,first}', '') || ' ' ||
      coalesce(a.data#>>'{name,last}', '')), ''), a.id), t.name, f.is_primary
    from public.account_followed_athletes f
    join public.public_athletes a on a.id = f.athlete_id
    left join lateral (
      select s.times_team from public.public_swims s
      where s.athlete_id = a.id and s.times_team is not null
      order by s.swim_date desc, s.id limit 1
    ) latest on true
    left join public.public_times_teams t on t.id = latest.times_team
    where f.user_id = account_user_id and account_user_id = (select auth.uid())
    order by f.is_primary desc, lower(a.data#>>'{name,last}'), lower(a.data#>>'{name,first}'), a.id;
  $function$;

  create function public.save_account_athletes(
    account_user_id uuid,
    primary_id text default null,
    favorite_ids text[] default '{}'
  ) returns table(id text, name text, team_name text, is_primary boolean)
  language plpgsql security invoker set search_path = '' as $function$
  begin
    if auth.uid() is null or account_user_id is distinct from auth.uid() then
      raise exception 'You can only change your own athlete preferences.' using errcode = '42501';
    end if;
    if favorite_ids is null or cardinality(favorite_ids) > 100
      or array_position(favorite_ids, null) is not null
      or cardinality(favorite_ids) <> (select count(distinct item) from unnest(favorite_ids) item)
      or primary_id = any(favorite_ids) then
      raise exception 'Choose distinct favorite athletes, separate from the primary athlete.' using errcode = '22023';
    end if;
    -- Serialize whole-selection replacements across tabs. Any invalid foreign key
    -- rolls back the entire save, including the preceding delete.
    perform pg_advisory_xact_lock(hashtextextended(account_user_id::text, 0));
    delete from public.account_followed_athletes f where f.user_id = account_user_id;
    if primary_id is not null then
      insert into public.account_followed_athletes(user_id, athlete_id, is_primary)
        values(account_user_id, primary_id, true);
    end if;
    insert into public.account_followed_athletes(user_id, athlete_id, is_primary)
      select account_user_id, item, false from unnest(favorite_ids) item;
    return query select * from public.get_account_athletes(account_user_id);
  end;
  $function$;

  revoke all on function public.search_account_athletes(text) from public, anon;
  revoke all on function public.get_account_athletes(uuid) from public, anon;
  revoke all on function public.save_account_athletes(uuid, text, text[]) from public, anon;
  grant execute on function public.search_account_athletes(text) to authenticated;
  grant execute on function public.get_account_athletes(uuid) to authenticated;
  grant execute on function public.save_account_athletes(uuid, text, text[]) to authenticated;
end;
$migration$;
