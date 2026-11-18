-- Keep the audit metadata required by the existing review and correction writers.
create function private.velocity_held_review_metadata(input jsonb, source_url text, note text)
returns jsonb language sql immutable set search_path = '' as $$
  select input || jsonb_build_object(
    'reason', case when length(btrim(input->>'reason')) between 5 and 1000 then input->>'reason' else note end,
    'evidenceUrl', case
      when private.velocity_held_safe_url(input->>'evidenceUrl') then input->>'evidenceUrl'
      when private.velocity_held_safe_url(source_url) then source_url
      else 'https://www.aboutvelocityswimming.com/tools/review/swims'
    end
  );
$$;

create function private.velocity_held_review_decision(input jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  observation private.velocity_held_observations;
begin
  select * into observation from private.velocity_held_observations where id = (input->>'id')::uuid;
  if not found then raise sqlstate 'PT404' using message = 'Held observation was not found.'; end if;
  if input->>'scope' = 'identity' and observation.member_id_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended('velocity-held-swimmer:' || observation.member_id_hash, 0));
  end if;
  return private.velocity_held_record_decision(private.velocity_held_review_metadata(
    input, observation.source_url, case input->>'scope'
      when 'identity' then 'Staff selected the swimmer profile.'
      when 'source' then 'Staff reviewed the meet export.'
      else 'Staff reviewed the observation.'
    end
  ));
end;
$$;

-- Freeze only this source swimmer's observations. Each successful call saves
-- its receipt and advances the job in the same transaction as publication.
create table private.velocity_held_swimmer_approvals (
  decision_id uuid primary key references private.velocity_held_decisions(id),
  observation_ids uuid[] not null,
  checked integer not null default 0,
  approved integer not null default 0,
  already_recorded integer not null default 0,
  still_held integer not null default 0,
  outcomes integer not null default 0
);
alter table private.velocity_held_swimmer_approvals enable row level security;
revoke all on private.velocity_held_swimmer_approvals from public, anon, authenticated, service_role;

