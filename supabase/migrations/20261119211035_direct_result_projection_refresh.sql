-- Keep synchronous saves proportional to affected events. Derive the bounded
-- refresh from the current board algorithm so its eligibility/tie rules stay
-- identical, including reviewed historical relay age groups.
do $$ declare definition text; original text; begin
 original:=pg_get_functiondef('private.refresh_team_records()'::regprocedure);
 definition:=replace(original,'private.refresh_team_records()','private.refresh_result_record_events(event_codes text[])');
 definition:=replace(definition,'if not pg_try_advisory_xact_lock(hashtext(''velocity-team-record-refresh'')) then return false; end if;',
  'if coalesce(cardinality(event_codes),0)=0 then return false; end if; perform pg_advisory_xact_lock(hashtext(''velocity-team-record-refresh''));');
 definition:=replace(definition,'select array_agg(transaction_id) into consumed from private.team_record_refresh_queue;','');
 definition:=replace(definition,'if consumed is null then return false; end if;','');
 definition:=replace(definition,'delete from public.team_record_holders where true;',
  'delete from public.team_record_holders h where (h.event,h.course) in (select split_part(code,''_'',1)||''_''||split_part(code,''_'',2),split_part(code,''_'',3) from unnest(event_codes) code);');
 definition:=replace(definition,'where s.times_status=''OK''',
  'where (s.times_event,s.times_course) in (select split_part(code,''_'',1)||''_''||split_part(code,''_'',2),split_part(code,''_'',3) from unnest(event_codes) code) and s.times_status=''OK''');
 definition:=replace(definition,'where s.data->>''status''=''OK''',
  'where (s.times_event,s.times_course) in (select split_part(code,''_'',1)||''_''||split_part(code,''_'',2),split_part(code,''_'',3) from unnest(event_codes) code) and s.data->>''status''=''OK''');
 -- A targeted refresh must not consume other queued work or claim that the
 -- whole board was refreshed. The existing cron still handles that queue.
 definition:=replace(definition,'update public.team_record_refresh_state set refreshed_at=clock_timestamp() where id;','');
 definition:=replace(definition,'delete from private.team_record_refresh_queue where transaction_id=any(consumed);','');
 if definition=original or position('where s.times_status=''OK''' in definition)>0
  or position('where s.data->>''status''=''OK''' in definition)>0
  or position('delete from public.team_record_holders where true;' in definition)>0
  or position('if consumed is null' in definition)>0 then raise exception 'Unexpected board refresh definition'; end if;
 execute definition;
 definition:=pg_get_functiondef('private.save_result_record(text,text,jsonb,text,jsonb)'::regprocedure);
 definition:=replace(definition,'if kind=''swim'' then events:=','if kind in (''swim'',''relay'') then events:=');
 definition:=replace(definition,'select array_agg(distinct event_code) into events from public.swims where athlete_id=rid;',
  'select array_agg(distinct event_code) into events from (select event_code from public.swims where athlete_id=rid union select event_code from public.relay_results where data->''members'' @> jsonb_build_array(jsonb_build_object(''athleteId'',rid))) affected;');
 definition:=replace(definition,'if kind in (''swim'',''relay'',''athlete'') then perform pg_advisory_xact_lock(hashtext(''velocity-team-record-refresh'')); perform private.refresh_team_records(); end if;',
  'if cardinality(events)>0 then perform private.refresh_result_record_events(events); end if;');
 if position('perform private.refresh_team_records()' in definition)>0 then raise exception 'Unexpected save refresh'; end if;
 execute definition;
 definition:=pg_get_functiondef('public.import_meet_results(jsonb)'::regprocedure);
 definition:=replace(definition,'if row->>''kind''=''swim'' then changed_events:=array_append(changed_events,code); end if;',
  'changed_events:=array_append(changed_events,code);');
 definition:=replace(definition,'if imported>0 then perform pg_advisory_xact_lock(hashtext(''velocity-team-record-refresh'')); perform private.refresh_team_records(); end if;',
  'if imported>0 then perform private.refresh_result_record_events(array(select distinct unnest(changed_events))); end if;');
 if position('perform private.refresh_team_records()' in definition)>0 then raise exception 'Unexpected import refresh'; end if;
 execute definition;
end $$;
revoke all on function private.refresh_result_record_events(text[]) from public,anon,authenticated,service_role;
-- A bounded owner batch can touch several events. Do not widen role-wide limits.
alter function public.manage_result_records(jsonb) set statement_timeout='45s';
alter function public.import_meet_results(jsonb) set statement_timeout='45s';
notify pgrst,'reload schema';
