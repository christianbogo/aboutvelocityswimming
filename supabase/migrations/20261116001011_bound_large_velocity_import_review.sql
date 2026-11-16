-- Supply the exact Issues check's canonical key scan without reading every
-- published swim's JSON payload from the heap.
create index if not exists velocity_import_published_swim_keys_idx
  on public.swims (id) include (athlete_id, meet_id, event_code);

-- Keep only ranking keys for historical swims. Fetch complete result JSON
-- only for the athletes' winning results when updating best times.
CREATE OR REPLACE FUNCTION private.rebuild_bests_for_events(event_codes text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
-- Eligibility expressions can be severely underestimated on imported history.
-- Keep those estimates from multiplying full materialized relations in loops.
-- This planner setting is restored automatically when the function exits.
SET search_path TO '' SET work_mem TO '64MB' SET enable_nestloop TO 'off' AS $function$
begin
 with eligible as materialized (
  select s.id, s.athlete_id, s.event_code, s.course, s.time_ms,
   s.data->>'gender' as gender, s.data#>>'{meet,date}' as race_date,
   a.data->>'status'='active' as active
  from public.swims s join public.athletes a on a.id=s.athlete_id
  where s.event_code=any(event_codes) and s.status='OK' and coalesce(s.data->>'isSplit','false')='false'
   and coalesce(s.data->>'isRelaySplit','false')='false'
   and coalesce(s.data->>'isOfficial','true')='true'
   and (coalesce(s.data->>'isRelay','false')='false' or s.data#>>'{relay,isLeadOffFlatStart}'='true')
   and not exists(select 1 from public.result_moderation m where m.result_type='swim' and m.result_id=s.id and m.flagged)
   and not exists(select 1 from public.result_moderation m where m.result_type='relay' and m.result_id=s.data->>'parentRelayResultId' and m.flagged)
 ), bests as materialized (
  select distinct on(athlete_id,event_code) * from eligible
  order by athlete_id,event_code,time_ms,race_date,id
 ), active_minima as (
  -- The legacy rank counts each active athlete once for every historical
  -- event/course/gender bucket, even when that athlete's selected PB differs.
  select athlete_id,event_code,course,gender,min(time_ms) as time_ms
  from eligible where active
  group by athlete_id,event_code,course,gender
 ), thresholds as (
  select event_code,course,gender,time_ms,sum(contribution) as contribution
  from (
   select event_code,course,gender,time_ms,count(*) as contribution
   from active_minima group by event_code,course,gender,time_ms
   union all
   select event_code,course,gender,time_ms,0::bigint
   from bests where active group by event_code,course,gender,time_ms
  ) points group by event_code,course,gender,time_ms
 ), active_ranks as (
  select event_code,course,gender,time_ms,
   coalesce(sum(contribution) over(partition by event_code,course,gender order by time_ms
    rows between unbounded preceding and 1 preceding),0)+1 as position
  from thresholds
 ), saved as (
  insert into public.athlete_bests as existing(athlete_id,event_code,data)
  select b.athlete_id,b.event_code,jsonb_build_object(
   'eventCode',b.event_code,'distance',winner.data->'distance','stroke',winner.data->'stroke','course',b.course,
   'gender',b.gender,'bestTimeMs',b.time_ms,'bestTimeDisplay',private.format_time(b.time_ms),
   'swimDate',b.race_date,'meetName',winner.data#>>'{meet,name}','swimId',b.id,
   'standard',coalesce(winner.data#>>'{standardsTag,usasMotivational}',''),'ageWhenSwum',winner.data->'ageAtSwim',
   'clubRankAllTime',rank() over(partition by b.event_code,b.course,b.gender order by b.time_ms),
   'clubRankActiveRoster',case when b.active then coalesce(r.position,1) else null end)
  from bests b
  cross join lateral (select s.data from public.swims s where s.id=b.id limit 1) winner
  left join active_ranks r on r.event_code=b.event_code and r.course=b.course
   and r.gender=b.gender and r.time_ms=b.time_ms
  on conflict(athlete_id,event_code) do update set data=excluded.data
  where existing.data is distinct from excluded.data
  returning athlete_id,event_code
 )
 delete from public.athlete_bests old
 where old.event_code=any(event_codes) and not exists(select 1 from bests b where b.athlete_id=old.athlete_id and b.event_code=old.event_code);
end; $function$;

create or replace function private.approve_velocity_import_selection(selection_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  reviewer uuid := auth.uid();
  sid uuid := selection_id;
  selected_row record;
  item private.velocity_import_rows;
  reason text;
  linked jsonb;
  linked_data jsonb;
  item_outcome text;
  published integer := 0;
  duplicates integer := 0;
  blocked integer := 0;
  published_swim_ids text[] := '{}';
  event_codes text[];
  receipt jsonb;
begin
  if reviewer is null or not private.is_staff() then raise insufficient_privilege using message = 'Verified staff access required.'; end if;
  perform 1 from private.velocity_import_selections s where s.id = sid and s.reviewer_id = reviewer and s.previewed for update;
  if not found then raise sqlstate 'PT404' using message = 'Import selection was not found.'; end if;
  update private.velocity_import_selections set started_at = coalesce(started_at, now()) where id = sid;
  perform pg_advisory_xact_lock(hashtext('velocity-records'));
  perform set_config('velocity.defer_bests', 'true', true);

  for selected_row in
    with next_rows as materialized (
      select sr.row_id, sr.sort_order from private.velocity_import_selection_rows sr
      where sr.selection_id = sid and sr.outcome is null
      order by sr.sort_order, sr.row_id limit 100
    )
    select r as item, sr.preview_blocker from next_rows n
    join private.velocity_import_selection_rows sr on sr.selection_id = sid and sr.row_id = n.row_id
    join private.velocity_import_rows r on r.id = n.row_id
    order by n.sort_order, n.row_id for update of sr, r
  loop
    item := selected_row.item;
    if item.status <> 'pending' then
      item_outcome := 'duplicate';
      reason := null;
    else
      reason := coalesce(selected_row.preview_blocker, private.velocity_import_issue(item, sid, true));
      item_outcome := case when reason = '' then 'duplicate' when reason is not null then 'blocked' else 'approved' end;
      if item_outcome = 'approved' then
        -- Row-level data failures must not publish its prerequisites or abort
        -- unrelated selections. Infrastructure errors roll back the chunk.
        begin
          for linked in
            select value from jsonb_array_elements(item.prerequisites)
            order by case value->>'kind' when 'team' then 1 when 'venue' then 2 else 3 end, value->>'id'
          loop
            if private.collection_snapshot(private.velocity_import_path(linked->>'kind', linked->>'id')) is null then
              linked_data := linked->'data' || jsonb_build_object('id', linked->>'id');
              if linked->>'kind' = 'athlete' then
                linked_data := linked_data || jsonb_build_object('currentGroup', jsonb_build_object(
                  'id', 'unassigned', 'name', coalesce(
                    (select name from public.training_groups where id = 'unassigned'), 'No Assignment')
                ));
              end if;
              perform private.put_record(private.velocity_import_path(linked->>'kind', linked->>'id'), linked_data);
            end if;
          end loop;
          perform private.put_record(private.velocity_import_path(item.kind, item.record_id), item.data);
        exception
          when unique_violation or foreign_key_violation or check_violation or not_null_violation
            or invalid_text_representation or invalid_datetime_format or datetime_field_overflow
            or numeric_value_out_of_range or raise_exception then
            item_outcome := 'blocked';
            reason := 'Publish validation failed. ' || left(sqlerrm, 400);
        end;
        if item_outcome = 'approved' then
          published := published + 1;
          if item.kind = 'swim' then published_swim_ids := array_append(published_swim_ids, item.record_id); end if;
        end if;
      end if;
      if item_outcome = 'blocked' then
        update private.velocity_import_rows set review_blocker = reason where id = item.id;
      else
        update private.velocity_import_rows set status = item_outcome, review_blocker = null,
          reviewed_by = reviewer, reviewed_at = now() where id = item.id;
      end if;
    end if;
    if item_outcome = 'blocked' then blocked := blocked + 1; end if;
    if item_outcome = 'duplicate' then duplicates := duplicates + 1; end if;
    update private.velocity_import_selection_rows sr set outcome = item_outcome
    where sr.selection_id = sid and sr.row_id = item.id;
  end loop;

  perform set_config('velocity.defer_bests', 'false', true);
  -- An eligible best ahead of the new swim in the same ranking bucket
  -- already contributes that athlete to the bucket's active standings.
  -- Other cases may change the best or ranks and need a rebuild.
  event_codes := array(
    select distinct s.event_code
    from public.swims s
    where s.id = any(published_swim_ids) and s.status = 'OK'
      and not exists (
        select 1 from public.athlete_bests b
        join public.swims winner on winner.id = b.data->>'swimId'
        where b.athlete_id = s.athlete_id and b.event_code = s.event_code
          and winner.athlete_id = s.athlete_id and winner.event_code = s.event_code
          and winner.status = 'OK' and winner.course = s.course
          and winner.data->>'gender' is not distinct from s.data->>'gender'
          and coalesce(winner.data->>'isSplit', 'false') = 'false'
          and coalesce(winner.data->>'isRelaySplit', 'false') = 'false'
          and coalesce(winner.data->>'isOfficial', 'true') = 'true'
          and (coalesce(winner.data->>'isRelay', 'false') = 'false'
            or winner.data#>>'{relay,isLeadOffFlatStart}' = 'true')
          and not exists (
            select 1 from public.result_moderation m
            where m.flagged and ((m.result_type = 'swim' and m.result_id = winner.id)
              or (m.result_type = 'relay' and m.result_id = winner.data->>'parentRelayResultId'))
          )
          and (winner.time_ms, winner.data#>>'{meet,date}', winner.id)
            <= (s.time_ms, s.data#>>'{meet,date}', s.id)
      )
  );
  if cardinality(event_codes) > 0 then
    perform private.rebuild_bests_for_events(event_codes);
  end if;
  update private.velocity_import_selections s set approved_count = s.approved_count + published,
    duplicate_count = s.duplicate_count + duplicates, blocked_count = s.blocked_count + blocked
  where s.id = sid returning jsonb_build_object(
    'selected', s.row_count, 'approved', s.approved_count, 'duplicates', s.duplicate_count, 'blocked', s.blocked_count,
    'remaining', s.row_count - s.approved_count - s.duplicate_count - s.blocked_count,
    'done', s.row_count = s.approved_count + s.duplicate_count + s.blocked_count,
    'published', published
  ) into receipt;
  return receipt;
end;
$$;

-- Keep approval chunks transactional, with an RPC budget for cold best-time rebuilds.
alter function public.approve_velocity_import(uuid) set statement_timeout = '30s';

-- Match only the fields needed by the queue and selection snapshot. The full
-- staged JSON can exceed work_mem when the SQL function returns every match.

create or replace function private.velocity_import_match_ids(query_tab text, query_search text, query_batch uuid)
returns table(id uuid, kind text) language sql stable set search_path = '' as $$
  select r.id, r.kind from private.velocity_import_rows r
  where r.status = 'pending' and r.tab = query_tab
    and (query_batch is null or r.batch_id = query_batch)
    and (coalesce(query_search, '') = '' or strpos(lower(
      concat_ws(' ', r.label, r.record_id, r.data#>>'{meet,name}', r.data#>>'{meet,id}', r.data->>'eventCode', r.data->>'teamName',
        (select concat_ws(' ', a.data#>>'{name,first}', a.data#>>'{name,last}')
         from public.public_athletes a where a.id = r.data->>'athleteId'),
        (select concat_ws(' ', p#>>'{data,name,first}', p#>>'{data,name,last}')
         from jsonb_array_elements(r.prerequisites) p where p->>'kind' = 'athlete' and p->>'id' = r.data->>'athleteId'))
    ), lower(query_search)) > 0);
$$;

revoke all on function private.velocity_import_match_ids(text, text, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.velocity_import_queue(input jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  page_from integer := coalesce((input->>'offset')::integer, 0);
  page_tab text := input->>'kind';
  source_batch uuid := (input->>'batchId')::uuid;
  search text := btrim(input->>'search');
  only_selected boolean := coalesce((input->>'onlySelected')::boolean, false);
  ids uuid[];
  result jsonb;
begin
  if auth.uid() is null or not private.is_staff() then raise insufficient_privilege using message = 'Verified staff access required.'; end if;
  if page_tab is null or page_tab not in ('meets','swims') or page_from < 0 or length(search) > 200 then
    raise invalid_parameter_value using message = 'Invalid import queue filters.';
  end if;
  select array(select value::uuid from jsonb_array_elements_text(coalesce(input->'selectionIds', '[]'))) into ids;
  if cardinality(ids) > 10 then raise invalid_parameter_value using message = 'Too many selections.'; end if;

  with selected as materialized (
    select sr.row_id, sr.preview_blocker from private.velocity_import_selections s
    join private.velocity_import_selection_rows sr on sr.selection_id = s.id
    where s.reviewer_id = auth.uid() and s.id = any(ids)
  ), matches as materialized (
    select r.id from private.velocity_import_match_ids(page_tab, search, source_batch) r
    where not only_selected or exists(select 1 from selected where row_id = r.id)
  ), page as materialized (
    select id from matches order by id limit 30 offset page_from
  )
  select jsonb_build_object('rows', coalesce((
    select jsonb_agg(private.velocity_import_summary(r, b.captured_at, exists(select 1 from selected where row_id = r.id))
      || case when only_selected then jsonb_build_object('blocker', (
        select min(preview_blocker) from selected where row_id = r.id
      )) else '{}'::jsonb end order by r.id)
    from page join private.velocity_import_rows r on r.id = page.id join private.velocity_import_batches b on b.id = r.batch_id
  ), '[]'), 'total', (select count(*) from matches),
    'hasNext', (select count(*) from matches) > page_from + 30) into result;
  return result;
end;
$$;

create or replace function private.velocity_import_selection(input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  reviewer uuid := auth.uid();
  sid uuid;
  ids uuid[];
  excluded uuid[];
  previous uuid[];
  filter jsonb;
  match_tab text;
  match_search text;
  match_batch uuid;
  selection_filters jsonb := coalesce(input->'matches', '[]');
  should_preview boolean := coalesce((input->>'preview')::boolean, true);
  selected_count integer;
  selected_meets integer;
begin
  if reviewer is null or not private.is_staff() then raise insufficient_privilege using message = 'Verified staff access required.'; end if;
  if input ? 'prepareSelectionId' then
    return private.velocity_import_prepare_selection((input->>'prepareSelectionId')::uuid);
  end if;
  if jsonb_typeof(selection_filters) is distinct from 'array' or jsonb_array_length(selection_filters) > 2 then
    raise invalid_parameter_value using message = 'Select at most two import filters.';
  end if;
  select array(select value::uuid from jsonb_array_elements_text(coalesce(input->'ids', '[]'))) into ids;
  select array(select value::uuid from jsonb_array_elements_text(coalesce(input->'excludeIds', '[]'))) into excluded;
  select array(select value::uuid from jsonb_array_elements_text(coalesce(input->'selectionIds', '[]'))) into previous;
  if cardinality(ids) > 5000 or cardinality(excluded) > 5000 or cardinality(previous) > 10 then
    raise invalid_parameter_value using message = 'Too many explicit IDs in this selection. Use Select all matching.';
  end if;
  if exists (
    select 1 from unnest(previous) requested
    where not exists(select 1 from private.velocity_import_selections where id = requested and reviewer_id = reviewer)
  ) then raise sqlstate 'PT404' using message = 'An import selection is unavailable. Select the rows again.'; end if;

  delete from private.velocity_import_selections s
  where s.reviewer_id = reviewer and s.started_at is null and s.created_at < now() - interval '1 day'
    and not (s.id = any(previous));
  insert into private.velocity_import_selections(reviewer_id, preview_required) values (reviewer, should_preview) returning id into sid;

  insert into private.velocity_import_selection_rows(selection_id, row_id, sort_order)
  select sid, r.id, private.velocity_import_sort(r.kind) from private.velocity_import_rows r
  where r.id in (
    select unnest(ids)
    union all
    select row_id from private.velocity_import_selection_rows where selection_id = any(previous)
  ) and r.status = 'pending' and not (r.id = any(excluded));
  for filter in select value from jsonb_array_elements(selection_filters) loop
    match_tab := filter->>'kind';
    match_search := btrim(filter->>'search');
    match_batch := (filter->>'batchId')::uuid;
    if match_tab is null or match_tab not in ('meets','swims') or length(match_search) > 200 then
      raise invalid_parameter_value using message = 'Invalid select-all filter.';
    end if;
    insert into private.velocity_import_selection_rows(selection_id, row_id, sort_order)
    select sid, r.id, private.velocity_import_sort(r.kind) from private.velocity_import_match_ids(match_tab, match_search, match_batch) r
    where not (r.id = any(excluded)) on conflict do nothing;
  end loop;

  select count(*), count(*) filter (where sr.sort_order <= 2) into selected_count, selected_meets
  from private.velocity_import_selection_rows sr where sr.selection_id = sid;
  update private.velocity_import_selections set row_count = selected_count, meet_count = selected_meets where id = sid;
  return private.velocity_import_prepare_selection(sid);
end;
$$;

-- Freezing a large selection writes one membership row per match. Keep its
-- transaction atomic and give the public RPC a bounded runtime.

alter function public.velocity_import_selection(jsonb) set statement_timeout to '30s';

notify pgrst, 'reload schema';
