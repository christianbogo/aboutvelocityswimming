-- The registration roster owns these groups; Times/attendance identities stay separate.
create table public.workshare_groups (
  id text primary key default gen_random_uuid()::text,
  name text not null unique check (name = btrim(name) and length(name) <= 100 and (name <> '' or id = 'unassigned')),
  coach text not null default '' check (coach = btrim(coach) and length(coach) <= 200),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.workshare_groups enable row level security;
revoke all on public.workshare_groups from anon, authenticated;
grant select, insert, update, delete on public.workshare_groups to authenticated, service_role;
create policy workshare_groups_read on public.workshare_groups for select to authenticated using ((select private.is_workshare_staff()));
create policy workshare_groups_insert on public.workshare_groups for insert to authenticated with check ((select private.is_workshare_staff()) and id <> 'unassigned');
create policy workshare_groups_update on public.workshare_groups for update to authenticated using ((select private.is_workshare_staff()) and id <> 'unassigned') with check ((select private.is_workshare_staff()) and id <> 'unassigned');
create policy workshare_groups_delete on public.workshare_groups for delete to authenticated using ((select private.is_workshare_staff()) and id <> 'unassigned');
insert into public.workshare_groups(id,name) values ('unassigned','');
insert into public.workshare_groups(name)
  select name from (select unnest(array['Splash','Pre-Team','Prep','Age Groupers','Juniors','Seniors','Masters','Rec Team','Coaches','Board Members']) name
    union select training_group from public.workshare_athletes where training_group <> '') names;
create trigger workshare_group_version before update on public.workshare_groups for each row execute function private.workshare_account_version();
-- Preserve older account clients and imports that supply a group name directly.
create function private.workshare_register_group() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.training_group <> '' then
    insert into public.workshare_groups(name) values(new.training_group) on conflict(name) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.workshare_register_group() from public;
create trigger workshare_register_group before insert or update of training_group on public.workshare_athletes
  for each row execute function private.workshare_register_group();
alter table public.workshare_athletes add constraint workshare_athletes_group_fkey
  foreign key(training_group) references public.workshare_groups(name) on update cascade;
create index workshare_athletes_group_idx on public.workshare_athletes(training_group);

create function public.manage_workshare_athletes(input jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  operation text := input->>'action';
  source public.workshare_groups;
  destination text;
  member jsonb;
  reviewed jsonb;
begin
  perform private.workshare_require_staff();
  if jsonb_typeof(input) is distinct from 'object' or operation is null then
    raise check_violation using message = 'Choose a roster action.';
  end if;
  -- Account saves lock this table first, too. Serialize multi-account changes
  -- before inspecting versions, so either every selected athlete moves or none do.
  lock table public.workshare_accounts in exclusive mode;
  lock table public.workshare_groups in share row exclusive mode;
  if operation in ('updateGroup','removeGroup') then
    select * into source from public.workshare_groups where id = input->>'id' and id <> 'unassigned' for update;
    if not found then raise no_data_found using message = 'Group no longer exists. Reload groups.'; end if;
    if source.updated_at is distinct from (input->>'updatedAt')::timestamptz then
      raise serialization_failure using message = 'This group changed. Reload before saving.';
    end if;
  end if;
  if operation in ('createGroup','updateGroup') then
    if jsonb_typeof(input->'name') is distinct from 'string' or length(btrim(input->>'name')) not between 1 and 100
      or jsonb_typeof(input->'coach') is distinct from 'string' or length(btrim(input->>'coach')) > 200 then
      raise check_violation using message = 'Enter a group name (up to 100 characters) and coach name (up to 200 characters).';
    end if;
    if exists(select 1 from public.workshare_groups g where lower(g.name) = lower(btrim(input->>'name')) and (source.id is null or g.id <> source.id)) then
      raise unique_violation using message = 'A group with that name already exists.';
    end if;
    if operation = 'createGroup' then
      insert into public.workshare_groups(name,coach) values(btrim(input->>'name'),btrim(input->>'coach')) returning * into source;
    else
      update public.workshare_groups set name=btrim(input->>'name'),coach=btrim(input->>'coach') where id=source.id returning * into source;
    end if;
  elsif operation in ('move','removeGroup') then
    select name into destination from public.workshare_groups where id=input->>'destinationId';
    if not found then raise no_data_found using message = 'Destination group no longer exists. Reload groups.'; end if;
    if operation = 'removeGroup' then
      if source.name = destination then raise check_violation using message = 'Choose a different destination group.'; end if;
      select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into reviewed from public.workshare_athletes where training_group=source.name;
      if reviewed is distinct from input->'athleteIds' then
        raise serialization_failure using message = 'Group membership changed. Reload before removing the group.';
      end if;
      update public.workshare_athletes set training_group=destination where training_group=source.name;
      delete from public.workshare_groups where id=source.id;
    else
      if jsonb_typeof(input->'athletes') is distinct from 'array' then raise check_violation using message = 'Choose athletes to move.'; end if;
      if jsonb_array_length(input->'athletes') not between 1 and 1000 then raise check_violation using message = 'Move between 1 and 1,000 athletes at a time.'; end if;
      if (select count(distinct x->>'id') from jsonb_array_elements(input->'athletes') x) <> jsonb_array_length(input->'athletes') then
        raise check_violation using message = 'Choose each athlete only once.';
      end if;
      -- Validate ALL account versions before triggers increment any of them.
      for member in select value from jsonb_array_elements(input->'athletes') loop
        if not exists(select 1 from public.workshare_athletes r join public.workshare_accounts a on a.id=r.account_id
          where r.id=member->>'id' and a.updated_at=(member->>'updatedAt')::timestamptz) then
          raise serialization_failure using message = 'An athlete or account changed. Reload the roster before moving athletes.';
        end if;
      end loop;
      update public.workshare_athletes r set training_group=destination
        where r.id in (select x->>'id' from jsonb_array_elements(input->'athletes') x);
    end if;
  else
    raise check_violation using message = 'Unknown roster action.';
  end if;
  return jsonb_build_object('success',true);
end;
$$;
revoke all on function public.manage_workshare_athletes(jsonb) from public, anon;
grant execute on function public.manage_workshare_athletes(jsonb) to authenticated, service_role;
notify pgrst, 'reload schema';
