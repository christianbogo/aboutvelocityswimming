-- Archived is a roster status, never a training assignment.
create function private.workshare_archive_assignment() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.is_archived then new.training_group := ''; end if;
  return new;
end;
$$;
revoke all on function private.workshare_archive_assignment() from public;
create trigger workshare_archive_assignment before insert or update on public.workshare_athletes
for each row execute function private.workshare_archive_assignment();
update public.workshare_athletes set training_group = '' where is_archived and training_group <> '';
alter table public.workshare_athletes add constraint archived_athlete_unassigned check (not is_archived or training_group = '');
