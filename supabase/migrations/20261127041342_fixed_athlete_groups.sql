-- Preserve roster records while consolidating retired groups into Other.
lock table public.workshare_accounts in exclusive mode;
lock table public.workshare_groups in share row exclusive mode;
insert into public.workshare_groups(name) values ('Seniors'),('Juniors'),('Age Groupers'),('Prep'),('Other') on conflict(name) do nothing;
update public.workshare_athletes set training_group='Other'
where training_group not in ('','Seniors','Juniors','Age Groupers','Prep','Other');
delete from public.workshare_groups where name not in ('','Seniors','Juniors','Age Groupers','Prep','Other');
set constraints workshare_groups_order_unique deferred;
update public.workshare_groups set coach='',sort_order=case name when '' then 0 when 'Seniors' then 1 when 'Juniors' then 2 when 'Age Groupers' then 3 when 'Prep' then 4 when 'Other' then 5 end;
create or replace function private.workshare_register_group() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.training_group not in ('','Seniors','Juniors','Age Groupers','Prep','Other') then
    raise check_violation using message='Choose a fixed practice group.';
  end if;
  return new;
end;
$$;
create function private.workshare_fixed_groups() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  raise check_violation using message='Practice groups are fixed and cannot be edited.';
end;
$$;
revoke all on function private.workshare_fixed_groups() from public;
create trigger workshare_fixed_groups before insert or update or delete on public.workshare_groups
for each row execute function private.workshare_fixed_groups();
create or replace function public.manage_workshare_athletes(input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare destination text; member jsonb;
begin
  perform private.workshare_require_staff();
  if jsonb_typeof(input) is distinct from 'object' or input->>'action' is distinct from 'move' then
    raise check_violation using message='Practice groups are fixed. Only athlete moves are allowed.';
  end if;
  lock table public.workshare_accounts in exclusive mode;
  lock table public.workshare_groups in share row exclusive mode;
  select name into destination from public.workshare_groups where id=input->>'destinationId';
  if not found then raise no_data_found using message='Choose a fixed practice group.'; end if;
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
  return jsonb_build_object('success',true);
end;
$$;
revoke all on function public.manage_workshare_athletes(jsonb) from public, anon;
grant execute on function public.manage_workshare_athletes(jsonb) to authenticated, service_role;
revoke execute on function public.reorder_workshare_groups(jsonb) from authenticated, anon;
notify pgrst, 'reload schema';
