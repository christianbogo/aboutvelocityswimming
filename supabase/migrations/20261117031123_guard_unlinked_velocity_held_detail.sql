-- Unlinked archive observations have no canonical snapshot to look up.
-- A null path would fall through to the generic app_records view.
create or replace function private.velocity_held_detail(oid uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  item private.velocity_held_review;
  source private.velocity_held_observations;
  decisions jsonb;
  evaluated jsonb;
  current_data jsonb;
  canonical_id text;
begin
  select * into item from private.velocity_held_review o where o.id = oid;
  if item.id is null then raise sqlstate 'PT404' using message = 'Held observation was not found.'; end if;
  select * into source from private.velocity_held_observations o where o.id = oid;
  evaluated := private.velocity_held_evaluate(source, item.record_id);
  canonical_id := coalesce(item.record_id, evaluated->>'recordId');
  if canonical_id is not null then
    current_data := private.collection_snapshot(private.velocity_import_path(item.kind, canonical_id));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,'scope',d.scope,'reason',d.reason,'evidenceUrl',d.evidence_url,'createdAt',d.created_at,
    'reviewerId',d.reviewed_by,'patch',d.patch,'eventCode',d.event_code,'round',d.round,'affected',d.affected,
    'athleteId',d.athlete_id,'meetId',d.meet_id,'reviewedAffiliation',d.reviewed_affiliation
  ) order by d.created_at desc, d.id desc), '[]') into decisions
  from (
    select x.* from private.velocity_held_decisions x
    where (x.observation_id = oid or x.member_id_hash = source.member_id_hash
      or (x.source_meet_id = source.source_meet_id and x.workbook_sha256 = source.workbook_sha256))
      and private.velocity_held_applies(x, source)
    order by x.created_at desc, x.id desc limit 100
  ) d;
  return private.velocity_held_json(item) || jsonb_build_object(
    'candidate', evaluated->'candidate', 'current', current_data, 'decisions', decisions,
    'recordId', canonical_id,
    'blocker', case when item.state <> 'pending' then coalesce(evaluated->>'blocker', item.blocker) end
  );
end;
$$;
