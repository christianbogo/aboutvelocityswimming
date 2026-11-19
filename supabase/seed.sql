-- Local synthetic fixture API. Seed files are never applied to hosted projects.
create function public.test_write_records(reads jsonb,writes jsonb) returns void language plpgsql security invoker set search_path='' as $$ declare r jsonb;current_data jsonb;begin
 perform pg_advisory_xact_lock(hashtext('velocity-records'));
 perform set_config('velocity.defer_bests','true',true);
 for r in select * from jsonb_array_elements(reads) loop select data into current_data from public.app_records where path=r->>'path';if coalesce(current_data,'null'::jsonb) is distinct from r->'before' then raise exception 'Source changed during collection' using errcode='40001';end if;end loop;
 for r in select * from jsonb_array_elements(writes) loop perform private.put_record(r->>'path',case when r->'after'='null'::jsonb then null else r->'after' end);end loop;
perform set_config('velocity.defer_bests','false',true);if exists(select 1 from jsonb_array_elements(writes) w where starts_with(w->>'path','swims/') or starts_with(w->>'path','athletes/')) then perform private.rebuild_bests();end if;end;$$;
revoke all on function public.test_write_records(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.test_write_records(jsonb,jsonb) to service_role;
