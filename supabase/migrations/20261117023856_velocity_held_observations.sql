create table private.velocity_held_observations (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references private.collection_workers(id),
  source_meet_id text not null check (source_meet_id ~ '^[0-9]{1,20}$'),
  workbook_sha256 text not null check (workbook_sha256 ~ '^[a-f0-9]{64}$'),
  kind text not null check (kind in ('swim', 'relay')),
  source_row integer not null check (source_row > 0),
  round text not null check (round in ('F', 'P', 'S', 'TT', 'none')),
  club_code text not null check (club_code in ('VS', 'CUDA')),
  hold_reason text not null check (length(hold_reason) between 1 and 500),
  source_status text check (source_status in ('OK', 'DQ', 'DFS', 'NS', 'DNF', 'SCR')),
  member_id_hash text check (member_id_hash ~ '^[a-f0-9]{24}$'),
  source_url text not null,
  captured_at timestamptz not null,
  observed jsonb not null check (jsonb_typeof(observed) = 'object'),
  unique (source_meet_id, workbook_sha256, kind, source_row, round)
);

create index velocity_held_observation_identity_idx
  on private.velocity_held_observations(member_id_hash, id) where member_id_hash is not null;
create index velocity_held_observation_export_idx
  on private.velocity_held_observations(source_meet_id, workbook_sha256, id);
create index velocity_held_observation_event_idx
  on private.velocity_held_observations(source_meet_id, (observed->>'eventCode'), round, id);
