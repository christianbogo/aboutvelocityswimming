-- Accept the unaltered GoMotion evidence separately from its canonical Times result.
create table private.velocity_official_archive_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default clock_timestamp(),
  started_by uuid references auth.users(id) on delete set null,
  started_via text not null check (started_via in ('staff', 'database operator')),
  completed_at timestamptz,
  observation_ids uuid[] not null check (cardinality(observation_ids) > 0),
  processed integer not null default 0,
  published integer not null default 0,
  already_recorded integer not null default 0,
  source_only integer not null default 0,
  check (processed = published + already_recorded + source_only and processed <= cardinality(observation_ids))
);

create table private.velocity_official_archive_acceptances (
  observation_id uuid primary key references private.velocity_held_observations(id),
  run_id uuid not null references private.velocity_official_archive_runs(id),
  disposition text not null check (disposition in ('published', 'already_recorded', 'source_only')),
  record_id text,
  reason text,
  check ((disposition = 'source_only') = (record_id is null)),
  check ((disposition = 'source_only') = (reason is not null))
);

create index velocity_official_archive_acceptances_run_idx
  on private.velocity_official_archive_acceptances(run_id);

alter table private.velocity_official_archive_runs enable row level security;
alter table private.velocity_official_archive_acceptances enable row level security;
revoke all on private.velocity_official_archive_runs, private.velocity_official_archive_acceptances
  from public, anon, authenticated, service_role;

create or replace view private.velocity_held_review as
select o.*, coalesce(accepted.reason, a.blocker) as blocker, a.candidate, a.current_data,
  coalesce(a.record_id, accepted.record_id) as record_id, a.import_row_id, a.correction_batch_id,
  coalesce(b.id, q.batch_id) as review_batch_id,
  case
    when b.status in ('pending', 'held') or q.status = 'pending' then 'pending'
    when b.status = 'approved' or q.status in ('approved', 'duplicate') then 'published'
    when accepted.record_id is not null and case o.kind
      when 'swim' then exists (select 1 from public.swims s where s.id = accepted.record_id)
      else exists (select 1 from public.relay_results r where r.id = accepted.record_id) end then 'published'
    when a.state in ('published', 'ready') then a.state
    when accepted.observation_id is not null then 'accepted'
    when a.state is not null then a.state
    when o.source_status in ('DQ', 'DFS', 'NS', 'DNF', 'SCR') or o.round = 'none' then 'outcome'
    else 'held'
  end as state
from private.velocity_held_observations o
left join private.velocity_held_assessments a on a.observation_id = o.id
left join private.velocity_import_rows q on q.id = a.import_row_id
left join public.collection_batches b on b.id = a.correction_batch_id
left join private.velocity_official_archive_acceptances accepted on accepted.observation_id = o.id;

create function private.velocity_official_archive_source()
returns text language sql immutable set search_path = '' as $$
  select 'https://www.gomotionapp.com/team/ievs/controller/cms/admin/index'::text
$$;

create function private.velocity_official_archive_receipt(
  job private.velocity_official_archive_runs, new_results integer default 0
)
returns jsonb language sql stable set search_path = '' as $$
  select case when job.id is not null then jsonb_build_object(
    'total', cardinality(job.observation_ids), 'accepted', job.processed, 'published', job.published,
    'alreadyRecorded', job.already_recorded, 'sourceOnly', job.source_only,
    'completed', job.completed_at is not null, 'publishedThisChunk', new_results
  ) end;
$$;

-- The official-source approval can supply trust when competitive status was
-- omitted. It does not supply missing facts, change a recorded outcome or
-- override contradictions with another export or an existing canonical record.
create function private.velocity_official_archive_evaluate(
  source private.velocity_held_observations, previous_record text
)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  normalized private.velocity_held_observations := source;
  evaluated jsonb;
  proposed jsonb;
  can_use_member_name boolean;
  conflicting_export boolean;
