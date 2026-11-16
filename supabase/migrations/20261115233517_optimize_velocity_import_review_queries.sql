-- Relay publication must check protected lead-offs through the existing index.
-- The generated column uses the same predicate as the previous JSON lookup.
create or replace function private.validate_relay_result() returns trigger language plpgsql set search_path='' as $$
declare member jsonb; legs integer[]:='{}'; athlete_links text[]:='{}'; parent_lead public.swims;
begin
 if coalesce(new.data->>'course','') not in ('SCY','SCM','LCM') or coalesce(new.data->>'gender','') not in ('F','M','X')
  or coalesce(new.data->>'eventCode','') !~ '^[0-9]+_(FR-R|MED-R)_(SCY|SCM|LCM)$'
  or new.data->>'id' is distinct from new.id
  or coalesce(new.data->>'stroke','')<>(case when split_part(new.data->>'eventCode','_',2)='MED-R' then 'IM' else 'FR' end)
  or coalesce(new.data->>'round','') not in ('F','P','S','TT')
  or nullif(trim(new.data->>'relayName'),'') is null
  or split_part(new.data->>'eventCode','_',3)<>new.data->>'course'
  or coalesce(new.data->>'status','') not in ('OK','DQ','DFS','NS')
  or jsonb_typeof(new.data->'timeMs') is distinct from 'number' or coalesce(new.data->>'timeMs','') !~ '^[0-9]{1,9}$'
  or (new.data->>'status'='OK' and (new.data->>'timeMs')::bigint<=0)
  or jsonb_typeof(new.data->'isOfficial') is distinct from 'boolean'
  or jsonb_typeof(new.data->'distance') is distinct from 'number' or coalesce(new.data->>'distance','') !~ '^(100|200|400|800)$'
  or split_part(new.data->>'eventCode','_',1)<>new.data->>'distance'
  or jsonb_typeof(new.data->'members') is distinct from 'array' or jsonb_array_length(new.data->'members')>4
  or coalesce(new.data->>'splitCoverage','') not in ('complete','partial','unavailable') then raise exception 'Invalid relay result'; end if;
 if exists(select 1 from public.swims where id=new.id) then raise exception 'Relay and individual results require distinct identities'; end if;
 for member in select * from jsonb_array_elements(new.data->'members') loop
  if jsonb_typeof(member->'leg') is distinct from 'number' or member->>'leg' !~ '^[1-4]$'
   or (member->>'leg')::int=any(legs) or nullif(trim(member->>'name'),'') is null then raise exception 'Relay members require unique ordered legs and a public name'; end if;
  legs:=array_append(legs,(member->>'leg')::int);
  if nullif(member->>'athleteId','') is not null then
   if member->>'athleteId'=any(athlete_links) then raise exception 'Relay members require distinct athlete links'; end if;
   athlete_links:=array_append(athlete_links,member->>'athleteId');
  end if;
  if member ? 'timeMs' and (jsonb_typeof(member->'timeMs') is distinct from 'number' or coalesce(member->>'timeMs','') !~ '^[0-9]{1,9}$' or (member->>'timeMs')::bigint<=0 or ((new.data->>'timeMs')::bigint>0 and (member->>'timeMs')::bigint>(new.data->>'timeMs')::bigint)) then raise exception 'Invalid relay member timing'; end if;
  if member->>'leadOffEligible'='true' and (member->>'leg'<>'1' or nullif(member->>'athleteId','') is null) then raise exception 'Only a linked first member can have a verified lead-off'; end if;
  if nullif(member->>'athleteId','') is not null and not exists(select 1 from public.athletes where id=member->>'athleteId') then
   raise exception 'Approve athlete % before linking the relay member',member->>'athleteId' using errcode='23503';
  end if;
 end loop;
 perform private.validate_result_splits(new.data,(new.data->>'distance')::integer,(new.data->>'timeMs')::bigint);
 -- A lineup correction cannot detach an already verified lead-off result.
 for parent_lead in select * from public.swims where parent_relay_result_id = new.id loop
  if parent_lead.course is distinct from new.data->>'course'
   or parent_lead.data->>'teamId' is distinct from new.data->>'teamId'
   or parent_lead.meet_id is distinct from new.data#>>'{meet,id}'
   or parent_lead.event_code is distinct from ((new.data->>'distance')::integer/4)::text||'_'||(case when split_part(new.data->>'eventCode','_',2)='MED-R' then 'BK' else 'FR' end)||'_'||(new.data->>'course')
   or not exists(select 1 from jsonb_array_elements(new.data->'members') m where m->>'leg'='1' and m->>'athleteId'=parent_lead.athlete_id and (m->>'timeMs' is null or (m->>'timeMs')::integer=parent_lead.time_ms)) then
   raise exception 'Correct or remove the verified lead-off before changing its relay member';
  end if;
 end loop;
 return new;
