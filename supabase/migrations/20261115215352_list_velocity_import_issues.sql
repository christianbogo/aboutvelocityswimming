-- A preview blocker can clear when a linked record is published. Preserve only
-- the last publish validation failure if preflight cannot reproduce an issue.
create or replace function private.velocity_import_current_blocker(issue text, saved_blocker text)
returns text language sql immutable set search_path = '' as $$
  select coalesce(nullif(issue, ''), case
    when issue is null and saved_blocker like 'Publish validation failed.%' then saved_blocker
  end);
$$;

create or replace function private.velocity_import_row_json(
  item private.velocity_import_rows, captured timestamptz, selection_match boolean, issue text
)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', item.id,
    'kind', item.kind,
    'recordId', item.record_id,
    'label', case when item.kind = 'swim' then coalesce(
      case when item.supersedes_id is not null then profile.name end,
      case when jsonb_typeof(item.data->'athleteName') = 'string' then nullif(item.data->>'athleteName', '')
           else nullif(btrim(concat_ws(' ', item.data#>>'{athleteName,first}', item.data#>>'{athleteName,last}')), '') end,
      profile.name,
      (select btrim(concat_ws(' ', x#>>'{data,name,first}', x#>>'{data,name,last}'))
       from jsonb_array_elements(item.prerequisites) x where x->>'kind' = 'athlete' and x->>'id' = item.data->>'athleteId'),
      item.label
    ) when item.kind = 'relay' then coalesce(item.data->>'relayName', item.label) else item.label end,
    'meetId', coalesce(item.data#>>'{meet,id}', item.data->>'canonicalMeetId', case when item.kind = 'meet' then item.record_id end),
    'meetName', coalesce(item.data#>>'{meet,name}', case when item.tab = 'meets' then item.label end),
    'eventCode', item.data->>'eventCode',
    'time', case when item.kind in ('swim','relay') then (item.data->>'timeMs')::bigint end,
    'startsOn', coalesce(item.data->>'startsOn', item.data->>'startDate', item.data#>>'{dates,startDate}', item.data#>>'{meet,date}'),
    'teamName', coalesce(item.data->>'teamName',
      (select data->>'name' from public.teams where id = item.data->>'teamId'),
      (select x#>>'{data,name}' from jsonb_array_elements(item.prerequisites) x where x->>'kind' = 'team' and x->>'id' = item.data->>'teamId')),
    'round', item.data->>'round',
    'course', coalesce(item.data->>'course', split_part(item.data->>'eventCode', '_', 3)),
    'status', item.status,
    'resultStatus', case when item.kind in ('swim','relay') then item.data->>'status' end,
    'blocker', case when item.status = 'pending' then private.velocity_import_current_blocker(issue, item.review_blocker) end,
    'canResolveSwimmerMatch', private.velocity_import_can_match_swimmer(item, issue),
    'batchId', item.batch_id,
    'capturedAt', captured,
    'selected', selection_match
  ) from (select 1) base
  left join lateral (
    select nullif(btrim(concat_ws(' ', a.data#>>'{name,first}', a.data#>>'{name,last}')), '') as name
    from public.public_athletes a where item.kind = 'swim' and a.id = item.data->>'athleteId'
  ) profile on true;
$$;

create or replace function private.velocity_import_summary(
  item private.velocity_import_rows, captured timestamptz, selection_match boolean
)
returns jsonb language sql stable set search_path = '' as $$
  select private.velocity_import_row_json(
    item, captured, selection_match,
    case when item.status = 'pending' then private.velocity_import_issue(item) end
  );
$$;

create or replace function private.velocity_import_issues(input jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  page_from integer := coalesce((input->>'offset')::integer, 0);
  result jsonb;
begin
  if auth.uid() is null or not private.is_staff() then
    raise insufficient_privilege using message = 'Verified staff access required.';
  end if;
  if page_from < 0 then
    raise invalid_parameter_value using message = 'Invalid import issue offset.';
  end if;

  -- Check the current canonical and pending records before paging.
  with checked as materialized (
    select r.id, private.velocity_import_issue(r) as reason
    from private.velocity_import_rows r where r.status = 'pending'
  ), issues as (
    select r.id, c.reason, case
      when private.velocity_import_can_match_swimmer(r, c.reason)
        then r.data#>>'{sourceObservation,memberIdHash}'
    end as match_key
    from checked c join private.velocity_import_rows r on r.id = c.id and r.status = 'pending'
    where private.velocity_import_current_blocker(c.reason, r.review_blocker) is not null
  ), unique_issues as materialized (
    -- Each resolution covers all eligible rows with the same source identity.
    select distinct on (coalesce(match_key, id::text)) id, reason, match_key is not null as can_match
    from issues order by coalesce(match_key, id::text), id
  ), page as (
    select id, reason, can_match from unique_issues order by can_match desc, id limit 30 offset page_from
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(
        private.velocity_import_row_json(r, b.captured_at, false, page.reason)
        || jsonb_build_object('sourceUrl', b.source_url)
        || case when linked.id is not null then
          jsonb_build_object('linkedMeetRow', jsonb_build_object('id', linked.id, 'label', linked.label))
        else '{}'::jsonb end
        order by page.can_match desc, page.id
      )
      from page
      join private.velocity_import_rows r on r.id = page.id
      join private.velocity_import_batches b on b.id = r.batch_id
      left join lateral (
        select (array_agg(parent.id))[1] as id, min(parent.label) as label
        from private.velocity_import_rows parent
        where parent.kind = 'meet'
          and parent.status = 'pending'
          and parent.record_id = coalesce(r.data#>>'{meet,id}', r.data->>'canonicalMeetId')
          and page.reason = 'Select or approve the linked meet (' || parent.record_id || ') first.'
          and private.velocity_import_issue(parent) is null
        having count(*) = 1
      ) linked on true
    ), '[]'::jsonb),
    'total', (select count(*) from unique_issues),
    'hasNext', (select count(*) from unique_issues) > page_from::bigint + 30
  ) into result;
  return result;
end;
$$;

create or replace function public.velocity_import_issues(input jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select private.velocity_import_issues(input);
$$;

revoke all on function
  private.velocity_import_current_blocker(text, text),
  private.velocity_import_row_json(private.velocity_import_rows, timestamptz, boolean, text),
  private.velocity_import_issues(jsonb), public.velocity_import_issues(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.velocity_import_issues(jsonb), public.velocity_import_issues(jsonb)
  to authenticated;
notify pgrst, 'reload schema';
