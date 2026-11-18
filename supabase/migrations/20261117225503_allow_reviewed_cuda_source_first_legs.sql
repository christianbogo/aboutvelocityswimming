-- Historical Barracuda source first legs use the existing official-source
-- proof only after an explicit row-level historical-affiliation review.
-- Keep every source, timing, swimmer, meet, occurrence and duplicate check.
do $migration$
declare
  definition text;
  before_text text := $before$    or source.club_code is distinct from 'VS' or source.member_id_hash is null$before$;
  after_text text := $after$    or not (source.club_code is not distinct from 'VS'
      or (source.club_code is not distinct from 'CUDA' and decision.reviewed_affiliation is true))
    or source.member_id_hash is null$after$;
begin
  definition := pg_get_functiondef('private.velocity_official_source_leadoff(jsonb)'::regprocedure);
  if (length(definition) - length(replace(definition, before_text, ''))) / length(before_text) <> 1 then
    raise exception 'Expected one official-source club eligibility guard';
  end if;
  execute replace(definition, before_text, after_text);
end;
$migration$;

revoke all on function private.velocity_official_source_leadoff(jsonb)
  from public, anon, authenticated, service_role;
