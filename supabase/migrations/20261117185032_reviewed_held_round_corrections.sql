-- A reviewed round belongs to the row decision, not the immutable source row.
-- Keep source approval lookup scoped to the original export round. Only the
-- evaluated race identity and its relay parent use the verified round.
-- Guard every edit so a changed prerequisite cannot silently weaken validation.
do $migration$
declare
  change record;
  definition text;
begin
  for change in select * from (values
    ('private.velocity_held_record_decision(jsonb)',
      $before$'athleteId','meetId','raceDate','eventCode','category','timeMs'$before$,
      $after$'athleteId','meetId','raceDate','eventCode','round','category','timeMs'$after$),
    ('private.velocity_held_record_decision(jsonb)',
      $before$  or (patch ? 'members' and jsonb_typeof(patch->'members') <> 'array')$before$,
      $after$  or (patch ? 'round' and (decision_scope <> 'row'
    or jsonb_typeof(patch->'round') is distinct from 'string'
    or patch->>'round' not in ('F','P','S','TT')))
  or (patch ? 'members' and jsonb_typeof(patch->'members') <> 'array')$after$),
    ('private.velocity_held_evaluate_base(private.velocity_held_observations,text)',
      $before$  race_date text;$before$,
      $after$  race_date text;
  effective_round text;$after$),
    ('private.velocity_held_evaluate_base(private.velocity_held_observations,text)',
      $before$  patch := coalesce(row_review.patch, '{}');$before$,
      $after$  patch := coalesce(row_review.patch, '{}');
  effective_round := coalesce(patch->>'round', o.round);
  if effective_round not in ('F','P','S','TT')
    or (patch ? 'round' and jsonb_typeof(patch->'round') is distinct from 'string') then
    return jsonb_build_object('state','held','blocker','Verify the recorded race round.');
  end if;$after$),
    ('private.velocity_held_evaluate_base(private.velocity_held_observations,text)',
      $before$and not (o.round = 'F' and coalesce(o.observed->>'awardedFinalPlace', '')$before$,
      $after$and not (effective_round = 'F' and coalesce(o.observed->>'awardedFinalPlace', '')$after$),
    ('private.velocity_held_evaluate_base(private.velocity_held_observations,text)',
      $before$(o.round in ('S','TT') and occurrence = 'single')$before$,
      $after$(effective_round in ('S','TT') and occurrence = 'single')$after$),
    ('private.velocity_held_evaluate_base(private.velocity_held_observations,text)',
      $before$    'round', o.round,$before$,
      $after$    'round', effective_round,$after$),
    ('private.velocity_held_evaluate_base(private.velocity_held_observations,text)',
      $before$      or parent_data#>>'{meet,date}' is distinct from race_date$before$,
      $after$      or parent_data#>>'{meet,date}' is distinct from race_date
      or parent_data->>'round' is distinct from effective_round$after$),
    ('private.velocity_held_evaluate_base(private.velocity_held_observations,text)',
      $before$    if patch ? 'category' then corrections := corrections || jsonb_build_object('gender', category); end if;$before$,
      $after$    if patch ? 'category' then corrections := corrections || jsonb_build_object('gender', category); end if;
    if patch ? 'round' then corrections := corrections || jsonb_build_object('round', effective_round); end if;$after$),
    ('private.velocity_official_archive_evaluate(private.velocity_held_observations,text)',
      $before$  if not (proposed ? 'raceIdentity') and proposed->>'resultOrigin' is distinct from 'relay_leadoff' then$before$,
      $after$  -- A reviewed change of round resolves the old export occurrence;
  -- canonical duplicate and conflicting-result checks still ran in the base.
  if proposed->>'round' is not distinct from source.round
    and not (proposed ? 'raceIdentity') and proposed->>'resultOrigin' is distinct from 'relay_leadoff' then$after$),
    ('private.velocity_official_archive_evaluate(private.velocity_held_observations,text)',
      $before$  if source.hold_reason = 'Existing or reserved race identity differs in result facts' then$before$,
      $after$  if source.hold_reason = 'Existing or reserved race identity differs in result facts'
    and proposed->>'round' is not distinct from source.round then$after$)
  ) as changes(signature, before_text, after_text)
  loop
    definition := pg_get_functiondef(change.signature::regprocedure);
    if (length(definition) - length(replace(definition, change.before_text, '')))
      / length(change.before_text) <> 1 then
      raise exception 'Expected one reviewed-round edit in %: %', change.signature, change.before_text;
    end if;
    execute replace(definition, change.before_text, change.after_text);
  end loop;
end;
$migration$;
