-- Preserve immediate structural validation, but allow a reviewed parent/child
-- correction to satisfy the cross-record invariant at the end of its batch.
create function private.check_relay_leadoff_children()
returns trigger language plpgsql set search_path = '' as $$
declare
  parent_data jsonb;
  parent_lead public.swims;
begin
  -- A deferred event must check the final row, not an earlier NEW image.
  select data into parent_data from public.relay_results where id = new.id;
  if parent_data is null then return null; end if;
  for parent_lead in select * from public.swims where parent_relay_result_id = new.id loop
    if parent_lead.course is distinct from parent_data->>'course'
      or parent_lead.data->>'teamId' is distinct from parent_data->>'teamId'
      or parent_lead.meet_id is distinct from parent_data#>>'{meet,id}'
      or parent_lead.event_code is distinct from ((parent_data->>'distance')::integer/4)::text||'_'||
        (case when split_part(parent_data->>'eventCode','_',2)='MED-R' then 'BK' else 'FR' end)||'_'||(parent_data->>'course')
      or not exists(select 1 from jsonb_array_elements(parent_data->'members') m
        where m->>'leg'='1' and m->>'athleteId'=parent_lead.athlete_id
          and (m->>'timeMs' is null or (m->>'timeMs')::integer=parent_lead.time_ms)) then
      raise exception 'Correct or remove the verified lead-off before changing its relay member';
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function private.check_relay_leadoff_children() from public, anon, authenticated, service_role;

create constraint trigger relay_leadoff_children_consistent
after insert or update on public.relay_results
deferrable initially immediate
for each row execute function private.check_relay_leadoff_children();

do $migration$
declare
  change record;
  definition text;
begin
  for change in select * from (values
    ('private.validate_relay_result()',
      $before$ -- A lineup correction cannot detach an already verified lead-off result.
 for parent_lead in select * from public.swims where parent_relay_result_id = new.id loop
  if parent_lead.course is distinct from new.data->>'course'
   or parent_lead.data->>'teamId' is distinct from new.data->>'teamId'
   or parent_lead.meet_id is distinct from new.data#>>'{meet,id}'
   or parent_lead.event_code is distinct from ((new.data->>'distance')::integer/4)::text||'_'||(case when split_part(new.data->>'eventCode','_',2)='MED-R' then 'BK' else 'FR' end)||'_'||(new.data->>'course')
   or not exists(select 1 from jsonb_array_elements(new.data->'members') m where m->>'leg'='1' and m->>'athleteId'=parent_lead.athlete_id and (m->>'timeMs' is null or (m->>'timeMs')::integer=parent_lead.time_ms)) then
   raise exception 'Correct or remove the verified lead-off before changing its relay member';
  end if;
 end loop;$before$,
      $after$ -- Cross-record lead-off consistency is checked by the deferrable
 -- relay_leadoff_children_consistent constraint. Structural checks stay here.$after$),
    ('private.validate_relay_result()',
      $before$; parent_lead public.swims;$before$,
      $after$;$after$),
    ('private.review_collection(uuid,text,text)',
      $before$  perform set_config('velocity.defer_bests','true',true);$before$,
      $after$  set constraints public.relay_leadoff_children_consistent deferred;
  perform set_config('velocity.defer_bests','true',true);$after$),
    ('private.review_collection(uuid,text,text)',
      $before$  perform set_config('velocity.defer_bests','false',true);$before$,
      $after$  -- Reject an invalid final graph before rebuilding best times or
  -- recording a successful approval. Ordinary writers remain immediate.
  set constraints public.relay_leadoff_children_consistent immediate;
  perform set_config('velocity.defer_bests','false',true);$after$)
  ) as changes(signature, before_text, after_text)
  loop
    definition := pg_get_functiondef(change.signature::regprocedure);
    if (length(definition) - length(replace(definition, change.before_text, '')))
      / length(change.before_text) <> 1 then
      raise exception 'Expected one relay-consistency edit in %: %', change.signature, change.before_text;
    end if;
    execute replace(definition, change.before_text, change.after_text);
  end loop;
end;
$migration$;