begin
  if source.source_status is distinct from 'OK' then
    return jsonb_build_object('blocker', case when source.round = 'none'
      then 'No race round was captured.'
      when source.source_status is not null then 'Source outcome: ' || source.source_status || '.'
      else 'The source does not record a timed finish.' end);
  end if;

  if source.observed->>'isOfficial' is null then
    normalized.observed := source.observed || '{"isOfficial":true}'::jsonb;
  end if;

  if source.kind = 'swim' and source.member_id_hash is not null and (
    source.hold_reason like '%identity has observed conflicts%' or source.hold_reason like '%separate source ID%'
  ) then
    select exists (
      select 1 from private.velocity_import_swimmer_identity_targets(source.member_id_hash) t
      join public.athletes a on a.id = t.athlete_id
      join public.public_athletes p on p.id = a.id
      join public.people person on person.id = a.person_id
      where nullif(private.velocity_import_normalize_name(regexp_replace(source.observed->>'name',
        '^([^,]+),([^,]+)$', '\2 \1')), '') =
        private.velocity_import_normalize_name(coalesce(private.velocity_held_athlete_name(p.data), person.name))
    ) into can_use_member_name;
    -- The shared evaluator also requires exactly one stable claim and rejects
    -- contradictory links, even when one of the matching names agrees.
    if can_use_member_name then normalized.hold_reason := 'Exact source swimmer ID and name match'; end if;
  end if;

  evaluated := private.velocity_held_evaluate(normalized, previous_record);
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
      return jsonb_build_object('blocker', 'GoMotion rows disagree about this race occurrence.');
    end if;
  end if;
  if source.hold_reason = 'Existing or reserved race identity differs in result facts' then
    return jsonb_build_object('blocker', 'The import audit reports conflicting facts for this race occurrence.');
  end if;
  return evaluated || jsonb_build_object('candidate',
    jsonb_set(proposed, '{sourceObservation,officialArchiveAccepted}', 'true'));
end;
$$;

-- Calls commit one small slice. The fixed snapshot and durable per-observation
-- receipt make retries and reopening the page safe.
create function private.velocity_accept_official_archive(page_size integer default 160)
returns jsonb language plpgsql set search_path = '' as $$
declare
  job private.velocity_official_archive_runs;
  official_url constant text := private.velocity_official_archive_source();
  ids uuid[];
  oid uuid;
  source private.velocity_held_observations;
  assessed private.velocity_held_review;
  evaluation jsonb;
  body jsonb;
  rid text;
  canonical jsonb;
  reason text;
  outcome text;
  import_row private.velocity_import_rows;
  published_count integer := 0;
  linked_count integer := 0;
  source_count integer := 0;
  new_swims text[] := '{}';
  defer_previous text := coalesce(nullif(current_setting('velocity.defer_bests', true), ''), 'false');
begin
  if page_size not between 1 and 600 then
    raise invalid_parameter_value using message = 'Invalid official archive page size.';
  end if;
  perform pg_advisory_xact_lock(hashtext('velocity-official-gomotion-archive'));
  select * into job from private.velocity_official_archive_runs
  order by started_at desc, id desc limit 1;
  if job.id is null or job.completed_at is not null then
    select array_agg(o.id order by o.id) into ids
    from private.velocity_held_observations o where o.source_url = official_url
      and not exists (select 1 from private.velocity_official_archive_acceptances a where a.observation_id = o.id);
    if ids is null then
      return coalesce(private.velocity_official_archive_receipt(job),
        '{"total":0,"accepted":0,"published":0,"alreadyRecorded":0,"sourceOnly":0,"completed":true,"publishedThisChunk":0}'::jsonb);
    end if;
    insert into private.velocity_official_archive_runs(observation_ids, started_by, started_via)
    values (ids, auth.uid(), case when auth.uid() is null then 'database operator' else 'staff' end)
    returning * into job;
  end if;

  ids := job.observation_ids[job.processed + 1 : job.processed + page_size];
  perform 1 from private.velocity_held_observations where id = any(ids) order by id for update;
  perform pg_advisory_xact_lock(hashtext('velocity-records'));
  perform set_config('velocity.defer_bests', 'true', true);
  foreach oid in array ids loop
    select * into strict source from private.velocity_held_observations o where o.id = oid;
    select * into strict assessed from private.velocity_held_review v where v.id = oid;
    rid := null;
    reason := null;
    outcome := 'source_only';

    if assessed.state = 'published' and assessed.record_id is not null and
      private.collection_snapshot(private.velocity_import_path(source.kind, assessed.record_id)) is not null then
      rid := assessed.record_id;
      outcome := 'already_recorded';
    elsif assessed.state = 'pending' then
      reason := 'This observation has a separate pending import or correction.';
    else
      evaluation := private.velocity_official_archive_evaluate(source, assessed.record_id);
      rid := evaluation->>'recordId';
      if evaluation->>'state' = 'published' and rid is not null then
        canonical := private.collection_snapshot(private.velocity_import_path(source.kind, rid));
        if canonical is not null and canonical->>'isOfficial' is distinct from 'false' then
          outcome := 'already_recorded';
        else
          reason := 'The matching canonical result is missing or marked unofficial.';
        end if;
      elsif evaluation->>'state' = 'ready' and nullif(evaluation->'current', 'null') is null then
        body := evaluation->'candidate';
        import_row := null;
        import_row.id := gen_random_uuid();
        import_row.kind := source.kind;
        import_row.record_id := rid;
        import_row.data := body;
        import_row.prerequisites := '[]';
        reason := private.velocity_import_issue(import_row, null, true);
        if reason is null then
          begin
            perform private.put_record(private.velocity_import_path(source.kind, rid), body);
            outcome := 'published';
            if source.kind = 'swim' then new_swims := array_append(new_swims, rid); end if;
          exception
            when unique_violation or foreign_key_violation or check_violation or not_null_violation
              or invalid_text_representation or invalid_datetime_format or datetime_field_overflow
              or numeric_value_out_of_range or raise_exception then
              reason := 'Canonical validation: ' || left(sqlerrm, 350);
          end;
        end if;
      else
        reason := coalesce(evaluation->>'blocker',
          'This observation would require changing an existing result or supplying additional race facts.');
      end if;
    end if;

    insert into private.velocity_official_archive_acceptances (observation_id, run_id, disposition, record_id, reason)
    values (oid, job.id, outcome, case when outcome <> 'source_only' then rid end,
      case when outcome = 'source_only' then coalesce(nullif(reason, ''), 'A canonical occurrence needs a separate match.') end);
    case outcome
      when 'published' then published_count := published_count + 1;
      when 'already_recorded' then linked_count := linked_count + 1;
      else source_count := source_count + 1;
    end case;
  end loop;
  perform set_config('velocity.defer_bests', defer_previous, true);
  if cardinality(new_swims) > 0 then perform private.update_bests_after_import(new_swims); end if;

  update private.velocity_official_archive_runs r set
    processed = r.processed + cardinality(ids), published = r.published + published_count,
    already_recorded = r.already_recorded + linked_count, source_only = r.source_only + source_count,
    completed_at = case when r.processed + cardinality(ids) = cardinality(r.observation_ids) then clock_timestamp() end
  where r.id = job.id returning * into job;
  return private.velocity_official_archive_receipt(job, published_count);