create index velocity_held_canonical_meet_source_idx on public.meets ((data#>>'{sourceObservation,sourceMeetId}'))
  where data#>>'{sourceObservation,sourceMeetId}' is not null;

create table private.velocity_held_decisions (
  id uuid primary key,
  observation_id uuid not null references private.velocity_held_observations(id),
  scope text not null check (scope in ('row', 'identity', 'source')),
  member_id_hash text,
  source_meet_id text,
  workbook_sha256 text,
  club_code text,
  event_code text,
  round text,
  athlete_id text,
  meet_id text,
  reviewed_affiliation boolean not null default false,
  patch jsonb not null default '{}',
  expected_current jsonb,
  reason text not null,
  evidence_url text not null,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  request jsonb not null,
  affected integer not null
);

create index velocity_held_decision_row_idx
  on private.velocity_held_decisions(observation_id, created_at desc, id) where scope = 'row';
create index velocity_held_decision_identity_idx
  on private.velocity_held_decisions(member_id_hash, created_at desc, id) where scope = 'identity';
create index velocity_held_decision_export_idx
  on private.velocity_held_decisions(source_meet_id, workbook_sha256, created_at desc, id) where scope = 'source';

create table private.velocity_held_assessments (
  observation_id uuid primary key references private.velocity_held_observations(id),
  state text not null check (state in ('held', 'ready', 'published', 'outcome')),
  blocker text,
  candidate jsonb,
  current_data jsonb,
  record_id text,
  import_row_id uuid references private.velocity_import_rows(id),
  correction_batch_id uuid references public.collection_batches(id)
);

create index velocity_held_assessment_record_idx
  on private.velocity_held_assessments(record_id) where record_id is not null;

alter table private.velocity_held_observations enable row level security;
alter table private.velocity_held_decisions enable row level security;
alter table private.velocity_held_assessments enable row level security;
revoke all on private.velocity_held_observations, private.velocity_held_decisions, private.velocity_held_assessments
  from public, anon, authenticated, service_role;

create function private.velocity_held_safe_url(value text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(length(value) <= 2048
    and value ~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?([/?#][^[:space:]]*)?$'
    and value !~* '[?&](token|key|[a-z0-9_-]*signature|[a-z0-9_-]*credential|expires|x-amz-[^=&]+|x-goog-[^=&]+)='
  , false);
$$;

create function private.stage_velocity_held_observations(worker_token text, observations jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  collector uuid;
  inserted integer;
begin
  select id into collector from private.collection_workers
  where token_hash = encode(extensions.digest(worker_token, 'sha256'), 'hex')
    and revoked_at is null and 'times' = any(divisions);
  if collector is null then
    raise insufficient_privilege using message = 'Times collector access required.';
  end if;
  if jsonb_typeof(observations) is distinct from 'array'
    or pg_column_size(observations) > 2000000
    or jsonb_array_length(observations) not between 1 and 250
  then raise invalid_parameter_value using message = 'Send 1–250 observation rows in a request under 2 MB.'; end if;
  if exists (
    select 1 from jsonb_array_elements(observations) as rows(item)
    where not private.velocity_held_safe_url(item->>'sourceUrl')
      or item->>'capturedAt' is null
      or not pg_input_is_valid(item->>'capturedAt', 'timestamp with time zone')
      or nullif(btrim(item#>>'{observed,meetName}'), '') is null
      or pg_column_size(item->'observed') > 32000
      or jsonb_path_exists(item->'observed',
        'strict $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(#ID|memberId|rawMemberId|dateOfBirth|dob|birthday|birthDate|signedUrl|downloadUrl)$" flag "i")')
  ) then raise invalid_parameter_value using message = 'Invalid or sensitive observation payload.'; end if;

  insert into private.velocity_held_observations(
    worker_id, source_meet_id, workbook_sha256, kind, source_row, round, club_code,
    hold_reason, source_status, member_id_hash, source_url, captured_at, observed
  )
  select collector, item->>'sourceMeetId', item->>'workbookSha256', item->>'kind',
    (item->>'sourceRow')::integer, item->>'round', item->>'clubCode', item->>'holdReason',
    item->>'sourceStatus', item->>'memberIdHash', item->>'sourceUrl', (item->>'capturedAt')::timestamptz,
    item->'observed'
  from jsonb_array_elements(observations) as rows(item)
  on conflict (source_meet_id, workbook_sha256, kind, source_row, round) do nothing;
  get diagnostics inserted = row_count;

  if exists (
    select 1
    from jsonb_array_elements(observations) as rows(item)
    join private.velocity_held_observations stored
      on stored.source_meet_id = item->>'sourceMeetId' and stored.workbook_sha256 = item->>'workbookSha256'
      and stored.kind = item->>'kind' and stored.source_row = (item->>'sourceRow')::integer and stored.round = item->>'round'
    where row(stored.club_code, stored.hold_reason, stored.source_status, stored.member_id_hash,
      stored.source_url, stored.captured_at, stored.observed) is distinct from
      row(item->>'clubCode', item->>'holdReason', item->>'sourceStatus', item->>'memberIdHash',
        item->>'sourceUrl', (item->>'capturedAt')::timestamptz, item->'observed')
  ) then raise sqlstate 'PT409' using message = 'A source observation key has different archived facts.'; end if;
  return jsonb_build_object('inserted', inserted, 'duplicates', jsonb_array_length(observations) - inserted);
end;
$$;

create function public.stage_velocity_held_observations(worker_token text, observations jsonb)
returns jsonb language sql set search_path = '' as $$
  select private.stage_velocity_held_observations(worker_token, observations);
$$;

create function private.velocity_held_applies(d private.velocity_held_decisions, o private.velocity_held_observations)
returns boolean language sql immutable set search_path = '' as $$
  select case d.scope
    when 'row' then d.observation_id = o.id
    when 'identity' then o.kind = 'swim' and d.member_id_hash = o.member_id_hash
    when 'source' then d.source_meet_id = o.source_meet_id and d.workbook_sha256 = o.workbook_sha256
      and (d.event_code is null or d.event_code = o.observed->>'eventCode')
      and (d.round is null or d.round = o.round)
    else false
  end;
$$;

create function private.velocity_held_affected(d private.velocity_held_decisions, after_id uuid default null)
returns setof uuid language sql stable set search_path = '' as $$
  select o.id from private.velocity_held_observations o
  where d.scope = 'row' and o.id = d.observation_id and (after_id is null or o.id > after_id)
  union all
  select o.id from private.velocity_held_observations o
  where d.scope = 'identity' and o.kind = 'swim' and o.member_id_hash = d.member_id_hash
    and (after_id is null or o.id > after_id)
  union all
  select o.id from private.velocity_held_observations o
  where d.scope = 'source' and o.source_meet_id = d.source_meet_id and o.workbook_sha256 = d.workbook_sha256
    and (d.event_code is null or o.observed->>'eventCode' = d.event_code)
    and (d.round is null or o.round = d.round)
    and (after_id is null or o.id > after_id);
$$;

create function private.velocity_held_athlete_name(profile jsonb)
returns text language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(profile->'name') = 'string' then nullif(btrim(profile->>'name'), '')
    else nullif(btrim(concat_ws(' ', profile#>>'{name,first}', profile#>>'{name,last}')), '') end;
$$;

create view private.velocity_held_review as
select o.*, a.blocker, a.candidate, a.current_data, a.record_id, a.import_row_id, a.correction_batch_id,
  coalesce(b.id, q.batch_id) as review_batch_id,
  case
    when b.status in ('pending', 'held') or q.status = 'pending' then 'pending'
    when b.status = 'approved' then 'published'
    when q.status in ('approved', 'duplicate') then 'published'
    when a.state is not null then a.state
    when o.source_status in ('DQ', 'DFS', 'NS', 'DNF', 'SCR') or o.round = 'none' then 'outcome'
    else 'held'
  end as state
from private.velocity_held_observations o
left join private.velocity_held_assessments a on a.observation_id = o.id
left join private.velocity_import_rows q on q.id = a.import_row_id
left join public.collection_batches b on b.id = a.correction_batch_id;

revoke all on private.velocity_held_review from public, anon, authenticated, service_role;

create function private.velocity_held_json(o private.velocity_held_review)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id, 'sourceMeetId', o.source_meet_id, 'workbookSha256', o.workbook_sha256, 'kind', o.kind,
    'sourceRow', o.source_row, 'round', o.round, 'clubCode', o.club_code, 'holdReason', o.hold_reason,
    'sourceStatus', o.source_status, 'memberIdHash', o.member_id_hash, 'sourceUrl', o.source_url,
    'capturedAt', o.captured_at, 'observed', o.observed, 'status', o.state,
    'blocker', coalesce(o.blocker, case when o.state = 'held' then o.hold_reason end),
    'recordId', o.record_id, 'reviewBatchId', o.review_batch_id
  );
$$;

create function private.velocity_held_age_group(value text)
returns text language sql immutable set search_path = '' as $$
  with normalized as (
    select replace(regexp_replace(regexp_replace(upper(btrim(value)),
      '^([0-9]{1,3})[[:space:]]*&[[:space:]]*UNDER$', '\1&U'),
      '^([0-9]{1,3})[[:space:]]*&[[:space:]]*OVER$', '\1&O'), '–', '-') as label
  )
  select case
    when label = 'OPEN' then 'Open'
    when public.ies_times_age_range(label) is not null then regexp_replace(label, '[[:space:]]+', '', 'g')
  end from normalized;
$$;

create function private.velocity_held_find_result(kind_arg text, body jsonb)
returns text[] language sql stable set search_path = '' as $$
  with candidates as (
    select s.id, s.data from public.swims s
    where kind_arg = 'swim' and s.data->>'athleteId' = body->>'athleteId'
      and s.data#>>'{meet,id}' = body#>>'{meet,id}' and s.data->>'eventCode' = body->>'eventCode'
    union all
    select r.id, r.data from public.relay_results r
    where kind_arg = 'relay' and r.data->>'teamId' = body->>'teamId'
      and r.data#>>'{meet,id}' = body#>>'{meet,id}' and r.data->>'eventCode' = body->>'eventCode'
  )
  select coalesce(array_agg(c.id order by c.id), '{}') from candidates c
  where case when kind_arg = 'relay' then
    private.result_identity_base(kind_arg, c.data) - 'ageGroup' = private.result_identity_base(kind_arg, body) - 'ageGroup'
    and coalesce(private.velocity_held_age_group(c.data->>'ageGroup'), nullif(c.data->>'ageGroup','')) is not distinct from
      coalesce(private.velocity_held_age_group(body->>'ageGroup'), nullif(body->>'ageGroup',''))
    else private.result_identity_base(kind_arg, c.data) = private.result_identity_base(kind_arg, body)
    end
    and coalesce(c.data#>>'{raceIdentity,occurrence}', 'single') = coalesce(body#>>'{raceIdentity,occurrence}', 'single');
$$;

create function private.velocity_held_evaluate(
  o private.velocity_held_observations, previous_record text default null
)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  row_review private.velocity_held_decisions;
  identity_review private.velocity_held_decisions;
  export_review private.velocity_held_decisions;
  patch jsonb;
  current_data jsonb;
  proposed jsonb;
  corrections jsonb;
  profile jsonb;
  canonical_name text;
  meet_data jsonb;
  parent_data jsonb;
  record_ids text[];
  claimed_ids text[];
  target_id text;
  athlete_id text;
  meet_id text;
  event_code text;
  race_date text;
  category text;
  age text;
  age_group text;
  race_time text;
  distance integer;
  stroke text;
  course text;
  relay_name text;
  occurrence text;
  is_lead_off boolean;
  race_signature text;
  blocker text;
begin
  if o.source_status in ('DQ', 'DFS', 'NS', 'DNF', 'SCR') or o.round = 'none' then
    return jsonb_build_object('state', 'outcome');
  end if;
  select d.* into row_review from private.velocity_held_decisions d
  where d.scope = 'row' and d.observation_id = o.id order by d.created_at desc, d.id desc limit 1;
  select d.* into identity_review from private.velocity_held_decisions d
  where d.scope = 'identity' and d.member_id_hash = o.member_id_hash
  order by d.created_at desc, d.id desc limit 1;
  select d.* into export_review from private.velocity_held_decisions d
  where d.scope = 'source' and d.source_meet_id = o.source_meet_id and d.workbook_sha256 = o.workbook_sha256
    and (d.event_code is null or d.event_code = o.observed->>'eventCode')
    and (d.round is null or d.round = o.round)
  order by d.created_at desc, d.id desc limit 1;
  patch := coalesce(row_review.patch, '{}');

  if previous_record is not null then
    current_data := private.collection_snapshot(private.velocity_import_path(o.kind, previous_record));
    if current_data is not null then target_id := previous_record; end if;
  end if;

  -- A source review establishes competitive status only for its exact export.
  -- Every row still needs its own unambiguous race facts.
  if o.observed->>'isOfficial' = 'false' and patch->>'officialVerified' is distinct from 'true' then
    return jsonb_build_object('state','held','blocker','The source marks this result unofficial. Verify the corrected result explicitly.');
  end if;
  if o.observed->>'isOfficial' is distinct from 'true' and export_review.id is null
    and patch->>'officialVerified' is distinct from 'true'
    and not (o.round = 'F' and coalesce(o.observed->>'awardedFinalPlace', '') ~ '^[1-9][0-9]*$') then
    return jsonb_build_object('state','held','blocker','Review the competitive result source before counting this time.');
  end if;
  if o.club_code = 'CUDA' and not (coalesce(row_review.reviewed_affiliation, false)
    or (coalesce(export_review.reviewed_affiliation, false) and export_review.club_code = o.club_code)) then
    return jsonb_build_object('state','held','blocker','Verify this Barracuda result belongs to Velocity’s historical program.');
  end if;
  if o.hold_reason in ('Fresh workbooks disagree about a race occurrence', 'Observed timing course differs from the meet course')
    and row_review.id is null then
    return jsonb_build_object('state','held','blocker',o.hold_reason);
  end if;

  athlete_id := coalesce(patch->>'athleteId', identity_review.athlete_id, current_data->>'athleteId');
  if o.kind = 'swim' then
    select coalesce(array_agg(t.athlete_id), '{}') into claimed_ids
    from private.velocity_import_swimmer_identity_targets(o.member_id_hash) t;
    if cardinality(claimed_ids) > 1 or (athlete_id is not null and cardinality(claimed_ids) = 1 and claimed_ids[1] <> athlete_id) then
      return jsonb_build_object('state','held','blocker','Conflicting verified swimmer links require identity reconciliation.');
    end if;
    athlete_id := coalesce(athlete_id, claimed_ids[1]);
    select a.data, coalesce(private.velocity_held_athlete_name(p.data), person.name)
    into profile, canonical_name
    from public.athletes a join public.public_athletes p on p.id = a.id
    join public.people person on person.id = a.person_id
    where a.id = athlete_id;
    if profile is null then
      return jsonb_build_object('state','held','blocker','Choose a verified canonical swimmer.');
    end if;
    if patch->>'athleteId' is null and identity_review.id is null and current_data is null
      and (o.hold_reason like '%identity has observed conflicts%' or o.hold_reason like '%separate source ID%'
        or private.velocity_import_normalize_name(regexp_replace(o.observed->>'name', '^([^,]+),([^,]+)$', '\2 \1'))
          <> private.velocity_import_normalize_name(canonical_name)) then
      return jsonb_build_object('state','held','blocker','Review the swimmer matches and name evidence.');
    end if;
  end if;

  meet_id := coalesce(patch->>'meetId', export_review.meet_id, current_data#>>'{meet,id}', o.observed->>'canonicalMeetId');
  if meet_id is null then
    select case when count(*) = 1 then min(m.id) end into meet_id from public.meets m
    where m.data#>>'{sourceObservation,sourceMeetId}' = o.source_meet_id;
  end if;
  select m.data into meet_data from public.meets m where m.id = meet_id;
  if meet_data is null then
    return jsonb_build_object('state','held','blocker','Choose a verified canonical meet.');
  end if;
  race_date := coalesce(patch->>'raceDate', o.observed->>'raceDate', current_data#>>'{meet,date}');
  if coalesce(race_date, '') !~ '^\d{4}-\d{2}-\d{2}$' or not pg_input_is_valid(race_date, 'date')
    or not coalesce(race_date between coalesce(meet_data->>'startsOn', meet_data->>'startDate', meet_data#>>'{dates,startDate}')
      and coalesce(meet_data->>'endsOn', meet_data->>'endDate', meet_data#>>'{dates,endDate}',
        meet_data->>'startsOn', meet_data->>'startDate', meet_data#>>'{dates,startDate}'), false) then
    return jsonb_build_object('state','held','blocker','Verify the exact race day within the published meet.');
  end if;
  event_code := coalesce(patch->>'eventCode', o.observed->>'eventCode', current_data->>'eventCode');
  if coalesce(event_code, '') !~ '^[1-9][0-9]{0,3}_(FR|BK|BR|FL|IM|FR-R|MED-R)_(SCY|SCM|LCM)$'
    or (o.kind = 'relay') is distinct from (split_part(event_code, '_', 2) like '%-R') then
    return jsonb_build_object('state','held','blocker','Verify the event and course.');
  end if;
  distance := split_part(event_code, '_', 1)::integer;
  stroke := split_part(event_code, '_', 2);
  course := split_part(event_code, '_', 3);
  if o.kind = 'relay' and distance not in (100, 200, 400, 800) then
    return jsonb_build_object('state','held','blocker','Verify the supported relay distance.');
  end if;
  if coalesce(meet_data->>'course', meet_data#>>'{venue,course}') in ('SCY','SCM','LCM')
    and coalesce(meet_data->>'course', meet_data#>>'{venue,course}') <> course
    and patch->>'eventCode' is null then
    return jsonb_build_object('state','held','blocker','The meet and source course disagree. Review the race event.');
  end if;
  category := coalesce(patch->>'category', o.observed->>'category', current_data->>'gender');
  if coalesce(category, '') not in ('F','M','X') or (o.kind = 'swim' and category = 'X' and patch->>'category' is null)
    or (o.kind = 'swim' and category in ('F','M') and profile->>'gender' in ('F','M') and profile->>'gender' <> category) then
    return jsonb_build_object('state','held','blocker','Verify the recorded competitive category.');
  end if;
  race_time := coalesce(patch->>'timeMs', o.observed->>'timeMs', current_data->>'timeMs');
  if coalesce(race_time, '') !~ '^[1-9][0-9]{0,8}$' then
    return jsonb_build_object('state','held','blocker','Verify the positive race time.');
  end if;
  occurrence := coalesce(patch->>'occurrence', current_data#>>'{raceIdentity,occurrence}', 'single');
  if occurrence !~ '^[a-zA-Z0-9_:-]{1,128}$' or (o.round in ('S','TT') and occurrence = 'single') then
    return jsonb_build_object('state','held','blocker','Verify the distinct start for this race occurrence.');
  end if;

  age := coalesce(patch->>'age', o.observed->>'age');
  age_group := private.velocity_held_age_group(coalesce(
    patch->>'ageGroup', case when o.kind = 'relay' and not patch ? 'ageGroup' then o.observed->>'ageGroup' end));
  relay_name := coalesce(patch->>'relayName', o.observed->>'relayName', current_data->>'relayName');
  if o.kind = 'relay' and (nullif(btrim(relay_name), '') is null or length(relay_name) > 160) then
    return jsonb_build_object('state','held','blocker','Verify the relay name and entry.');
  end if;
  if age is not null and age !~ '^(0|[1-9][0-9]?|1[01][0-9]|120)$' then
    return jsonb_build_object('state','held','blocker','Use a verified race-day age from 0 to 120.');
  end if;
  if patch->>'ageGroup' is not null and age_group is null then
    return jsonb_build_object('state','held','blocker','Verify the recorded age category.');
  end if;

  proposed := jsonb_strip_nulls(jsonb_build_object(
    'athleteId', athlete_id,
    'teamId', 'velocity-swimming',
    'isRelay', o.kind = 'relay',
    'eventCode', event_code,
    'distance', distance,
    'stroke', case stroke when 'FR-R' then 'FR' when 'MED-R' then 'IM' else stroke end,
    'course', course,
    'round', o.round,
    'status', 'OK',
    'isOfficial', true,
    'gender', category,
    'timeMs', race_time::integer,
    'timeDisplay', private.format_time(race_time::integer),
    'meet', jsonb_build_object('id', meet_id, 'name', coalesce(meet_data->>'name', o.observed->>'meetName'), 'date', race_date),
    'ageAtSwim', case when o.kind = 'swim' then age::int end,
    'ageGroup', age_group,
    'relayName', relay_name,
    'members', case when o.kind = 'relay' then coalesce(patch->'members', '[]') end,
    'splitCoverage', coalesce(patch->>'splitCoverage', case when patch ? 'splits' then 'partial' else 'unavailable' end),
    'splits', coalesce(patch->'splits', '[]'),
    'raceIdentity', case when occurrence <> 'single' then jsonb_build_object(
      'occurrence', occurrence, 'reviewed', true, 'basis', row_review.reason, 'sourceUrl', row_review.evidence_url
    ) end,
    'sourceObservation', jsonb_build_object(
      'method', 'GoMotion held observation', 'sourceMeetId', o.source_meet_id,
      'workbookSha256', o.workbook_sha256, 'sourceRow', o.source_row,
      'memberIdHash', o.member_id_hash, 'sourceUrl', o.source_url,
      'affiliation', jsonb_build_object('lscCode','IE','clubCode',o.club_code),
      'evidenceUrl', coalesce(row_review.evidence_url, export_review.evidence_url, o.source_url)
    )
  ));
  is_lead_off := o.observed->>'leadOff' = 'true'
    or o.hold_reason like 'Relay lead-off%'
    or current_data->>'resultOrigin' = 'relay_leadoff';
  if is_lead_off then
    select r.data into parent_data from public.relay_results r
    where r.id = coalesce(patch->>'parentRelayResultId', current_data->>'parentRelayResultId');
    if o.kind <> 'swim' or parent_data is null
      or (patch->>'leadOffVerified' is distinct from 'true' and current_data->>'resultOrigin' is distinct from 'relay_leadoff')
      or parent_data->>'teamId' is distinct from 'velocity-swimming'
      or parent_data#>>'{meet,id}' is distinct from meet_id
      or parent_data#>>'{meet,date}' is distinct from race_date
      or event_code is distinct from (
        ((parent_data->>'distance')::integer / 4)::text || '_'
        || case when parent_data->>'stroke' = 'IM' then 'BK' else 'FR' end || '_' || (parent_data->>'course'))
      or not exists (
        select 1 from jsonb_array_elements(parent_data->'members') m
        where m->>'leg' = '1' and m->>'athleteId' = athlete_id
          and ((m->>'timeMs') is null or m->>'timeMs' = race_time)
      ) then
      return jsonb_build_object('state','held','blocker','A lead-off requires a verified parent relay, first leg, and flat-start time.');
    end if;
    proposed := proposed || jsonb_build_object(
      'resultOrigin','relay_leadoff','parentRelayResultId',parent_data->>'id',
      'leadOffVerification',coalesce(case when patch->>'leadOffVerified' = 'true' then jsonb_build_object(
        'verified',true,'flatStart',true,'timingVerified',true,'leadOffStatus','OK','sourceUrl',row_review.evidence_url
      ) end, current_data->'leadOffVerification')
    );
  end if;

  if target_id is null then
    record_ids := private.velocity_held_find_result(o.kind, proposed);
    if cardinality(record_ids) > 1 then
      return jsonb_build_object('state','held','blocker','Multiple canonical results match the observed occurrence.');
    end if;
    target_id := record_ids[1];
    if target_id is not null then
      current_data := private.collection_snapshot(private.velocity_import_path(o.kind, target_id));
    end if;
  end if;
  if current_data is not null then
    blocker := null;
    if row(current_data->>'timeMs', current_data->>'status', current_data->>'gender') is distinct from row(race_time, 'OK', category)
      and not (patch ? 'timeMs' or patch ? 'category') then
      blocker := 'The published race disagrees with the source. Review the exact correction.';
    end if;
    if current_data->>'status' is distinct from 'OK' then
      blocker := 'The published result has a conflicting race status.';
    end if;
    -- Preserve metadata and omitted details on an existing canonical result.
    corrections := '{}'::jsonb;
    if patch ? 'age' then corrections := corrections || jsonb_build_object('ageAtSwim', age::integer); end if;
    if patch ? 'ageGroup' then corrections := corrections || jsonb_build_object('ageGroup', age_group); end if;
    if patch ? 'members' and o.kind = 'relay' then corrections := corrections || jsonb_build_object('members', proposed->'members'); end if;
    if patch ? 'splits' or patch ? 'splitCoverage' then
      corrections := corrections || jsonb_build_object('splits', proposed->'splits', 'splitCoverage', proposed->'splitCoverage');
    end if;
    if patch ? 'timeMs' then corrections := corrections || jsonb_build_object('timeMs', proposed->'timeMs', 'timeDisplay', proposed->'timeDisplay'); end if;
    if patch ? 'category' then corrections := corrections || jsonb_build_object('gender', category); end if;
    if patch ? 'raceDate' or patch ? 'meetId' then corrections := corrections || jsonb_build_object('meet', proposed->'meet'); end if;
    if patch ? 'eventCode' then
      corrections := corrections || jsonb_build_object('eventCode', event_code, 'course', course, 'stroke', proposed->'stroke', 'distance', distance);
    end if;
    if patch ? 'relayName' and o.kind = 'relay' then corrections := corrections || jsonb_build_object('relayName', relay_name); end if;
    if patch ? 'officialVerified' and patch->>'officialVerified' = 'true' then corrections := corrections || jsonb_build_object('isOfficial', true); end if;
    if patch ? 'athleteId' and o.kind = 'swim' then
      if current_data#>>'{sourceObservation,memberIdHash}' is not null
        and current_data->>'athleteId' is distinct from athlete_id then
        blocker := 'A published stable swimmer claim needs identity reconciliation before reassignment.';
      else
        corrections := corrections || jsonb_build_object('athleteId', athlete_id) - 'athleteName';
      end if;
    end if;
    proposed := current_data || corrections;
    if proposed is distinct from current_data and row_review.expected_current is not null
      and row_review.expected_current is distinct from current_data then
      return jsonb_build_object('state','held','blocker','The published result changed. Refresh and review the correction again.',
        'recordId', target_id, 'current', current_data);
    end if;
    if blocker is not null then
      return jsonb_build_object('state','held','blocker',blocker,'recordId',target_id,'current',current_data,'candidate',proposed);
    end if;
    if proposed = current_data then
      return jsonb_build_object('state','published','recordId',target_id,'current',current_data);
    end if;
  else
    race_signature := encode(extensions.digest(concat_ws('|', o.kind,
      private.result_identity_base(o.kind, proposed)::text, occurrence), 'sha256'), 'hex');
    target_id := 'gomotion_held_' || left(race_signature, 32);
    proposed := proposed || jsonb_build_object('id', target_id,
      'externalResult',jsonb_build_object('namespace','gomotion-held','id',race_signature));
    blocker := private.velocity_import_record_check(o.kind, target_id, proposed);
    if blocker is not null then
      return jsonb_build_object('state', case when blocker = '' then 'published' else 'held' end,
        'blocker',nullif(blocker,''), 'recordId',target_id, 'candidate',proposed);
    end if;
  end if;

  begin
    perform private.validate_result_splits(proposed, distance, (proposed->>'timeMs')::bigint);
  exception when data_exception or check_violation or raise_exception then
    return jsonb_build_object('state','held','blocker',left(sqlerrm, 350),'recordId',target_id,'current',current_data,'candidate',proposed);
  end;
  if o.kind = 'relay' and (
    jsonb_typeof(proposed->'members') is distinct from 'array' or jsonb_array_length(proposed->'members') > 4
    or exists (
      select 1 from jsonb_array_elements(proposed->'members') m
      where coalesce(m->>'leg','') !~ '^[1-4]$' or nullif(btrim(m->>'name'),'') is null
        or (m->>'athleteId' is not null and not exists(select 1 from public.athletes a where a.id = m->>'athleteId'))
    ) or exists (
      select 1 from jsonb_array_elements(proposed->'members') m group by m->>'leg' having count(*) > 1
    )
  ) then
    return jsonb_build_object('state','held','blocker','Verify unique ordered relay legs and listed swimmers.',
      'recordId',target_id,'current',current_data,'candidate',proposed);
  end if;
  return jsonb_build_object('state','ready','recordId',target_id,'current',current_data,'candidate',proposed);
end;
$$;

create function private.velocity_held_write_assessment(oid uuid, evaluation jsonb)
returns void language sql set search_path = '' as $$
  insert into private.velocity_held_assessments(observation_id, state, blocker, candidate, current_data, record_id)
  values(oid, evaluation->>'state', evaluation->>'blocker', evaluation->'candidate',
    case when jsonb_typeof(evaluation->'current') = 'object' then evaluation->'current' end, evaluation->>'recordId')
  on conflict (observation_id) do update set
    state=excluded.state, blocker=excluded.blocker, candidate=excluded.candidate,
    current_data=excluded.current_data, record_id=excluded.record_id,
    import_row_id=null, correction_batch_id=null;
$$;

create function private.velocity_held_list(input jsonb)
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
    or (desired_state is not null and desired_state not in ('held','ready','published','pending','outcome')) then
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
      'outcome', count(*) filter(where state = 'outcome')
    ) from filtered)
  ) into result from totals t;
  return result;
end;
$$;

create function private.velocity_held_detail(oid uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  item private.velocity_held_review;
  source private.velocity_held_observations;
  decisions jsonb;
  evaluated jsonb;
  current_data jsonb;
begin
  select * into item from private.velocity_held_review o where o.id = oid;
  if item.id is null then raise sqlstate 'PT404' using message = 'Held observation was not found.'; end if;
  select * into source from private.velocity_held_observations o where o.id = oid;
  evaluated := private.velocity_held_evaluate(source, item.record_id);
  current_data := private.collection_snapshot(private.velocity_import_path(item.kind, coalesce(item.record_id, evaluated->>'recordId')));
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
    'recordId', coalesce(item.record_id, evaluated->>'recordId'),
    'blocker', case when item.state <> 'pending' then coalesce(evaluated->>'blocker', item.blocker) end
  );
end;
$$;

create function private.velocity_held_record_decision(input jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  oid uuid := (input->>'id')::uuid;
  request_id uuid := (input->>'requestId')::uuid;
  decision_scope text := input->>'scope';
  review_reason text := btrim(input->>'reason');
  evidence text := input->>'evidenceUrl';
  target_athlete text := nullif(input->>'athleteId', '');
  target_meet text := nullif(input->>'meetId', '');
  event_scope text := nullif(input->>'eventCode', '');
  round_scope text := nullif(input->>'round', '');
  affiliation boolean := coalesce((input->>'reviewedAffiliation')::boolean, false);
  patch jsonb := coalesce(input->'patch', '{}');
  previous private.velocity_held_decisions;
  selection private.velocity_held_decisions;
  item private.velocity_held_observations;
  detail jsonb;
begin
  if request_id is null or decision_scope is null or decision_scope not in ('row','identity','source')
    or not coalesce(length(review_reason) between 5 and 1000, false)
    or not private.velocity_held_safe_url(evidence) then
    raise invalid_parameter_value using message = 'A review requires a scope, reason, evidence URL, and request ID.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(request_id::text, 0));
  select d.* into previous from private.velocity_held_decisions d where d.id = request_id;
  if previous.id is not null then
    if previous.reviewed_by is distinct from auth.uid() or previous.request is distinct from input then
      raise sqlstate 'PT409' using message = 'This review request ID was already used.';
    end if;
    return jsonb_build_object('decisionId', previous.id, 'affected', previous.affected);
  end if;
  select * into item from private.velocity_held_observations o where o.id = oid for update;
  if item.id is null then raise sqlstate 'PT404' using message = 'Held observation was not found.'; end if;
  if decision_scope = 'row' and exists(
    select 1 from private.velocity_held_review v where v.id = item.id and v.state = 'pending'
  ) then raise sqlstate 'PT409' using message = 'This observation already has a pending review.'; end if;

  if not (jsonb_typeof(patch) = 'object' and pg_column_size(patch) <= 20000) or exists (
    select 1 from jsonb_object_keys(patch) k
    where k not in ('athleteId','meetId','raceDate','eventCode','category','timeMs','age','ageGroup','relayName',
      'members','splits','splitCoverage','parentRelayResultId','leadOffVerified','officialVerified','occurrence')
  ) or jsonb_path_exists(patch,
    'strict $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(#ID|memberId|rawMemberId|dateOfBirth|dob|birthday|birthDate|signedUrl|downloadUrl)$" flag "i")')
  or (patch ? 'members' and jsonb_typeof(patch->'members') <> 'array')
  or (patch ? 'splits' and jsonb_typeof(patch->'splits') <> 'array') then
    raise invalid_parameter_value using message = 'Invalid correction fields.';
  end if;

  if decision_scope = 'identity' then
    if item.kind <> 'swim' or item.member_id_hash is null or target_athlete is null
      or not exists(select 1 from public.public_athletes a where a.id = target_athlete)
      or exists(
        select 1 from private.velocity_import_swimmer_identity_targets(item.member_id_hash) t
        where t.athlete_id <> target_athlete
      ) then
      raise invalid_parameter_value using message = 'Verify the source swimmer and choose a compatible canonical swimmer.';
    end if;
  elsif decision_scope = 'source' then
    if (event_scope is not null and event_scope is distinct from item.observed->>'eventCode')
      or (round_scope is not null and (round_scope is distinct from item.round or round_scope = 'none'))
      or (target_meet is not null and not exists(select 1 from public.meets m where m.id = target_meet)) then
      raise invalid_parameter_value using message = 'This rule must match the selected export and a canonical meet.';
    end if;
  else
    detail := private.velocity_held_detail(oid);
    if input ? 'expected' and nullif(detail->'current', 'null') is distinct from nullif(input->'expected','null') then
      raise sqlstate 'PT409' using message = 'The published result changed. Refresh and review it again.';
    end if;
    select d.* into previous from private.velocity_held_decisions d
    where d.scope = 'row' and d.observation_id = oid order by d.created_at desc, d.id desc limit 1;
    patch := coalesce(previous.patch, '{}') || patch;
    affiliation := affiliation or coalesce(previous.reviewed_affiliation, false);
  end if;
  selection.id := request_id;
  selection.observation_id := oid;
  selection.scope := decision_scope;
  selection.member_id_hash := case when decision_scope = 'identity' then item.member_id_hash end;
  selection.source_meet_id := case when decision_scope = 'source' then item.source_meet_id end;
  selection.workbook_sha256 := case when decision_scope = 'source' then item.workbook_sha256 end;
  selection.club_code := case when decision_scope = 'source' then item.club_code end;
  selection.event_code := case when decision_scope = 'source' then event_scope end;
  selection.round := case when decision_scope = 'source' then round_scope end;
  selection.athlete_id := case when decision_scope = 'identity' then target_athlete end;
  selection.meet_id := case when decision_scope = 'source' then target_meet end;
  selection.reviewed_affiliation := affiliation;
  selection.patch := case when decision_scope = 'row' then patch else '{}'::jsonb end;
  selection.expected_current := case when decision_scope = 'row' then nullif(detail->'current','null') end;
  selection.reason := review_reason;
  selection.evidence_url := evidence;
  selection.reviewed_by := auth.uid();
  selection.created_at := clock_timestamp();
  selection.request := input;
  select count(*) into selection.affected from private.velocity_held_affected(selection);
  insert into private.velocity_held_decisions values (selection.*);
  return jsonb_build_object('decisionId', request_id, 'affected', selection.affected);
end;
$$;

create function private.velocity_held_refresh(start_after uuid, page_size integer, decision_id uuid default null)
returns jsonb language plpgsql set search_path = '' as $$
declare
  selection private.velocity_held_decisions;
  observation private.velocity_held_observations;
  current_review private.velocity_held_review;
  oid uuid;
  after_id uuid;
  evaluation jsonb;
  state text;
  checked integer := 0;
  counters jsonb := '{"ready":0,"published":0,"pending":0,"held":0,"outcome":0}';
begin
  if page_size not between 1 and 2000 then
    raise invalid_parameter_value using message = 'Invalid revalidation page size.';
  end if;
  if decision_id is not null then
    select d.* into selection from private.velocity_held_decisions d where d.id = decision_id;
    if selection.id is null then raise sqlstate 'PT404' using message = 'Held observation review was not found.'; end if;
  end if;
  for oid in
    select id from (
      select id from private.velocity_held_affected(selection, start_after) as ids(id) where decision_id is not null
      union all
      select id from private.velocity_held_observations where decision_id is null and (start_after is null or id > start_after)
    ) ids order by id limit page_size
  loop
    select o.* into observation from private.velocity_held_observations o where o.id = oid for update;
    select v.* into current_review from private.velocity_held_review v where v.id = oid;
    state := current_review.state;
    if state <> 'pending' then
      evaluation := private.velocity_held_evaluate(observation, current_review.record_id);
      state := evaluation->>'state';
      perform private.velocity_held_write_assessment(oid, evaluation);
    end if;
    counters := jsonb_set(counters, array[state], to_jsonb((counters->>state)::int + 1));
    checked := checked + 1;
    after_id := oid;
  end loop;
  return counters || jsonb_build_object('checked', checked,'afterId', after_id,
    'hasNext', checked = page_size and (
      (decision_id is not null and exists(select 1 from private.velocity_held_affected(selection, after_id)))
      or (decision_id is null and exists(select 1 from private.velocity_held_observations where id > after_id))
    ));
end;
$$;

create function private.velocity_held_submit(input jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  ids uuid[];
  oid uuid;
  item private.velocity_held_observations;
  assessment private.velocity_held_review;
  review private.velocity_held_decisions;
  evaluation jsonb;
  existing_row private.velocity_import_rows;
  proposed_row private.velocity_import_rows;
  staged_batch_id uuid;
  legacy_id uuid;
  batch_ids uuid[] := '{}';
  correction_ids uuid[] := '{}';
  staged integer := 0;
  duplicates integer := 0;
  blocked integer := 0;
  issue text;
  scope_label text;
begin
  if jsonb_typeof(input->'ids') is distinct from 'array'
    or jsonb_array_length(input->'ids') not between 1 and 90 then
    raise invalid_parameter_value using message = 'Select 1–90 evaluated observations for review.';
  end if;
  select array_agg(distinct value::uuid order by value::uuid) into ids
  from jsonb_array_elements_text(input->'ids');
  if cardinality(ids) <> jsonb_array_length(input->'ids') or array_position(ids, null) is not null then
    raise invalid_parameter_value using message = 'Observation IDs must be unique.';
  end if;
  -- Lock in source-id order before the canonical lock. Review decisions take an
  -- observation lock and may read, but never write canonical records.
  perform 1 from private.velocity_held_observations where id = any(ids) order by id for update;
  perform pg_advisory_xact_lock(hashtext('velocity-records'));

  foreach oid in array ids loop
    select o.* into item from private.velocity_held_observations o where o.id = oid;
    select v.* into assessment from private.velocity_held_review v where v.id = oid;
    if assessment.state = 'pending' then
      if assessment.correction_batch_id is not null then
        correction_ids := array_append(correction_ids, assessment.correction_batch_id);
      elsif assessment.review_batch_id is not null then
        batch_ids := array_append(batch_ids, assessment.review_batch_id);
      end if;
      continue;
    elsif assessment.state = 'published' then
      duplicates := duplicates + 1;
      continue;
    elsif assessment.state is distinct from 'ready' then
      blocked := blocked + 1;
      continue;
    end if;
    evaluation := private.velocity_held_evaluate(item, assessment.record_id);
    if evaluation->>'state' = 'published' then
      perform private.velocity_held_write_assessment(oid, evaluation);
      duplicates := duplicates + 1;
      continue;
    end if;
    if evaluation->>'state' is distinct from 'ready'
      or evaluation->'candidate' is distinct from assessment.candidate
      or nullif(evaluation->'current', 'null') is distinct from assessment.current_data
    then
      perform private.velocity_held_write_assessment(oid, evaluation);
      blocked := blocked + 1;
      continue;
    end if;
    if assessment.current_data is not null then
      select d.* into review from private.velocity_held_decisions d
      where d.scope = 'row' and d.observation_id = oid order by d.created_at desc, d.id desc limit 1;
      legacy_id := private.velocity_held_stage_correction(
        item.worker_id, item.kind, assessment.record_id, assessment.current_data, assessment.candidate,
        review.evidence_url, review.reason
      );
      update private.velocity_held_assessments set correction_batch_id = legacy_id where observation_id = oid;
      correction_ids := array_append(correction_ids, legacy_id);
      staged := staged + 1;
      continue;
    end if;

    select q.* into existing_row from private.velocity_import_rows q
    where q.status = 'pending' and q.kind = item.kind and q.record_id = assessment.record_id
      and q.supplied_blocker is null and private.velocity_import_same_result(q.data, assessment.candidate)
    order by q.id limit 1;
    if existing_row.id is not null then
      update private.velocity_held_assessments set import_row_id = existing_row.id where observation_id = oid;
      batch_ids := array_append(batch_ids, existing_row.batch_id);
      duplicates := duplicates + 1;
      continue;
    end if;
    proposed_row := null;
    proposed_row.id := gen_random_uuid();
    proposed_row.kind := item.kind;
    proposed_row.record_id := assessment.record_id;
    proposed_row.data := assessment.candidate;
    proposed_row.prerequisites := '[]';
    proposed_row.locator := concat_ws('/', 'meet', item.source_meet_id, item.kind, item.workbook_sha256, item.source_row, item.round);
    proposed_row.payload_hash := encode(extensions.digest(jsonb_build_array(assessment.candidate, '[]'::jsonb, null)::text,'sha256'),'hex');
    proposed_row.status := 'pending';
    issue := private.velocity_import_issue(proposed_row);
    if issue is not null then
      perform private.velocity_held_write_assessment(oid, evaluation || jsonb_build_object(
        'state',case when issue = '' then 'published' else 'held' end,'blocker',nullif(issue,'')));
      if issue = '' then duplicates := duplicates + 1; else blocked := blocked + 1; end if;
      continue;
    end if;

    -- Separate requests are separate review groups. The digest makes a retry of
    -- the same evidence and scope harmless.
    scope_label := 'GoMotion held observations review ' || item.source_meet_id || ', ' || item.kind;
    insert into private.velocity_import_batches(division, worker_id, source_url, captured_at, coverage, sha256, source_scope)
    values('times', item.worker_id, item.source_url, item.captured_at, 'partial',
      encode(extensions.digest(jsonb_build_array(item.workbook_sha256, ids)::text, 'sha256'),'hex'), scope_label)
    on conflict (division, source_url, sha256, source_scope) do update set source_scope = excluded.source_scope
    returning id into staged_batch_id;
    insert into private.velocity_import_rows(id,batch_id,kind,record_id,data,prerequisites,locator,payload_hash)
    values(proposed_row.id,staged_batch_id,item.kind,proposed_row.record_id,proposed_row.data,
      proposed_row.prerequisites,proposed_row.locator,proposed_row.payload_hash)
    on conflict(batch_id,kind,record_id,locator,payload_hash) do update set payload_hash=excluded.payload_hash
    returning id into proposed_row.id;
    update private.velocity_held_assessments set import_row_id = proposed_row.id where observation_id = oid;
    batch_ids := array_append(batch_ids, staged_batch_id);
    staged := staged + 1;
  end loop;
  return jsonb_build_object(
    'staged', staged,'duplicates',duplicates,'blocked',blocked,
    'batchIds', array(select distinct unnest(batch_ids)),
    'correctionBatchIds', array(select distinct unnest(correction_ids))
  );
end;
$$;

-- A published-result detail edit can start from Viewer even if no source hold
-- links to that result. The existing correction approval still owns the write.
create function private.velocity_held_published_detail(input jsonb, submit boolean)
returns jsonb language plpgsql set search_path = '' as $$
declare
  result_kind text := input->>'kind';
  result_id text := input->>'recordId';
  current_data jsonb;
  replacement jsonb;
  patch jsonb := input->'patch';
  source_url text := input->>'evidenceUrl';
  review_reason text := btrim(input->>'reason');
  collector uuid;
  correction_id uuid;
  age text := patch->>'age';
begin
  if coalesce(result_kind,'') not in ('swim','relay')
    or coalesce(result_id,'') !~ '^[a-zA-Z0-9_-]{1,180}$' then
    raise invalid_parameter_value using message = 'Select a published swim or relay.';
  end if;
  current_data := private.collection_snapshot(private.velocity_import_path(result_kind, result_id));
  if current_data is null or current_data->>'teamId' is distinct from 'velocity-swimming' then
    raise sqlstate 'PT404' using message = 'Published result was not found.';
  end if;
  if not submit then return jsonb_build_object('current',current_data); end if;
  if current_data is distinct from input->'expected' then
    raise sqlstate 'PT409' using message = 'The published result changed. Refresh and review it again.';
  end if;
  if jsonb_typeof(patch) is distinct from 'object' or patch = '{}'::jsonb or pg_column_size(patch) > 20000
    or not private.velocity_held_safe_url(source_url) or not coalesce(length(review_reason) between 5 and 1000, false)
    or exists (select 1 from jsonb_object_keys(patch) k
      where k not in ('age','ageGroup','members','splits','splitCoverage')
        or (result_kind = 'swim' and k = 'members') or (result_kind = 'relay' and k = 'age')) then
    raise invalid_parameter_value using message = 'A detail correction requires verified fields, a reason and an evidence URL.';
  end if;
  if (patch ? 'age' and age is not null and age !~ '^(0|[1-9][0-9]?|1[01][0-9]|120)$')
    or (patch->>'ageGroup' is not null and public.ies_times_age_range(patch->>'ageGroup') is null)
    or (patch ? 'members' and jsonb_typeof(patch->'members') <> 'array')
    or (patch ? 'splits' and jsonb_typeof(patch->'splits') <> 'array')
    or jsonb_path_exists(patch,
      'strict $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(#ID|memberId|rawMemberId|dateOfBirth|dob|birthday|birthDate|signedUrl|downloadUrl)$" flag "i")') then
    raise invalid_parameter_value using message = 'Invalid age, lineup or splits.';
  end if;
  replacement := current_data || (patch - 'age');
  if patch ? 'age' then replacement := replacement || jsonb_build_object('ageAtSwim', age::integer); end if;
  perform private.validate_result_splits(replacement, split_part(replacement->>'eventCode','_',1)::integer,
    (replacement->>'timeMs')::bigint);
  if result_kind = 'relay' and patch ? 'members' and (
    jsonb_array_length(replacement->'members') > 4 or exists(
      select 1 from jsonb_array_elements(replacement->'members') m where coalesce(m->>'leg','') !~ '^[1-4]$'
        or nullif(btrim(m->>'name'),'') is null
        or (m->>'athleteId' is not null and not exists(select 1 from public.athletes a where a.id = m->>'athleteId'))
    ) or exists(
      select 1 from jsonb_array_elements(replacement->'members') m group by m->>'leg' having count(*) > 1
    )
  ) then raise invalid_parameter_value using message = 'Verify unique ordered relay legs and listed swimmers.'; end if;
  if replacement = current_data then
    raise invalid_parameter_value using message = 'The proposed details match the published result.';
  end if;

  select w.id into collector from private.collection_workers w
  where w.revoked_at is null and 'times' = any(w.divisions)
    and exists(select 1 from private.velocity_held_observations o where o.worker_id = w.id)
  order by w.id limit 1;
  if collector is null then raise sqlstate 'PT409' using message = 'A Times archive collector is required.'; end if;
  correction_id := private.velocity_held_stage_correction(collector, result_kind, result_id, current_data,
    replacement, source_url, review_reason);
  return jsonb_build_object('correctionBatchId',correction_id);
end;
$$;

create function private.velocity_held_staff(input jsonb)
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
    when 'decision' then return private.velocity_held_record_decision(input);
    when 'revalidate' then return private.velocity_held_refresh((input->>'afterId')::uuid, 100, (input->>'decisionId')::uuid);
    when 'scan' then return private.velocity_held_refresh((input->>'afterId')::uuid, 100);
    when 'submit' then return private.velocity_held_submit(input);
    when 'record' then return private.velocity_held_published_detail(input, false);
    when 'correction' then return private.velocity_held_published_detail(input, true);
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

create function public.velocity_held_observations(input jsonb)
returns jsonb language sql set search_path = '' as $$
  select private.velocity_held_staff(input);
$$;

revoke all on function
  private.velocity_held_safe_url(text),
  private.stage_velocity_held_observations(text, jsonb),
  public.stage_velocity_held_observations(text, jsonb),
  private.velocity_held_applies(private.velocity_held_decisions, private.velocity_held_observations),
  private.velocity_held_affected(private.velocity_held_decisions, uuid),
  private.velocity_held_athlete_name(jsonb),
  private.velocity_held_json(private.velocity_held_review),
  private.velocity_held_age_group(text),
  private.velocity_held_find_result(text, jsonb),
  private.velocity_held_evaluate(private.velocity_held_observations, text),
  private.velocity_held_write_assessment(uuid,jsonb),
  private.velocity_held_list(jsonb),
  private.velocity_held_detail(uuid),
  private.velocity_held_record_decision(jsonb),
  private.velocity_held_refresh(uuid,integer,uuid),
  private.velocity_held_submit(jsonb),
  private.velocity_held_published_detail(jsonb,boolean),
  private.velocity_held_staff(jsonb),
  public.velocity_held_observations(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.stage_velocity_held_observations(text, jsonb),
  public.stage_velocity_held_observations(text, jsonb) to anon, authenticated;
grant execute on function private.velocity_held_staff(jsonb),
  public.velocity_held_observations(jsonb) to authenticated;

notify pgrst, 'reload schema';
