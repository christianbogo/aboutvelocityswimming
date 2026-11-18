-- Route staff edits to a published result through the existing batch review.
create function private.velocity_held_stage_correction(
  worker_id uuid, kind text, record_id text, expected jsonb, replacement jsonb,
  source_url text, review_note text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  record_path text;
  current_record jsonb;
  writes jsonb;
  reads jsonb;
  evidence jsonb;
  baseline_revision bigint;
  batch_fingerprint text;
  batch_id uuid;
begin
  if not private.is_staff() then
    raise insufficient_privilege using message = 'Verified staff access required.';
  end if;
  if coalesce(kind, '') not in ('swim', 'relay')
    or coalesce(record_id, '') !~ '^[a-zA-Z0-9_-]{1,180}$'
    or jsonb_typeof(expected) is distinct from 'object'
    or jsonb_typeof(replacement) is distinct from 'object'
    or replacement->>'id' is distinct from record_id
    or replacement->>'teamId' is distinct from 'velocity-swimming'
    or replacement->>'status' is distinct from 'OK'
    or replacement->'isOfficial' is distinct from 'true'::jsonb
    or coalesce(source_url, '') !~ '^https://[^[:space:]]+$'
    or length(source_url) > 2048
    or not coalesce(length(btrim(review_note)) between 1 and 4000, false)
    or pg_column_size(expected) + pg_column_size(replacement) > 1900000
  then raise invalid_parameter_value using message = 'A correction requires a verified result and source evidence.'; end if;

  if not exists (
    select 1 from private.collection_workers w
    where w.id = velocity_held_stage_correction.worker_id and 'times' = any(w.divisions)
  ) then raise insufficient_privilege using message = 'The archived source is outside Times.'; end if;

  record_path := case when kind = 'swim' then 'swims/' else 'relay_results/' end || record_id;
  perform pg_advisory_xact_lock(hashtext('velocity-records'));
  current_record := private.collection_snapshot(record_path);
  if current_record is distinct from expected then
    raise serialization_failure using message = 'The published result changed. Refresh before submitting a correction.';
  end if;
  if current_record = replacement then
    raise invalid_parameter_value using message = 'The published result already has these details.';
  end if;
  if current_record->'externalResult' is distinct from replacement->'externalResult'
    or current_record#>'{sourceObservation,memberIdHash}' is distinct from replacement#>'{sourceObservation,memberIdHash}'
  then raise invalid_parameter_value using message = 'A correction must preserve the published source identity.'; end if;

  if private.result_identity_base(kind, current_record) is distinct from private.result_identity_base(kind, replacement) then
    replacement := replacement || jsonb_build_object('raceIdentity', jsonb_build_object(
      'occurrence', coalesce(current_record#>>'{raceIdentity,occurrence}', 'single'),
      'reviewed', true, 'basis', btrim(review_note), 'sourceUrl', source_url
    ));
  elsif current_record->'raceIdentity' is distinct from replacement->'raceIdentity' then
    raise invalid_parameter_value using message = 'Keep the current occurrence evidence when editing result details.';
  end if;

  select revision into strict baseline_revision from private.canonical_revision where singleton;
  writes := jsonb_build_array(jsonb_build_object('path', record_path, 'after', replacement));
  reads := jsonb_build_array(jsonb_build_object('path', record_path, 'before', current_record));
  evidence := jsonb_build_object('method', 'Held observation correction', 'reason', btrim(review_note), 'submittedBy', auth.uid());
  batch_fingerprint := encode(extensions.digest(
    jsonb_build_array('held-result-correction', baseline_revision, source_url, btrim(review_note), writes, reads)::text,
    'sha256'
  ), 'hex');
  insert into public.collection_batches (
    division, scope, source_url, captured_at, coverage, evidence, writes, reads,
    fingerprint, worker_id, canonical_revision
  ) values (
    'times', 'Held observation correction for ' || record_id, source_url, now(), 'partial',
    evidence, writes, reads, batch_fingerprint, worker_id, baseline_revision
  )
  on conflict (fingerprint) do nothing returning id into batch_id;
  if batch_id is null then
    select b.id into strict batch_id from public.collection_batches b where b.fingerprint = batch_fingerprint;
  end if;
  return batch_id;
end;
$$;

revoke all on function private.velocity_held_stage_correction(uuid, text, text, jsonb, jsonb, text, text)
  from public, anon, authenticated, service_role;