end;
$$;

create function private.velocity_official_archive_status()
returns jsonb language sql stable set search_path = '' as $$
  select private.velocity_official_archive_receipt(r) || jsonb_build_object('hasUnaccepted', exists (
    select 1 from private.velocity_held_observations o
    where o.source_url = private.velocity_official_archive_source()
      and not exists (select 1 from private.velocity_official_archive_acceptances a where a.observation_id = o.id)
  ))
  from private.velocity_official_archive_runs r order by r.started_at desc, r.id desc limit 1;
$$;

revoke all on function private.velocity_official_archive_source(),
  private.velocity_official_archive_receipt(private.velocity_official_archive_runs, integer),
  private.velocity_official_archive_evaluate(private.velocity_held_observations, text),
  private.velocity_accept_official_archive(integer), private.velocity_official_archive_status()
  from public, anon, authenticated, service_role;

create or replace function private.velocity_held_list(input jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  page_offset integer := coalesce((input->>'offset')::integer, 0);
  grouping text := input->>'groupBy';
  search text := nullif(lower(btrim(input->>'search')), '');
  desired_state text := nullif(input->>'status','');
  result jsonb;
begin
  if page_offset not between 0 and 100000 or length(search) > 200
    or (grouping is not null and grouping not in ('identity','event'))
    or (desired_state is not null and desired_state not in ('held','ready','published','pending','outcome','accepted')) then
    raise invalid_parameter_value using message = 'Invalid held-observation filters.';
  end if;
  with filtered as materialized (
    select o.id, o.observed->>'name' as captured_name, o.observed->>'meetName' as meet_name,
      o.observed->>'eventCode' as event_code, o.member_id_hash, o.source_meet_id, o.round, o.state, o.hold_reason
    from private.velocity_held_review o
    where (nullif(input->>'kind','') is null or o.kind = input->>'kind')
      and (nullif(input->>'clubCode','') is null or o.club_code = input->>'clubCode')
      and (nullif(input->>'memberIdHash','') is null or o.member_id_hash = input->>'memberIdHash')
      and (nullif(input->>'sourceMeetId','') is null or o.source_meet_id = input->>'sourceMeetId')
      and (nullif(input->>'workbookSha256','') is null or o.workbook_sha256 = input->>'workbookSha256')
      and (nullif(input->>'eventCode','') is null or o.observed->>'eventCode' = input->>'eventCode')
      and (nullif(input->>'round','') is null or o.round = input->>'round')
      and (nullif(input->>'recordId','') is null or o.record_id = input->>'recordId')
      and (search is null or strpos(lower(concat_ws(' ', o.observed->>'name', o.observed->>'relayName',
        o.observed->>'meetName', o.observed->>'eventCode', o.source_meet_id, o.club_code, o.hold_reason, o.record_id)), search) > 0)
  ), matches as materialized (
    select * from filtered where desired_state is null or state = desired_state
  ), grouped as materialized (
    select count(*) as n, min(id::text) as anchor, min(captured_name) as label, member_id_hash,
      null::text as source_meet_id, null::text as event_code, null::text as round
    from matches where grouping = 'identity' and member_id_hash is not null and hold_reason in (
      'Unverified name variants disagree with the canonical swimmer profile',
      'Stable swimmer identity has observed conflicts',
      'A canonical profile or separate source ID may refer to this swimmer',
      'Captured swimmer name differs from the matching member profile'
    )
    group by member_id_hash
    union all
    select count(*), min(id::text), min(meet_name), null::text, source_meet_id, event_code, round
    from matches where grouping = 'event' and event_code is not null and round <> 'none'
    group by source_meet_id, event_code, round
  ), rows_page as (
    select id from matches where grouping is null order by id limit 40 offset page_offset
  ), groups_page as (
    select * from grouped order by n desc, label, anchor limit 40 offset page_offset
  ), totals as (
    select case when grouping is null then (select count(*) from matches) else (select count(*) from grouped) end as n
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(private.velocity_held_json(o) order by p.id)
      from rows_page p join private.velocity_held_review o using (id)
    ), '[]'),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('count', g.n,'anchorId', g.anchor,'label',g.label,'memberIdHash',g.member_id_hash,
        'sourceMeetId',g.source_meet_id,'eventCode',g.event_code,'round',g.round) order by g.n desc,g.label,g.anchor)
      from groups_page g
    ), '[]'),
    'total', t.n, 'hasNext', t.n > page_offset + 40,
    'counts', (select jsonb_build_object(
      'held', count(*) filter(where state = 'held'), 'ready', count(*) filter(where state = 'ready'),
      'published', count(*) filter(where state = 'published'), 'pending', count(*) filter(where state = 'pending'),
      'outcome', count(*) filter(where state = 'outcome'), 'accepted', count(*) filter(where state = 'accepted')
    ) from filtered)
  ) into result from totals t;
  return result;
