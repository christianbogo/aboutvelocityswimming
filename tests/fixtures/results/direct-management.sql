begin;
do $test$
declare uid uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); r jsonb; changed jsonb; receipt jsonb; row jsonb; rid text; rejected boolean; parent jsonb; child jsonb; version text; swim_count bigint; board_before jsonb; board_after jsonb;
begin
 perform private.put_record('teams/velocity-swimming','{"name":"Velocity Swimming","lscCode":"IE","clubCode":"VS"}');
 select id into uid from auth.users where email='christiancutter02@gmail.com';
 if uid is null then uid:=gen_random_uuid(); insert into auth.users(id,email,email_confirmed_at,role) values(uid,'christiancutter02@gmail.com',now(),'authenticated'); end if;
 insert into auth.users(id,email,email_confirmed_at,role) values(outsider,'data-outsider@example.test',now(),'authenticated');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
 rejected:=false; begin perform public.manage_result_records('{"action":"list","kind":"swim"}'); exception when insufficient_privilege then rejected:=true; end;
 if not rejected then raise exception 'Non-owner read allowed'; end if;
 rejected:=false; begin perform public.import_meet_results('{"rows":[]}'); exception when insufficient_privilege then rejected:=true; end;
 if not rejected then raise exception 'Non-owner import allowed'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
 r:=public.manage_result_records('{"action":"save","kind":"athlete","id":"data-test-athlete","version":"new","data":{"id":"data-test-athlete","name":{"first":"Direct","last":"Entry"},"gender":"F","status":"active","dob":"2010-01-02","teamId":"velocity-swimming"}}');
 if r->>'version'='new' then raise exception 'Missing optimistic version'; end if;
 changed:=public.manage_result_records(jsonb_build_object('action','save','kind','athlete','id',r->>'id','version',r->>'version','data',r->'data'||'{"status":"inactive"}'));
 rejected:=false; begin perform public.manage_result_records(jsonb_build_object('action','save','kind','athlete','id',r->>'id','version',r->>'version','data',r->'data')); exception when serialization_failure then rejected:=true; end;
 if not rejected then raise exception 'Stale save allowed'; end if;
 perform public.manage_result_records('{"action":"save","kind":"meet","id":"data-test-meet","version":"new","data":{"id":"data-test-meet","name":"Direct Test Meet","dates":{"startDate":"2026-11-01","endDate":"2026-11-02"}}}');
 r:=public.manage_result_records('{"action":"save","kind":"swim","id":"data-test-swim","version":"new","data":{"id":"data-test-swim","athleteId":"data-test-athlete","teamId":"velocity-swimming","eventCode":"100_FR_SCY","distance":100,"stroke":"FR","course":"SCY","gender":"F","round":"F","status":"OK","timeMs":65000,"isOfficial":true,"isRelay":false,"ageAtSwim":16,"meet":{"id":"data-test-meet","name":"Direct Test Meet","date":"2026-11-01"}}}');
 if not exists(select 1 from public.athlete_bests where athlete_id='data-test-athlete' and event_code='100_FR_SCY') then raise exception 'No immediate best'; end if;
 changed:=public.manage_result_records(jsonb_build_object('action','save','kind','swim','id',r->>'id','version',r->>'version','data',r->'data'||'{"eventCode":"50_FR_SCY","distance":50,"timeMs":30000}'));
 if exists(select 1 from public.athlete_bests where athlete_id='data-test-athlete' and event_code='100_FR_SCY') or not exists(select 1 from public.athlete_bests where athlete_id='data-test-athlete' and event_code='50_FR_SCY') then raise exception 'Old and new best groups were not updated'; end if;
 row:='{"kind":"swim","source":{"filename":"fixture.sd3","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","line":4,"format":"sd3"},"meet":{"name":"File Test Meet","startsOn":"2026-11-03","endsOn":"2026-11-03"},"team":{"clubCode":"VS","lscCode":"IE"},"athlete":{"first":"File","last":"Swimmer","dob":"2011-01-02","gender":"F","memberHash":"aaaaaaaaaaaaaaaaaaaaaaaa"},"eventNumber":"5","distance":100,"stroke":"FR","course":"SCY","gender":"F","date":"2026-11-03","round":"F","status":"OK","timeMs":62000,"splits":[],"splitCoverage":"unavailable"}';
 receipt:=public.import_meet_results(jsonb_build_object('rows',jsonb_build_array(row,row||'{"timeMs":0}',row||jsonb_build_object('source',(row->'source')||'{"line":5}'))));
 if receipt->>'saved'<>'1' or receipt#>>'{outcomes,1,status}'<>'error' or receipt#>>'{outcomes,2,status}'<>'duplicate' then raise exception 'Partial import failed: %',receipt; end if;
 rid:=receipt#>>'{outcomes,0,id}';
 if (private.result_record('athlete','ath_file_aaaaaaaaaaaaaaaaaaaaaaaa')->>'status')<>'inactive' then raise exception 'Imported profile inferred membership'; end if;
 receipt:=public.import_meet_results(jsonb_build_object('rows',jsonb_build_array(row)));
 if receipt#>>'{outcomes,0,status}'<>'duplicate' then raise exception 'Retry failed: %',receipt; end if;
 receipt:=public.import_meet_results(jsonb_build_object('rows',jsonb_build_array(row||'{"timeMs":61000}')));
 if receipt#>>'{outcomes,0,status}'<>'error' or (select time_ms from public.swims where id=rid)<>62000 then raise exception 'Conflict overwrote a result: %',receipt; end if;
 receipt:=public.import_meet_results(jsonb_build_object('rows',jsonb_build_array(row||'{"round":"P","status":"DQ","timeMs":0}')));
 if receipt->>'saved'<>'1' then raise exception 'DQ result failed: %',receipt; end if;
 receipt:=public.import_meet_results(jsonb_build_object('rows',jsonb_build_array(row||jsonb_build_object('athlete',(row->'athlete')-'memberHash'-'dob')||'{"round":"TT"}')));
 if receipt#>>'{outcomes,0,status}'<>'error' then raise exception 'Name-only match allowed'; end if;
 receipt:=public.import_meet_results(jsonb_build_object('rows',jsonb_build_array(row||jsonb_build_object('athlete',(row->'athlete')||'{"dob":"2012-01-02"}')||'{"round":"TT"}')));
 if receipt#>>'{outcomes,0,status}'<>'error' then raise exception 'Wrong birthday matched'; end if;

 -- Ambiguous headers require an explicit meet selection.
 perform public.manage_result_records('{"action":"save","kind":"meet","id":"data-test-ambiguous","version":"new","data":{"id":"data-test-ambiguous","name":"File Test Meet","dates":{"startDate":"2026-11-03","endDate":"2026-11-03"}}}');
 receipt:=public.import_meet_results(jsonb_build_object('rows',jsonb_build_array(row||'{"round":"TT"}')));
 if receipt#>>'{outcomes,0,status}'<>'error' or receipt#>>'{outcomes,0,message}' not like 'Multiple meets%' then raise exception 'Ambiguous meet accepted: %',receipt; end if;
 receipt:=public.import_meet_results(jsonb_build_object('meetId','meet_file_'||md5('file test meet|2026-11-03'),'rows',jsonb_build_array(row||'{"round":"TT"}')));
 if receipt->>'saved'<>'1' then raise exception 'Explicit meet choice failed: %',receipt; end if;
 -- Legacy affiliation needs an explicit owner choice and remains recorded.
 receipt:=public.import_meet_results(jsonb_build_object('rows',jsonb_build_array(row||'{"team":{"clubCode":"CUDA","lscCode":"IE"},"round":"S"}')));
 if receipt#>>'{outcomes,0,status}'<>'skipped' then raise exception 'Unverified history included'; end if;
 receipt:=public.import_meet_results(jsonb_build_object('meetId','meet_file_'||md5('file test meet|2026-11-03'),'includeHistoricalCuda',true,'rows',jsonb_build_array(row||'{"team":{"clubCode":"CUDA","lscCode":"IE"},"round":"S"}')));
 if receipt->>'saved'<>'1' or (private.result_record('swim',receipt#>>'{outcomes,0,id}')#>>'{sourceObservation,affiliation,clubCode}')<>'CUDA' then raise exception 'Historical affiliation lost: %',receipt; end if;
 -- A bad row rolls back its new meet/profile too.
 receipt:=public.import_meet_results(jsonb_build_object('rows',jsonb_build_array(row||'{"meet":{"name":"Never Create","startsOn":"2026-11-03","endsOn":"2026-11-03"},"athlete":{"first":"Rejected","last":"Profile","gender":"F","dob":"2011-01-01","memberHash":"bbbbbbbbbbbbbbbbbbbbbbbb"},"timeMs":0}')));
 if receipt#>>'{outcomes,0,status}'<>'error' or exists(select 1 from public.athletes where id='ath_file_bbbbbbbbbbbbbbbbbbbbbbbb') or exists(select 1 from public.meets where data->>'name'='Never Create') then raise exception 'Rejected row left partial data'; end if;
 -- File relays retain explicit cumulative splits without creating individual
 -- lead-offs; retrying the same lineup is an exact duplicate.
 select count(*) into swim_count from public.swims;
 row:=(row-'athlete')||jsonb_build_object('kind','relay','distance',200,'relayName','A','ageGroup','15-16','timeMs',120000,
  'source',(row->'source')||'{"line":88}',
  'members',(select jsonb_agg(jsonb_build_object('leg',leg,'athlete',jsonb_build_object('first','Relay','last','Member '||leg,'gender','F','dob','2010-01-02','memberHash',left(md5('file-relay-member-'||leg),24)))) from generate_series(1,4) leg),
  'splits','[{"distance":50,"cumulativeMs":30000,"lapMs":30000},{"distance":100,"cumulativeMs":60000,"lapMs":30000},{"distance":150,"cumulativeMs":90000,"lapMs":30000},{"distance":200,"cumulativeMs":120000,"lapMs":30000}]'::jsonb,'splitCoverage','complete');
 receipt:=public.import_meet_results(jsonb_build_object('meetId','meet_file_'||md5('file test meet|2026-11-03'),'rows',jsonb_build_array(row,row)));
 if receipt->>'saved'<>'1' or receipt#>>'{outcomes,1,status}'<>'duplicate' then raise exception 'File relay import/retry failed: %',receipt; end if;
 if (select count(*) from public.swims)<>swim_count then raise exception 'Ordinary relay split became an individual result'; end if;
 r:=private.result_record('relay',receipt#>>'{outcomes,0,id}');
 if jsonb_array_length(r->'members')<>4 or jsonb_array_length(r->'splits')<>4 then raise exception 'File relay details lost'; end if;
 -- Direct relay/lineup entry and first-leg changes commit together.
 parent:=public.manage_result_records('{"action":"save","kind":"relay","id":"data-test-relay","version":"new","data":{"id":"data-test-relay","teamId":"velocity-swimming","eventCode":"200_FR-R_SCY","distance":200,"stroke":"FR","course":"SCY","gender":"F","round":"F","status":"OK","timeMs":120000,"timeDisplay":"2:00.00","isOfficial":true,"relayName":"A","ageGroup":"Open","members":[{"leg":1,"athleteId":"data-test-athlete","name":"Direct Entry","gender":"F","stroke":"FR","timeMs":30000,"leadOffEligible":true}],"splits":[],"splitCoverage":"unavailable","meet":{"id":"data-test-meet","name":"Direct Test Meet","date":"2026-11-02"}}}');
 child:=public.manage_result_records('{"action":"save","kind":"swim","id":"data-test-lead","version":"new","data":{"id":"data-test-lead","athleteId":"data-test-athlete","teamId":"velocity-swimming","eventCode":"50_FR_SCY","distance":50,"stroke":"FR","course":"SCY","gender":"F","round":"F","status":"OK","timeMs":30000,"isOfficial":true,"isRelay":false,"ageAtSwim":16,"resultOrigin":"relay_leadoff","parentRelayResultId":"data-test-relay","leadOffVerification":{"verified":true,"flatStart":true,"timingVerified":true,"leadOffStatus":"OK","sourceUrl":"https://example.test/verified-first-leg"},"meet":{"id":"data-test-meet","name":"Direct Test Meet","date":"2026-11-02"}}}');
 version:=parent->>'version';
 parent:=jsonb_set(parent,'{data,members,0,timeMs}','29000');
 child:=jsonb_set(child,'{data,timeMs}','29000');
 r:=public.manage_result_records(jsonb_build_object('action','save','kind','relay','id','data-test-relay','version',version,'data',parent->'data','related',jsonb_build_array(child)));
 set constraints all immediate;
 set constraints all deferred;
 if (select time_ms from public.swims where id='data-test-lead')<>29000 then raise exception 'Linked first-leg correction failed'; end if;
 rejected:=false;
 begin
  perform public.manage_result_records(jsonb_build_object('action','save','kind','relay','id','data-test-relay','version',r->>'version','data',jsonb_set(r->'data','{members,0,timeMs}','28000'),'related',jsonb_build_array(child)));
 exception when serialization_failure then rejected:=true; end;
 if not rejected or (select data#>>'{members,0,timeMs}' from public.relay_results where id='data-test-relay')<>'29000' then raise exception 'Stale linked edit partially committed'; end if;
 -- A previously authorized occurrence remains valid during projection repair;
 -- an untrusted caller still cannot allocate a new manual occurrence.
 perform set_config('request.jwt.claims','{}',true);
 update public.swims set data=data where id='data-test-swim';
 rejected:=false; begin
  perform private.put_record('swims/data-test-untrusted',jsonb_set(changed->'data','{id}','"data-test-untrusted"'));
 exception when others then rejected:=true; end;
 if not rejected then raise exception 'Untrusted manual occurrence was allocated'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
 -- Standards publish their cuts atomically and list APIs remain usable.
 perform public.manage_result_records('{"action":"save","kind":"standard","id":"data-test-standard","version":"new","data":{"id":"data-test-standard","name":"Direct standard","category":"motivational","governingBody":"Team","seasonYears":"2026","effectiveDate":"2026-01-01","expirationDate":"2026-12-31","sourceUrl":"https://example.test/standard","cuts":{"SCY":{"F":{"Open":{"50_FR_SCY":{"cutsByTier":[{"tierName":"A","timeMs":30000}]}}}}}}}');
 if not exists(select 1 from public.standard_cuts where standard_id='data-test-standard') then raise exception 'No standard projection'; end if;
 perform public.manage_result_records('{"action":"list","kind":"swim","parentRelayId":"data-test-relay"}');
 if has_function_privilege('anon','public.manage_result_records(jsonb)','EXECUTE') or has_function_privilege('anon','public.import_meet_results(jsonb)','EXECUTE') then raise exception 'Anonymous mutation grant'; end if;
 if exists(select 1 from private.result_change_log where record_path='swims/'||rid and source->>'sha256' is null) then raise exception 'Lost provenance'; end if;
 select jsonb_agg(to_jsonb(h) order by to_jsonb(h)::text) into board_before from public.team_record_holders h where course='SCY' and event in ('50_FR','100_FR','200_FR-R');
 perform private.refresh_team_records();
 select jsonb_agg(to_jsonb(h) order by to_jsonb(h)::text) into board_after from public.team_record_holders h where course='SCY' and event in ('50_FR','100_FR','200_FR-R');
 if board_before is distinct from board_after then raise exception 'Bounded refresh differs from full board eligibility/ties'; end if;
end;$test$;
rollback;
