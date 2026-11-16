alter table private.velocity_import_selections
  add column approval_batch_size smallint not null default 100
  check (approval_batch_size between 1 and 100);

create or replace function private.approve_velocity_import_selection(selection_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  reviewer uuid := auth.uid();
  sid uuid := selection_id;
  batch_size integer;
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
  select s.approval_batch_size into batch_size
  from private.velocity_import_selections s
  where s.id = sid and s.reviewer_id = reviewer and s.previewed
  for update;
  if not found then raise sqlstate 'PT404' using message = 'Import selection was not found.'; end if;
  update private.velocity_import_selections set started_at = coalesce(started_at, now()) where id = sid;
  perform pg_advisory_xact_lock(hashtext('velocity-records'));
  perform set_config('velocity.defer_bests', 'true', true);

  for selected_row in
    with next_rows as materialized (
      select sr.row_id, sr.sort_order from private.velocity_import_selection_rows sr
      where sr.selection_id = sid and sr.outcome is null
      order by sr.sort_order, sr.row_id limit batch_size
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

-- A timed out chunk rolls back as a unit. Lower the next limit separately so
-- the same saved selection can continue after that rollback.
create function private.reduce_velocity_import_approval_batch(selection_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  reviewer uuid := auth.uid();
  next_batch_size integer;
begin
  if reviewer is null or not private.is_staff() then
    raise insufficient_privilege using message = 'Verified staff access required.';
  end if;

  update private.velocity_import_selections s
  set approval_batch_size = greatest(1, s.approval_batch_size / 2)
  where s.id = selection_id and s.reviewer_id = reviewer and s.previewed
    and s.row_count > s.approved_count + s.duplicate_count + s.blocked_count
    and s.approval_batch_size > 1
  returning s.approval_batch_size into next_batch_size;
  return next_batch_size;
end;
$$;

create function public.reduce_velocity_import_approval_batch(selection_id uuid)
returns integer language sql set search_path = '' as $$
  select private.reduce_velocity_import_approval_batch(selection_id);
$$;

revoke all on function private.reduce_velocity_import_approval_batch(uuid),
  public.reduce_velocity_import_approval_batch(uuid) from public, anon, authenticated, service_role;
grant execute on function private.reduce_velocity_import_approval_batch(uuid),
  public.reduce_velocity_import_approval_batch(uuid) to authenticated;
notify pgrst, 'reload schema';