end;
$$;

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
    'blocker', case when item.state = 'accepted' then item.blocker
      when item.state not in ('pending', 'published') then coalesce(evaluated->>'blocker', item.blocker) end
  );
end;
$$;


create or replace function private.velocity_held_staff(input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  query text := btrim(coalesce(input->>'search',''));
begin
  if auth.uid() is null or not private.is_staff() then
    raise insufficient_privilege using message = 'Verified staff access required.';
  end if;
  case input->>'action'
    when 'officialArchiveStatus' then return private.velocity_official_archive_status();
    when 'acceptOfficialArchive' then return private.velocity_accept_official_archive();
    when 'list' then return private.velocity_held_list(input);
    when 'detail' then return private.velocity_held_detail((input->>'id')::uuid);
    when 'decision' then return private.velocity_held_review_decision(input);
    when 'linkAndApproveSwimmer' then return private.velocity_held_approve_swimmer(input);
    when 'revalidate' then return private.velocity_held_refresh((input->>'afterId')::uuid, 100, (input->>'decisionId')::uuid);
    when 'scan' then return private.velocity_held_refresh((input->>'afterId')::uuid, 100);
    when 'submit' then return private.velocity_held_submit(input);
    when 'record' then return private.velocity_held_published_detail(input, false);
    when 'correction' then return private.velocity_held_published_detail(private.velocity_held_review_metadata(
      input, coalesce(input#>>'{expected,sourceObservation,sourceUrl}', input#>>'{expected,sourceUrl}'),
      'Staff updated the published result details.'
    ), true);
    when 'athletes' then
      if length(query) not between 1 and 200 then return jsonb_build_object('rows','[]'::jsonb); end if;
      return (
        select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object('id', a.id,
          'label',a.label,'category',a.category) order by a.label,a.id), '[]')) from (
          select a.id, private.velocity_held_athlete_name(a.data) label, a.data->>'gender' category
          from public.public_athletes a where a.id = query
            or strpos(lower(private.velocity_held_athlete_name(a.data)), lower(query)) > 0
          order by label, a.id limit 25
        ) a
      );
    when 'meets' then
      if length(query) not between 1 and 200 then return jsonb_build_object('rows','[]'::jsonb); end if;
      return (
        select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object('id', m.id,
          'label',m.label,'startsOn',m.starts_on) order by m.starts_on desc,m.label,m.id), '[]')) from (
          select m.id, m.data->>'name' label, coalesce(m.data->>'startsOn',m.data->>'startDate') starts_on
          from public.meets m where m.id = query
            or strpos(lower(m.data->>'name'), lower(query)) > 0
          order by starts_on desc, label, m.id limit 25
        ) m
      );
    else raise invalid_parameter_value using message = 'Unknown held observation action.';
  end case;
end;
$$;

notify pgrst, 'reload schema';