create function private.velocity_held_approve_swimmer(input jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  anchor_id uuid := (input->>'id')::uuid;
  request_id uuid := (input->>'requestId')::uuid;
  target_athlete text := input->>'athleteId';
  page_size integer := coalesce((input->>'pageSize')::integer, 40);
  reviewer uuid := auth.uid();
  member_hash text;
  linked_athlete text;
  progress private.velocity_held_swimmer_approvals;
  decision private.velocity_held_decisions;
  page_ids uuid[];
  eligible_ids uuid[] := '{}';
  import_ids uuid[];
  oid uuid;
  observation private.velocity_held_observations;
  assessment private.velocity_held_review;
  evaluation jsonb;
  selection_id uuid;
  published integer := 0;
  recorded_count integer;
  outcome_count integer;
begin
  if request_id is null or coalesce(target_athlete,'') !~ '^[A-Za-z0-9_-]{1,180}$' or page_size not between 1 and 40 then
    raise invalid_parameter_value using message = 'Select a swimmer profile to link and approve.';
  end if;
  select o.member_id_hash into member_hash
  from private.velocity_held_observations o where o.id = anchor_id and o.kind = 'swim';
  if member_hash is null then
    raise invalid_parameter_value using message = 'This observation needs a source swimmer ID to approve a group.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('velocity-held-swimmer:' || member_hash, 0));

  select * into progress from private.velocity_held_swimmer_approvals where decision_id = request_id;
  if found then
    select * into strict decision from private.velocity_held_decisions where id = request_id;
    if decision.member_id_hash is distinct from member_hash or decision.athlete_id is distinct from target_athlete
      or decision.reviewed_by is distinct from reviewer then
      raise sqlstate 'PT409' using message = 'This approval belongs to a different swimmer or reviewer.';
    end if;
  else
    -- Opening the same swimmer again can resume a committed, incomplete run.
    select a.* into progress from private.velocity_held_decisions d
    join private.velocity_held_swimmer_approvals a on a.decision_id = d.id
    where d.scope = 'identity' and d.member_id_hash = member_hash and d.athlete_id = target_athlete
      and d.reviewed_by = reviewer and a.checked < cardinality(a.observation_ids)
    order by d.created_at desc, d.id desc limit 1;
  end if;

  if progress.decision_id is null then
    perform private.velocity_held_review_decision(jsonb_build_object(
      'action', 'decision', 'scope', 'identity', 'id', anchor_id, 'requestId', request_id, 'athleteId', target_athlete
    ));
    select * into strict decision from private.velocity_held_decisions where id = request_id;
    insert into private.velocity_held_swimmer_approvals(decision_id, observation_ids)
    select request_id, array_agg(ids.id order by ids.id) from private.velocity_held_affected(decision) ids(id)
    returning * into progress;
    -- The link writer locks the anchor. Leave the ordered page locks to the
    -- next call so simultaneous observation edits use the same lock order.
  elsif progress.checked < cardinality(progress.observation_ids) then
    select d.athlete_id into linked_athlete from private.velocity_held_decisions d
    where d.scope = 'identity' and d.member_id_hash = member_hash
    order by d.created_at desc, d.id desc limit 1;
    if linked_athlete is distinct from target_athlete then
      raise sqlstate 'PT409' using message = 'The swimmer match changed. Refresh and choose the current profile.';
    end if;

    page_ids := progress.observation_ids[progress.checked + 1 : progress.checked + page_size];
    perform 1 from private.velocity_held_observations where id = any(page_ids) order by id for update;
    perform pg_advisory_xact_lock(hashtext('velocity-records'));
    if not exists(select 1 from public.public_athletes where id = target_athlete)
      or exists(select 1 from private.velocity_import_swimmer_identity_targets(member_hash) t where t.athlete_id <> target_athlete)
    then raise sqlstate 'PT409' using message = 'The swimmer profile is no longer compatible with this source ID.'; end if;

    foreach oid in array page_ids loop
      select * into assessment from private.velocity_held_review where id = oid;
      if assessment.state in ('published','outcome') then continue; end if;
      select * into observation from private.velocity_held_observations where id = oid;
      evaluation := private.velocity_held_evaluate(observation, assessment.record_id);

      if evaluation#>>'{candidate,athleteId}' is distinct from target_athlete and evaluation->>'state' = 'ready' then
        evaluation := evaluation || jsonb_build_object(
          'state','held','blocker','This result has a separate swimmer match. Review the conflicting link.'
        );
      end if;
      if assessment.state <> 'pending' then
        perform private.velocity_held_write_assessment(oid, evaluation);
      end if;
      -- Published-result corrections and unrelated queue entries require their
      -- existing review. A previously staged swim is safe to include only if
      -- the queued facts still match this observation's current candidate.
      if evaluation->>'state' = 'ready' and nullif(evaluation->'current','null') is null
        and (assessment.state <> 'pending' or exists(
          select 1 from private.velocity_import_rows q where q.id = assessment.import_row_id
            and q.kind = 'swim' and q.status = 'pending' and q.prerequisites = '[]'
            and q.supplied_blocker is null and private.velocity_import_same_result(q.data, evaluation->'candidate')
        ))
      then eligible_ids := array_append(eligible_ids, oid); end if;
    end loop;

    if cardinality(eligible_ids) > 0 then
      perform private.velocity_held_submit(jsonb_build_object('ids', eligible_ids));
      select array_agg(distinct q.id) into import_ids from private.velocity_held_assessments a
      join private.velocity_import_rows q on q.id = a.import_row_id
      where a.observation_id = any(eligible_ids) and q.kind = 'swim' and q.status = 'pending'
        and q.data->>'athleteId' = target_athlete and q.prerequisites = '[]' and q.supplied_blocker is null;
      if import_ids is not null then
        selection_id := (private.velocity_import_selection(jsonb_build_object('ids', import_ids))->>'selectionId')::uuid;
        published := (private.approve_velocity_import(selection_id)->>'approved')::integer;
      end if;
    end if;

    select count(*) filter(where state = 'published'), count(*) filter(where state = 'outcome')
      into recorded_count, outcome_count from private.velocity_held_review where id = any(page_ids);
    update private.velocity_held_swimmer_approvals
    set checked = progress.checked + cardinality(page_ids),
        approved = progress.approved + published,
        already_recorded = progress.already_recorded + recorded_count - published,
        still_held = progress.still_held + cardinality(page_ids) - recorded_count - outcome_count,
        outcomes = progress.outcomes + outcome_count
    where decision_id = progress.decision_id returning * into progress;
  end if;

  return jsonb_build_object(
    'requestId', progress.decision_id, 'total', cardinality(progress.observation_ids),
    'checked', progress.checked, 'approved', progress.approved, 'alreadyRecorded', progress.already_recorded,
    'stillHeld', progress.still_held, 'outcomes', progress.outcomes,
    'done', progress.checked = cardinality(progress.observation_ids)
  );
end;
$$;

revoke all on function private.velocity_held_review_metadata(jsonb,text,text),
  private.velocity_held_review_decision(jsonb), private.velocity_held_approve_swimmer(jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.velocity_held_staff(input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  query text := btrim(coalesce(input->>'search',''));
begin
  if auth.uid() is null or not private.is_staff() then
    raise insufficient_privilege using message = 'Verified staff access required.';
  end if;
  case input->>'action'
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
