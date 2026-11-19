-- Run inside a rollback-only transaction, after migrations.
select set_config('velocity.defer_bests','true',true);
select private.put_record('athletes/meet-proof-athlete','{"id":"meet-proof-athlete","name":{"first":"Proof","last":"Fixture"},"status":"active","teamId":"velocity-swimming"}');
select private.put_record('meets/meet-proof-meet','{"id":"meet-proof-meet","name":"Proof fixture","startsOn":"2025-02-21","endsOn":"2025-02-22"}');
do $$ declare body jsonb:= '{
 "id":"meet-proof-swim","athleteId":"meet-proof-athlete","teamId":"velocity-swimming",
 "eventCode":"50_BK_SCY","distance":50,"stroke":"BK","course":"SCY","timeMs":21980,
 "status":"OK","round":"P","gender":"M","ageAtSwim":18,"isRelay":false,"isOfficial":true,
 "resultOrigin":"relay_leadoff","meet":{"id":"meet-proof-meet","name":"Proof fixture","date":"2025-02-21"},
 "leadOffVerification":{"method":"Official meet result","attestationId":"10000000-0000-4000-8000-000000000001",
 "verified":true,"flatStart":true,"timingVerified":true,"leadOffStatus":"OK","sourceUrl":"https://example.test/results.pdf"}}
 '; changed jsonb; patch jsonb; begin
 if private.reviewed_meet_leadoff(body) then raise exception 'Unregistered proof accepted'; end if;
 begin
  perform private.put_record('swims/meet-proof-swim',body);
  raise exception 'Unregistered first leg published';
 exception when raise_exception then
  if sqlerrm='Unregistered first leg published' then raise; end if;
 end;
 insert into private.official_meet_leadoff_attestations(id,result_id,binding,evidence)
 values('10000000-0000-4000-8000-000000000001','meet-proof-swim',private.meet_leadoff_binding(body),
  '{"sourceUrl":"https://example.test/results.pdf","page":1,"verification":"Synthetic first-leg proof"}');
 if not private.reviewed_meet_leadoff(body) then raise exception 'Registered exact proof rejected'; end if;
 perform private.put_record('swims/meet-proof-swim',body);
 for patch in select value from jsonb_array_elements('[{"timeMs":21970},{"athleteId":"someone-else"},{"ageAtSwim":17},
  {"round":"F"},{"isOfficial":false},{"status":"DQ"},{"isSplit":true},{"parentRelayResultId":"unknown"},
  {"meet":{"id":"meet-proof-meet","date":"2025-02-22"}},
  {"leadOffVerification":{"attestationId":"10000000-0000-4000-8000-000000000001"}}]') loop
  changed:=body||patch;
  if private.reviewed_meet_leadoff(changed) then raise exception 'Altered proof accepted: %',patch; end if;
 end loop;
 if exists(select 1 from public.public_swims where id='meet-proof-swim' and data::text like '%attestationId%') then raise exception 'Private attestation leaked'; end if;
 if has_table_privilege('authenticated','private.official_meet_leadoff_attestations','insert')
  or has_table_privilege('anon','private.official_meet_leadoff_attestations','select')
  or has_function_privilege('authenticated','private.reviewed_meet_leadoff(jsonb)','execute') then raise exception 'Public attestation access'; end if;
end $$;
set constraints all immediate;
