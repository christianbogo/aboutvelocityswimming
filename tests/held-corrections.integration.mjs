import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const workdir = process.env.VELOCITY_IMPORT_TEST_WORKDIR ?? ".";
const project = readFileSync(join(workdir, "supabase/config.toml"), "utf8")
  .match(/^project_id = "([a-zA-Z0-9_-]+)"/m)?.[1];

test("held result corrections keep the same records and refresh eligible calculations", () => {
  if (!project) throw new Error("A local Supabase project is required.");
  try {
    execFileSync("docker", ["exec", "-i", `supabase_db_${project}`, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt"], {
      input: `
        begin;
        do $test$
        declare
          staff_id uuid;
          worker_id uuid;
          batch_id uuid;
          swim jsonb := '{
            "id":"held-test-swim","athleteId":"held-test-athlete","teamId":"velocity-swimming",
            "meet":{"id":"held-test-meet","date":"2026-10-01","name":"Held test meet"},
            "eventCode":"100_FR_SCY","distance":100,"stroke":"FR","course":"SCY",
            "round":"P","gender":"F","status":"OK","timeMs":43000,"isRelay":false,"isOfficial":true
          }';
          relay jsonb := '{
            "id":"held-test-relay","relayName":"Held test relay","teamId":"velocity-swimming",
            "meet":{"id":"held-test-meet","date":"2026-10-01","name":"Held test meet"},
            "eventCode":"200_FR-R_SCY","distance":200,"stroke":"FR","course":"SCY",
            "round":"F","gender":"F","ageGroup":"11-12","status":"OK","timeMs":115000,
            "isRelay":true,"isOfficial":true,"members":[],"splitCoverage":"unavailable"
          }';
          source_url text := 'https://example.test/result';
        begin
          insert into auth.users(id,email,email_confirmed_at,role)
            values(gen_random_uuid(),'held-correction-test@example.test',now(),'authenticated')
            returning id into staff_id;
          insert into public.administrators(user_id) values(staff_id);
          insert into private.collection_workers(name,token_hash,divisions)
            values('held-correction-test',encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),array['times'])
            returning id into worker_id;
          if has_function_privilege('authenticated', 'private.velocity_held_stage_correction(uuid,text,text,jsonb,jsonb,text,text)', 'execute') then
            raise exception 'The staging helper must be reachable only through staff archive operations';
          end if;
          perform set_config('request.jwt.claims',jsonb_build_object('sub',staff_id,'role','authenticated')::text,true);
          perform private.put_record('teams/velocity-swimming','{"name":"Velocity Swimming","lscCode":"IE","clubCode":"VS"}');
          perform private.put_record('meets/held-test-meet','{"name":"Held test meet","startsOn":"2026-10-01","endsOn":"2026-10-01"}');
          perform private.put_record('athletes/held-test-athlete','{"name":{"first":"Test","last":"Swimmer"},"gender":"F"}');
          perform private.put_record('swims/held-test-swim',swim);
          perform private.put_record('relay_results/held-test-relay',relay);
          select private.collection_snapshot('swims/held-test-swim') into swim;
          select private.collection_snapshot('relay_results/held-test-relay') into relay;
          if not exists(select 1 from public.athlete_bests where athlete_id='held-test-athlete' and data->>'swimId'='held-test-swim')
            or exists(select 1 from public.ies_times_candidates('{"ageGroups":["11-12"]}') where id='held-test-swim') then
            raise exception 'An unknown age should still allow a best time outside age groups';
          end if;
          perform private.refresh_team_records();
          if not exists(select 1 from public.team_record_holders where result_id='held-test-relay') then
            raise exception 'A verified relay total can count before its lineup is available';
          end if;

          batch_id := private.velocity_held_stage_correction(worker_id,'swim','held-test-swim',swim,
            swim || '{"ageAtSwim":12}', source_url,'Verified race-day age');
          if batch_id is distinct from private.velocity_held_stage_correction(worker_id,'swim','held-test-swim',swim,
            swim || '{"ageAtSwim":12}', source_url,'Verified race-day age') then
            raise exception 'A correction retry must reuse the same batch';
          end if;
          if (select times_age is not null from public.public_swims where id='held-test-swim') then
            raise exception 'The correction became public before approval';
          end if;
          perform public.review_collection(batch_id,'approved','Checked evidence');
          perform private.refresh_team_records();
          if not exists(select 1 from public.ies_times_candidates('{"ageGroups":["11-12"]}') where id='held-test-swim')
            or not exists(select 1 from public.team_record_holders where result_id='held-test-swim' and age_group='11-12') then
            raise exception 'The age correction did not update ranking and record eligibility';
          end if;
          begin
            perform private.velocity_held_stage_correction(worker_id,'swim','held-test-swim',swim,
              swim || '{"ageAtSwim":13}', source_url,'Stale proof');
            raise exception 'A stale correction should fail';
          exception when serialization_failure then null;
          end;

          batch_id := private.velocity_held_stage_correction(worker_id,'relay','held-test-relay',relay,
            relay || '{"members":[{"leg":1,"name":"Test Swimmer","athleteId":"held-test-athlete"}]}', source_url,'Verified relay assignment');
          if (select data->>'lineupCoverage' from public.public_relay_results where id='held-test-relay') is distinct from 'unavailable' then
            raise exception 'The relay lineup became public before review';
          end if;
          perform public.review_collection(batch_id,'approved','Checked lineup');
          if not exists(select 1 from public.public_relay_results where id='held-test-relay'
            and times_time=115000 and data->>'lineupCoverage'='partial' and data#>>'{members,0,athleteId}'='held-test-athlete') then
            raise exception 'The correction should update the same relay and preserve the team time';
          end if;
        end
        $test$;
        rollback;
      `,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(error.stderr?.toString() || error.message, { cause: error });
  }
});
