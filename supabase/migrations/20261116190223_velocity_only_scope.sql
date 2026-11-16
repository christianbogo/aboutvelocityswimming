-- Retain the entire meet catalog and every Velocity result, including historical
-- swimmers without a current roster affiliation. Review/audit history is kept.
set local statement_timeout = '120s';
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('velocity-records'));
select set_config('velocity.defer_bests', 'true', true);
set constraints all immediate;

-- One locked cleanup invalidates the baseline once. Per-row revision updates
-- would otherwise repeatedly rewrite the same row for tens of thousands of
-- deleted races and their cascading source identities. All other triggers stay on.
do $$
declare relation_name text;
begin
  foreach relation_name in array array[
    'public.swims', 'public.relay_results', 'public.athletes', 'public.people',
    'public.teams', 'public.meets', 'public.knowledge_entries',
    'private.athlete_source_identities', 'private.result_occurrences', 'private.result_source_identities'
  ] loop
    execute format('alter table %s disable trigger advance_canonical_revision', relation_name);
  end loop;
end;
$$;

create temporary table velocity_scope_meets on commit drop as
select id from public.meets;
create temporary table velocity_scope_catalog on commit drop as
select id from public.knowledge_entries where kind = 'meet';
create temporary table velocity_scope_results on commit drop as
select 'swim' as kind, id, data from public.swims where data->>'teamId' = 'velocity-swimming'
union all
select 'relay', id, data from public.relay_results where team_id = 'velocity-swimming';

-- Remove the retired Overview API and its otherwise unused import-date projection.
drop function public.archive_observatory(jsonb);
drop trigger publish_swim_archive_date on public.public_swims;
drop function private.publish_swim_archive_date();
alter table public.public_swims drop column archive_added_at;
alter table public.swims drop column archive_added_at;

-- Team discovery no longer depends on Swim Atlas directory entries.
drop trigger sync_times_directory on public.knowledge_entries;
create or replace function private.sync_times_teams() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.public_times_teams(id, name, lsc_code, club_code)
  select id, coalesce(data->>'name', 'Velocity Swimming'), coalesce(data->>'lscCode', 'IE'), data->>'clubCode'
  from public.teams where id = 'velocity-swimming'
  on conflict (id) do update set name = excluded.name,
    lsc_code = excluded.lsc_code, club_code = excluded.club_code;
  delete from public.public_times_teams where id <> 'velocity-swimming';
  return null;
end;
$$;
revoke all on function private.sync_times_teams() from public, anon, authenticated;

-- Keep catalog meets even when an old entry linked to a removed Atlas parent.
update public.knowledge_entries k set data = k.data - 'parentId'
where k.kind = 'meet' and exists (
  select 1 from public.knowledge_entries p where p.id = k.parent_id and p.kind <> 'meet'
);
-- Remove references among the retired directory entries before deleting them.
update public.knowledge_entries set data = data - 'parentId'
where kind <> 'meet' and parent_id is not null;
delete from public.knowledge_entries where kind <> 'meet';

-- Delete individuals first because relay lead-offs reference their parent relay.
delete from public.swims where data->>'teamId' is distinct from 'velocity-swimming';
delete from public.relay_results where team_id is distinct from 'velocity-swimming';

create temporary table velocity_scope_removed_people on commit drop as
with removed as (
  delete from public.athletes a
  where a.team_id is distinct from 'velocity-swimming'
    and not exists (select 1 from public.swims s where s.athlete_id = a.id)
    and not exists (
      select 1 from public.relay_results r,
        lateral jsonb_array_elements(coalesce(r.data->'members', '[]')) member
      where member->>'athleteId' = a.id
    )
    and not exists (select 1 from public.attendance t where t.athlete_id = a.id)
    and not exists (select 1 from public.documents d where d.athlete_id = a.id)
    and not exists (select 1 from public.family_people f where f.person_id = a.person_id)
    and not exists (select 1 from public.documents d where d.person_id = a.person_id)
  returning person_id
)
select distinct person_id from removed;
delete from public.people p using velocity_scope_removed_people removed
where p.id = removed.person_id
  and not exists (select 1 from public.athletes a where a.person_id = p.id)
  and not exists (select 1 from public.family_people f where f.person_id = p.id)
  and not exists (select 1 from public.documents d where d.person_id = p.id);

