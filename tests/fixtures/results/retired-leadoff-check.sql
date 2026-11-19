
do $$ declare original jsonb; changed jsonb; rid text; begin
 select id,data into rid,original from public.swims where data->>'resultOrigin'='relay_leadoff' and parent_relay_result_id is null limit 1;
 if rid is null then raise exception 'Missing published lead-off fixture'; end if;
 changed:=original||'{"ageAtSwim":16}';
 perform private.put_record('swims/'||rid,changed);
 if not private.retained_source_leadoff(changed) then raise exception 'Age edit lost eligibility'; end if;
 if private.retained_source_leadoff(changed||'{"timeMs":1}') then raise exception 'Changed time retained old attestation'; end if;
 if private.retained_source_leadoff(changed||'{"athleteId":"someone-else"}') then raise exception 'Changed swimmer retained attestation'; end if;
 if not exists(select 1 from private.retained_result_sources where record_path='swims/'||rid) then raise exception 'Missing linked evidence'; end if;
 perform private.read_result_moderation('swim',rid);
end; $$;