end; $$;
-- Prove ordinary swims clean in one query. Leave every possible conflict,
-- prerequisite, and swimmer-match case to the existing live validator.
create or replace function private.velocity_import_clean_pending_swims()
returns table(id uuid) language sql stable set search_path = ''
set work_mem = '32MB' set enable_nestloop = off as $$
  with pending_swims as materialized (
    select r.id, r.record_id,
      result."athleteId" as athlete_id,
      result."teamId" as team_id,
      result.meet->>'id' as meet_id,
      result.meet->>'date' as race_date,
      result."eventCode" as event_code,
      result."sourceObservation"#>>'{canonicalMeetCrosswalk,id}' as crosswalk_meet_id,
      coalesce(result.round, 'F') as round_code,
      coalesce(result."raceIdentity"->>'occurrence', 'single') as occurrence,
      result."externalResult"->>'namespace' as source_namespace,
      result."externalResult"->>'id' as source_id,
      (
        r.review_blocker is null and r.prerequisites = '[]'::jsonb
        and coalesce(result.round, 'F') in ('F', 'P')
        and coalesce(result."resultOrigin", 'individual') = 'individual'
        and result.metadata->>'source' is distinct from 'hytek_hy3'
      ) as ordinary
    from private.velocity_import_rows r
    cross join lateral jsonb_to_record(r.data) as result(
      "athleteId" text, "teamId" text, meet jsonb, "eventCode" text, round text,
      "sourceObservation" jsonb, "raceIdentity" jsonb, "externalResult" jsonb,
      "resultOrigin" text, metadata jsonb
    )
    where r.status = 'pending' and r.kind = 'swim' and r.supplied_blocker is null
  ), repeated_records as (
    select record_id from pending_swims group by record_id having count(*) > 1
  ), repeated_occurrences as (
    -- Use a coarser key than result_identity_base. A possible match only
    -- means both rows need the existing validator's exact comparison.
    select athlete_id, meet_id, race_date, event_code, round_code, occurrence
    from pending_swims
    group by athlete_id, meet_id, race_date, event_code, round_code, occurrence having count(*) > 1
  ), repeated_sources as (
    select source_namespace, source_id from pending_swims
    where source_namespace is not null and source_id is not null
    group by source_namespace, source_id having count(*) > 1
  ), published_swims as materialized (
    select id, athlete_id, meet_id, event_code from public.swims
  )
  select s.id
  from pending_swims s
  join public.meets m on m.id = s.meet_id
  join public.athletes a on a.id = s.athlete_id
  join public.teams t on t.id = s.team_id
  where s.ordinary
    and s.race_date between coalesce(m.data->>'startsOn', m.data->>'startDate', m.data#>>'{dates,startDate}')
    and coalesce(m.data->>'endsOn', m.data->>'endDate', m.data#>>'{dates,endDate}')
    and coalesce(s.crosswalk_meet_id, s.meet_id) = s.meet_id
    and not exists (select 1 from published_swims published where published.id = s.record_id)
    and not exists (select 1 from public.relay_results published where published.id = s.record_id)
    and not exists (
      select 1 from private.result_source_identities source
      where source.kind = 'swim' and source.namespace = s.source_namespace and source.source_id = s.source_id
    )
    and not exists (
      select 1 from published_swims published
      where published.athlete_id = s.athlete_id and published.meet_id = s.meet_id
        and published.event_code = s.event_code
    )
    and not exists (
      select 1 from repeated_records other where other.record_id = s.record_id
    )
    and not exists (
      select 1 from repeated_occurrences other
      where other.athlete_id = s.athlete_id and other.meet_id = s.meet_id
        and other.race_date = s.race_date and other.event_code = s.event_code
        and other.round_code = s.round_code and other.occurrence = s.occurrence
    )
    and not exists (
      select 1 from repeated_sources other
      where other.source_namespace = s.source_namespace and other.source_id = s.source_id
    );
$$;

revoke all on function private.velocity_import_clean_pending_swims() from public, anon, authenticated, service_role;

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

  with needs_check as materialized (
    select id from private.velocity_import_rows where status = 'pending'
    except
    select id from private.velocity_import_clean_pending_swims()
  ), checked as materialized (
    select r.id, private.velocity_import_issue(r) as reason
    from needs_check c join private.velocity_import_rows r on r.id = c.id
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

-- An exact issue count still scans the queue's keys and may need to read a
-- cold canonical index/table. Give only this staff RPC a bounded budget.
alter function public.velocity_import_issues(jsonb) set statement_timeout = '30s';
notify pgrst, 'reload schema';
