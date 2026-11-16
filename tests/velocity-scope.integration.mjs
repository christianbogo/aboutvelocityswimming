import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Recreate the retired scope only inside a rollback-only local transaction, then
// exercise the real migration against transfers, relay members and meet hosts.
test('Velocity cleanup preserves historical swimmers, operational links and every meet', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20261116190223_velocity_only_scope.sql', import.meta.url), 'utf8');
  const setup = `
    set local velocity.defer_bests = 'true';
    alter table public.teams drop constraint velocity_only_team;
    alter table public.swims drop constraint velocity_only_swim;
    alter table public.relay_results drop constraint velocity_only_relay;
    alter table public.knowledge_entries drop constraint meet_catalog_only;
    alter table public.public_times_teams drop constraint velocity_only_public_team;
    alter table public.swims add column archive_added_at timestamptz;
    alter table public.public_swims add column archive_added_at timestamptz;
    create function public.archive_observatory(jsonb) returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function private.publish_swim_archive_date() returns trigger language plpgsql as $$ begin return new; end $$;
    create trigger publish_swim_archive_date before insert or update on public.public_swims for each row execute function private.publish_swim_archive_date();
    create trigger sync_times_directory after insert or update or delete on public.knowledge_entries for each statement execute function private.sync_times_teams();
    select private.put_record('teams/scope-visitor', '{"name":"Visiting Club","lscCode":"PN"}');
    select private.put_record('meets/scope-meet', '{"name":"Shared Meet","teamId":"scope-visitor","hostTeamId":"scope-visitor"}');
    select private.put_record('knowledge_entries/scope-directory', '{"kind":"team","title":"Visiting Club","sourceUrl":"https://example.test/team"}');
    select private.put_record('knowledge_entries/scope-catalog', '{"kind":"meet","title":"Shared Meet","parentId":"scope-directory","sourceUrl":"https://example.test/meet"}');
    select private.put_record('athletes/scope-transfer', '{"id":"scope-transfer","name":{"first":"Historical","last":"Transfer"},"teamId":"scope-visitor"}');
    select private.put_record('athletes/scope-visitor', '{"id":"scope-visitor","name":{"first":"Visitor","last":"Only"},"teamId":"scope-visitor"}');
    select private.put_record('athletes/scope-relay-only', '{"id":"scope-relay-only","name":{"first":"Relay","last":"Only"}}');
    select private.put_record('athletes/scope-family', '{"id":"scope-family","name":{"first":"Family","last":"Member"},"teamId":"scope-visitor"}');
    insert into public.families(id,data) values('scope-family','{}');
    insert into public.family_people(family_id,person_id,relationship)
      select 'scope-family',person_id,'child' from public.athletes where id='scope-family';
    select private.put_record('swims/scope-velocity', '{"id":"scope-velocity","athleteId":"scope-transfer","teamId":"velocity-swimming","eventCode":"100_FR_SCY","course":"SCY","timeMs":60000,"status":"OK","round":"F","isOfficial":true,"isRelay":false,"gender":"F","ageAtSwim":12,"meet":{"id":"scope-meet","name":"Shared Meet","date":"2001-01-01"}}');
    select private.put_record('swims/scope-visitor', '{"id":"scope-visitor","athleteId":"scope-visitor","teamId":"scope-visitor","eventCode":"100_FR_SCY","course":"SCY","timeMs":55000,"status":"OK","round":"F","isOfficial":true,"isRelay":false,"gender":"F","ageAtSwim":12,"meet":{"id":"scope-meet","name":"Shared Meet","date":"2001-01-01"}}');
    select private.put_record('relay_results/scope-relay', '{"id":"scope-relay","teamId":"velocity-swimming","eventCode":"200_FR-R_SCY","course":"SCY","timeMs":120000,"distance":200,"stroke":"FR","status":"OK","round":"F","isOfficial":true,"isRelay":true,"gender":"F","ageGroup":"11-12","relayName":"Velocity A","splitCoverage":"unavailable","members":[{"leg":1,"name":"Relay Only","athleteId":"scope-relay-only"}],"meet":{"id":"scope-meet","name":"Shared Meet","date":"2001-01-01"}}');
    create temporary table scope_meet_ids as select id from public.meets;
    create temporary table scope_catalog_ids as select id from public.knowledge_entries where kind='meet';
  `;
  const assertions = `
    create function pg_temp.check_ok(ok boolean, message text) returns void language plpgsql as $$
    begin if ok is distinct from true then raise exception '%', message; end if; end $$;
    select pg_temp.check_ok(exists(select 1 from public.swims where id='scope-velocity'),'Historical Velocity swim lost');
    select pg_temp.check_ok(exists(select 1 from public.relay_results where id='scope-relay'),'Velocity relay lost');
    select pg_temp.check_ok((select count(*)=3 from public.athletes where id in ('scope-transfer','scope-relay-only','scope-family')),'Historical, relay-only or family swimmer lost');
    select pg_temp.check_ok((select team_id is null and data->>'teamName'='Visiting Club' from public.athletes where id='scope-transfer'),'Transfer incorrectly assigned to current roster');
    select pg_temp.check_ok(not exists(select 1 from public.athletes where id='scope-visitor'),'Visitor-only athlete retained');
    select pg_temp.check_ok(not exists(select 1 from public.swims where data->>'teamId' is distinct from 'velocity-swimming'),'Foreign swim retained');
    select pg_temp.check_ok(not exists(select 1 from public.teams where id<>'velocity-swimming'),'Foreign team retained');
    select pg_temp.check_ok(not exists(select 1 from scope_meet_ids old left join public.meets m using(id) where m.id is null),'Meet removed');
    select pg_temp.check_ok(not exists(select 1 from scope_catalog_ids old left join public.knowledge_entries k using(id) where k.id is null),'Catalog meet removed');
    select pg_temp.check_ok((select host_team_id is null and data->>'hostTeamName'='Visiting Club' from public.meets where id='scope-meet'),'Meet host name lost');
    select pg_temp.check_ok(not exists(select 1 from public.knowledge_entries where kind<>'meet'),'Atlas entry retained');
    select pg_temp.check_ok(not exists(select 1 from public.team_record_holders where team<>'velocity-swimming'),'Foreign record holder retained');
    select pg_temp.check_ok(not exists(select 1 from pg_trigger where tgname='advance_canonical_revision' and tgenabled='D'),'Revision trigger left disabled');
    select pg_temp.check_ok(to_regprocedure('public.archive_observatory(jsonb)') is null,'Overview RPC retained');
  `;
  try {
    execFileSync('docker', ['exec', '-i', 'supabase_db_aboutvelocityswimming', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], {
      input: `begin;\n${setup}\n${migration}\n${assertions}\nrollback;`,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(error.stderr?.toString() || error.message);
  }
});