-- Historical affiliation and host names remain descriptive facts, without a
-- foreign key to another team's retired directory record. Do not claim that a
-- former swimmer is currently on the Velocity roster.
do $$
declare relation_name text;
begin
  foreach relation_name in array array['athletes', 'people', 'documents', 'venues', 'meets'] loop
    execute format(
      'update public.%I r set data = (r.data - ''teamId'') || jsonb_build_object(''teamName'', coalesce(r.data->>''teamName'', t.data->>''name'', t.id)) from public.teams t where r.team_id = t.id and t.id <> ''velocity-swimming''',
      relation_name
    );
  end loop;
end;
$$;
update public.meets m set data = (m.data - 'hostTeamId') ||
  jsonb_build_object('hostTeamName', coalesce(m.data->>'hostTeamName', t.data->>'name', t.id))
from public.teams t where m.host_team_id = t.id and t.id <> 'velocity-swimming';
delete from public.teams where id <> 'velocity-swimming';
-- The team trigger above also clears obsolete public team facets.

-- Reject out-of-scope publication through every writer, including direct SQL,
-- legacy collection approval, and additive import approval.
alter table public.teams add constraint velocity_only_team check (id = 'velocity-swimming');
alter table public.swims add constraint velocity_only_swim
  check ((data->>'teamId') is not distinct from 'velocity-swimming');
alter table public.relay_results add constraint velocity_only_relay
  check (team_id is not distinct from 'velocity-swimming');
alter table public.knowledge_entries add constraint meet_catalog_only check (kind = 'meet');
alter table public.public_times_teams add constraint velocity_only_public_team check (id = 'velocity-swimming');

-- Existing import audit rows remain readable, but cannot republish removed data.
create or replace function private.velocity_import_issue(
  item private.velocity_import_rows, sid uuid default null, publish boolean default false
) returns text language plpgsql stable set search_path = '' as $$
declare reason text; member_hash text;
begin
  if item.kind in ('swim', 'relay') and item.data->>'teamId' is distinct from 'velocity-swimming' then
    return 'Only Velocity Swimming results can be imported.';
  end if;
  reason := private.velocity_import_base_issue(item, sid, publish);
  if reason is not null or item.kind <> 'swim' then return reason; end if;
  member_hash := private.velocity_import_swimmer_member(item);
  if member_hash is not null and exists (
    select 1 from private.velocity_import_swimmer_identity_targets(member_hash) target
    where target.athlete_id <> item.data->>'athleteId'
  ) then return 'The source swimmer identity needs a reviewed canonical match.'; end if;
  return null;
end;
$$;

select set_config('velocity.defer_bests', 'false', true);
do $$
declare relation_name text;
begin
  foreach relation_name in array array[
    'public.swims', 'public.relay_results', 'public.athletes', 'public.people',
    'public.teams', 'public.meets', 'public.knowledge_entries',
    'private.athlete_source_identities', 'private.result_occurrences', 'private.result_source_identities'
  ] loop
    execute format('alter table %s enable trigger advance_canonical_revision', relation_name);
  end loop;
end;
$$;
update private.canonical_revision set revision = revision + 1 where singleton;
select private.rebuild_bests();
select pg_advisory_xact_lock(hashtext('velocity-team-record-refresh'));
select private.refresh_team_records();

-- Abort the complete migration if any retained result or meet disappeared.
do $$
begin
  if exists (select 1 from velocity_scope_meets old left join public.meets m using (id) where m.id is null)
    or exists (select 1 from velocity_scope_catalog old left join public.knowledge_entries k using (id) where k.id is null)
    or exists (
      select 1 from velocity_scope_results old
      left join public.swims s on old.kind = 'swim' and s.id = old.id
      left join public.relay_results r on old.kind = 'relay' and r.id = old.id
      where old.data is distinct from coalesce(s.data, r.data)
    ) then
    raise exception 'Velocity scope cleanup did not preserve all meets and Velocity results';
  end if;
end;
$$;
