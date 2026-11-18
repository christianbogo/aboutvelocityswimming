-- Match the source name only within the existing, unique member ID claim.
-- GoMotion's Results by Athletes format appends a one-letter middle initial.
create function private.velocity_gomotion_swimmer_name_basis(
  source_name text, canonical_name text, profile jsonb
) returns text language sql immutable set search_path = '' as $$
  with source_names as (
    select private.velocity_import_normalize_name(
        regexp_replace(source_name, '^([^,]+),([^,]+)$', '\2 \1')) as full_name,
      case when source_name ~ '^[^,]+,[[:space:]]*[^,]+[[:space:]]+[[:alpha:]]\.?[[:space:]]*$'
        then private.velocity_import_normalize_name(regexp_replace(
          source_name, '^([^,]+),[[:space:]]*([^,]+)[[:space:]]+[[:alpha:]]\.?[[:space:]]*$', '\2 \1'))
      end as without_initial
  ), known_names as (
    select private.velocity_import_normalize_name(canonical_name) as value, false as alias
    union all
    select private.velocity_import_normalize_name(private.velocity_held_athlete_name(
      jsonb_build_object('name', a.value))), true
    from jsonb_array_elements(case when jsonb_typeof(profile->'aliases') = 'array'
      then profile->'aliases' else '[]'::jsonb end) a(value)
  )
  select case
    when exists (select 1 from known_names k where not k.alias and nullif(k.value, '') = s.full_name)
      then 'Stable member ID and canonical name'
    when exists (select 1 from known_names k where k.alias and nullif(k.value, '') = s.full_name)
      then 'Stable member ID and verified name alias'
    when exists (select 1 from known_names k where nullif(k.value, '') = s.without_initial)
      -- A profile that explicitly records a different initial keeps that conflict,
      -- even if it also has an alias without its initial.
      and not exists (
        select 1 from regexp_match(private.velocity_import_normalize_name(canonical_name),
          '^(.+) ([[:alpha:]]) (.+)$') parts
        where parts[1] || ' ' || parts[3] = s.without_initial
          and private.velocity_import_normalize_name(canonical_name) is distinct from s.full_name
      ) then 'Stable member ID and name with GoMotion middle initial omitted'
  end
  from source_names s;
$$;

alter function private.velocity_held_evaluate(private.velocity_held_observations, text)
  rename to velocity_held_evaluate_base;

create or replace function private.velocity_official_archive_evaluate(
  source private.velocity_held_observations, previous_record text
)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  normalized private.velocity_held_observations := source;
  evaluated jsonb;
  proposed jsonb;
  name_basis text;
  canonical_name text;
  conflicting_export boolean;
begin
  if source.source_status is distinct from 'OK' then
    return jsonb_build_object('state', 'outcome', 'blocker', case when source.round = 'none'
      then 'No race round was captured.'
      when source.source_status is not null then 'Source outcome: ' || source.source_status || '.'
      else 'The source does not record a timed finish.' end);
  end if;

  if source.observed->>'isOfficial' is null then
    normalized.observed := source.observed || '{"isOfficial":true}'::jsonb;
  end if;

  if source.kind = 'swim' and source.member_id_hash is not null then
    select private.velocity_gomotion_swimmer_name_basis(source.observed->>'name', display.name, a.data), display.name
    into name_basis, canonical_name
    from (
      select min(t.athlete_id) as id from private.velocity_import_swimmer_identity_targets(source.member_id_hash) t
      having count(*) = 1
    ) claim
    join public.athletes a on a.id = claim.id
    join public.public_athletes p on p.id = a.id
    join public.people person on person.id = a.person_id
    cross join lateral (select coalesce(private.velocity_held_athlete_name(p.data), person.name) as name) display;

    if name_basis is not null then
      -- The original workbook name and hold reason stay in the source record.
      normalized.observed := normalized.observed || jsonb_build_object('name', canonical_name);
      if normalized.hold_reason like '%identity has observed conflicts%'
        or normalized.hold_reason like '%separate source ID%' then
        normalized.hold_reason := 'Verified GoMotion swimmer name and member ID';
      end if;
    end if;
  end if;

  evaluated := private.velocity_held_evaluate_base(normalized, previous_record);
  if evaluated->>'state' <> 'ready' or nullif(evaluated->'current', 'null') is not null then
    return evaluated;
  end if;
  proposed := evaluated->'candidate';

  -- Do not choose the winner of a conflicting source occurrence according
  -- to processing order. Compare the source facts in every captured workbook.
  if not (proposed ? 'raceIdentity') and proposed->>'resultOrigin' is distinct from 'relay_leadoff' then
    select exists (
      select 1 from private.velocity_held_observations other
      where other.source_meet_id = source.source_meet_id
        and other.round = source.round and other.kind = source.kind and other.id <> source.id
        and other.source_url = source.source_url
        and other.observed->>'eventCode' = source.observed->>'eventCode'
        and other.observed->>'raceDate' = source.observed->>'raceDate'
        and coalesce(other.observed->>'leadOff', 'false') = coalesce(source.observed->>'leadOff', 'false')
        and case source.kind when 'swim' then other.member_id_hash = source.member_id_hash
          else other.club_code = source.club_code and other.observed->>'relayName' = source.observed->>'relayName'
            and other.observed->>'category' is not distinct from source.observed->>'category'
            and private.velocity_held_age_group(other.observed->>'ageGroup') is not distinct from
                private.velocity_held_age_group(source.observed->>'ageGroup') end
        and row(other.source_status, other.observed->>'timeMs', other.observed->>'category') is distinct from
            row(source.source_status, source.observed->>'timeMs', source.observed->>'category')
    ) into conflicting_export;
    if conflicting_export then
      return jsonb_build_object('state', 'held', 'blocker', 'GoMotion rows disagree about this race occurrence.');
    end if;
  end if;
  if source.hold_reason = 'Existing or reserved race identity differs in result facts' then
    return jsonb_build_object('state', 'held', 'blocker', 'The import audit reports conflicting facts for this race occurrence.');
  end if;
  return evaluated || jsonb_build_object('candidate',
    jsonb_set(proposed, '{sourceObservation}', proposed->'sourceObservation' ||
      jsonb_strip_nulls(jsonb_build_object('officialArchiveAccepted', true, 'swimmerMatchBasis', name_basis))));
