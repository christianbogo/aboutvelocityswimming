-- Import approval only adds races. Keep the existing bests for untouched
-- athlete/events and recompute rankings only in buckets the additions can affect.
create index athlete_bests_event_idx on public.athlete_bests(event_code);

create view private.velocity_rankable_swims with (security_invoker = true) as
select s.id, s.athlete_id, s.event_code, s.course, s.time_ms,
  s.data->>'gender' as gender, s.data#>>'{meet,date}' as race_date, s.data
from private.unflagged_swims s
where s.status = 'OK'
  and coalesce(s.data->>'isSplit', 'false') = 'false'
  and coalesce(s.data->>'isRelaySplit', 'false') = 'false'
  and coalesce(s.data->>'isOfficial', 'true') = 'true'
  and (coalesce(s.data->>'isRelay', 'false') = 'false'
    or s.data#>>'{relay,isLeadOffFlatStart}' = 'true');

create function private.update_bests_after_import(published_ids text[])
returns void language sql set search_path = '' set work_mem = '32MB' as $$
  with additions as materialized (
    select s.athlete_id, s.event_code, s.course, s.gender,
      a.data->>'status' = 'active' as active
    from private.velocity_rankable_swims s join public.athletes a on a.id = s.athlete_id
    where s.id = any(published_ids)
  ), changed_bests as materialized (
    select pair.athlete_id, pair.event_code, pair.active,
      winner.id, winner.course, winner.gender, winner.time_ms, winner.race_date, winner.data,
      previous.athlete_id is not null as had_previous,
      previous.data->>'course' as previous_course, previous.data->>'gender' as previous_gender
    from (select distinct athlete_id, event_code, active from additions) pair
    cross join lateral (
      select s.id, s.course, s.gender, s.time_ms, s.race_date, s.data
      from private.velocity_rankable_swims s
      where s.athlete_id = pair.athlete_id and s.event_code = pair.event_code
      order by s.time_ms, s.race_date, s.id limit 1
    ) winner
    left join public.athlete_bests previous on previous.athlete_id = pair.athlete_id
      and previous.event_code = pair.event_code
    where previous.data->>'swimId' is distinct from winner.id
  ), active_buckets as materialized (
    -- An active athlete can contribute a historical category minimum even
    -- when their single personal best is in a different category.
    select event_code, course, gender from additions where active and gender is not null
    union
    select event_code, course, gender from changed_bests where active and gender is not null
  ), affected_buckets as materialized (
    select event_code, course, gender from active_buckets
    union
    select event_code, course, gender from changed_bests
    union
    select event_code, previous_course, previous_gender from changed_bests where had_previous
  ), existing_keys as materialized (
    select b.athlete_id, b.event_code, b.data->>'course' as course, b.data->>'gender' as gender,
      (b.data->>'bestTimeMs')::integer as time_ms, b.data->'clubRankAllTime' as previous_all_rank,
      b.data->'clubRankActiveRoster' as previous_active_rank
    from public.athlete_bests b
    where b.event_code in (select event_code from affected_buckets)
    and not exists (
      select 1 from changed_bests changed
      where changed.athlete_id = b.athlete_id and changed.event_code = b.event_code
    )
  ), best_keys as materialized (
    select b.*, false as changed
    from existing_keys b
    join affected_buckets bucket on bucket.event_code = b.event_code
      and bucket.course is not distinct from b.course and bucket.gender is not distinct from b.gender
    union all
    select athlete_id, event_code, course, gender, time_ms, null::jsonb, null::jsonb, true
    from changed_bests
  ), active_minima as (
    -- Look up only active athletes' history in buckets whose active rank can change.
    select events.event_code, minimum.course, minimum.gender, minimum.time_ms
    from (select distinct event_code from active_buckets) events
    cross join (select id from public.athletes where data->>'status' = 'active') a
    cross join lateral (
      select s.course, s.gender, min(s.time_ms) as time_ms
      from private.velocity_rankable_swims s
      join active_buckets bucket on bucket.event_code = s.event_code
        and bucket.course = s.course and bucket.gender = s.gender
      where s.athlete_id = a.id and s.event_code = events.event_code
      group by s.course, s.gender
    ) minimum
  ), active_thresholds as (
    select event_code, course, gender, time_ms, sum(contribution) as contribution
    from (
      select event_code, course, gender, time_ms, count(*) as contribution
      from active_minima group by event_code, course, gender, time_ms
      union all
      select b.event_code, b.course, b.gender, b.time_ms, 0::bigint
      from best_keys b join active_buckets bucket on bucket.event_code = b.event_code
        and bucket.course = b.course and bucket.gender = b.gender
      group by b.event_code, b.course, b.gender, b.time_ms
    ) thresholds group by event_code, course, gender, time_ms
  ), active_ranks as (
    select event_code, course, gender, time_ms,
      coalesce(sum(contribution) over (partition by event_code, course, gender order by time_ms
        rows between unbounded preceding and 1 preceding), 0) + 1 as position
    from active_thresholds
  ), ranked as materialized (
    select b.*,
      to_jsonb(rank() over (partition by b.event_code, b.course, b.gender order by b.time_ms)) as all_rank,
      case
        when a.data->>'status' is distinct from 'active' then 'null'::jsonb
        when bucket.event_code is not null or b.changed then to_jsonb(coalesce(r.position, 1))
        else b.previous_active_rank
      end as active_rank
    from best_keys b join public.athletes a on a.id = b.athlete_id
    left join active_buckets bucket on bucket.event_code = b.event_code
      and bucket.course = b.course and bucket.gender = b.gender
    left join active_ranks r on r.event_code = b.event_code and r.course = b.course
      and r.gender = b.gender and r.time_ms = b.time_ms
  ), updated_ranks as (
    update public.athlete_bests existing
    set data = existing.data || jsonb_build_object('clubRankAllTime', r.all_rank, 'clubRankActiveRoster', r.active_rank)
    from ranked r
    where not r.changed and existing.athlete_id = r.athlete_id and existing.event_code = r.event_code
      and (r.all_rank is distinct from r.previous_all_rank or r.active_rank is distinct from r.previous_active_rank)
  )
  insert into public.athlete_bests (athlete_id, event_code, data)
  select b.athlete_id, b.event_code, jsonb_build_object(
    'eventCode', b.event_code, 'distance', b.data->'distance', 'stroke', b.data->'stroke', 'course', b.course,
    'gender', b.gender, 'bestTimeMs', b.time_ms, 'bestTimeDisplay', private.format_time(b.time_ms),
    'swimDate', b.race_date, 'meetName', b.data#>>'{meet,name}', 'swimId', b.id,
    'standard', coalesce(b.data#>>'{standardsTag,usasMotivational}', ''), 'ageWhenSwum', b.data->'ageAtSwim',
    'clubRankAllTime', r.all_rank, 'clubRankActiveRoster', r.active_rank)
  from changed_bests b join ranked r using (athlete_id, event_code)
  on conflict (athlete_id, event_code) do update set data = excluded.data;
$$;

revoke all on private.velocity_rankable_swims from public, anon, authenticated, service_role;
revoke all on function private.update_bests_after_import(text[]) from public, anon, authenticated, service_role;

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
  if cardinality(published_swim_ids) > 0 then
    perform private.update_bests_after_import(published_swim_ids);
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