end;
$$;

-- Revalidation, manual linking, and submission share the same archive approval.
create function private.velocity_held_evaluate(
  o private.velocity_held_observations, previous_record text default null
) returns jsonb language plpgsql stable set search_path = '' as $$
begin
  if o.source_url = private.velocity_official_archive_source() and exists (
    select 1 from private.velocity_official_archive_acceptances a where a.observation_id = o.id
  ) then
    return private.velocity_official_archive_evaluate(o, previous_record);
  end if;
  return private.velocity_held_evaluate_base(o, previous_record);
end;
$$;

-- Revisit only the accepted GoMotion swimmer holds, preserving their original
-- acceptance receipt. Source rows and existing canonical swims stay intact.
create function private.velocity_reconcile_official_swimmer_page(
  after_id uuid default null, page_size integer default 500
) returns jsonb language plpgsql set search_path = '' as $$
declare
  ids uuid[];
  oid uuid;
  source private.velocity_held_observations;
  assessed private.velocity_held_review;
  evaluation jsonb;
  item private.velocity_import_rows;
  current_swim jsonb;
  rid text;
  published_ids text[] := '{}';
  linked_count integer := 0;
  prior_defer_bests text := coalesce(nullif(current_setting('velocity.defer_bests', true), ''), 'false');
begin
  if page_size is null or page_size not between 1 and 600 then
    raise invalid_parameter_value using message = 'Invalid swimmer reconciliation page size.';
  end if;
  perform pg_advisory_xact_lock(hashtext('velocity-official-gomotion-swimmers'));
  select coalesce(array_agg(next.id order by next.id), '{}') into ids
  from (
    select o.id
    from private.velocity_held_review o
    join private.velocity_official_archive_acceptances a on a.observation_id = o.id
    where (after_id is null or o.id > after_id) and o.source_url = private.velocity_official_archive_source()
      and o.kind = 'swim' and o.source_status = 'OK' and o.member_id_hash is not null and o.state = 'accepted'
      and a.disposition = 'source_only'
      and a.reason in ('Review the swimmer matches and name evidence.', 'Choose a verified canonical swimmer.')
    order by o.id limit page_size
  ) next;
  if cardinality(ids) = 0 then
    return jsonb_build_object('checked', 0, 'published', 0, 'alreadyRecorded', 0, 'stillAccepted', 0,
      'afterId', after_id, 'hasNext', false);
  end if;

  perform 1 from private.velocity_held_observations where id = any(ids) order by id for update;
  perform pg_advisory_xact_lock(hashtext('velocity-records'));
  perform set_config('velocity.defer_bests', 'true', true);
  foreach oid in array ids loop
    select * into strict assessed from private.velocity_held_review v where v.id = oid;
    if assessed.state <> 'accepted' then continue; end if;
    select * into strict source from private.velocity_held_observations o where o.id = oid;
    evaluation := private.velocity_official_archive_evaluate(source, null);
    rid := evaluation->>'recordId';
    if evaluation->>'state' = 'published' and rid is not null then
      select s.data into current_swim from public.swims s where s.id = rid;
      if current_swim is null or current_swim->>'status' is distinct from 'OK'
        or current_swim->>'isOfficial' = 'false' then continue; end if;
      perform private.velocity_held_write_assessment(oid, evaluation);
      linked_count := linked_count + 1;
    elsif evaluation->>'state' = 'ready' and nullif(evaluation->'current', 'null') is null then
      item := null;
      item.id := gen_random_uuid();
      item.kind := 'swim';
      item.record_id := rid;
      item.data := evaluation->'candidate';
      item.prerequisites := '[]';
      if private.velocity_import_issue(item, null, true) is not null then continue; end if;

      begin
        perform private.put_record(private.velocity_import_path('swim', rid), item.data);
        perform private.velocity_held_write_assessment(oid, evaluation ||
          jsonb_build_object('state', 'published', 'current', item.data));
        published_ids := array_append(published_ids, rid);
      exception
        when unique_violation or foreign_key_violation or check_violation or not_null_violation
          or invalid_text_representation or invalid_datetime_format or datetime_field_overflow
          or numeric_value_out_of_range or raise_exception then
          continue;
      end;
    end if;
  end loop;
  perform set_config('velocity.defer_bests', prior_defer_bests, true);
  if cardinality(published_ids) > 0 then perform private.update_bests_after_import(published_ids); end if;

  return jsonb_build_object('checked', cardinality(ids), 'published', cardinality(published_ids),
    'alreadyRecorded', linked_count, 'stillAccepted', cardinality(ids) - cardinality(published_ids) - linked_count,
    'afterId', ids[cardinality(ids)], 'hasNext', cardinality(ids) = page_size);
end;
$$;

revoke all on function private.velocity_gomotion_swimmer_name_basis(text,text,jsonb),
  private.velocity_held_evaluate(private.velocity_held_observations,text),
  private.velocity_reconcile_official_swimmer_page(uuid,integer)
  from public, anon, authenticated, service_role;
