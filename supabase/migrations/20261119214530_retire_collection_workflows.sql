-- Run after the Data UI is live. Retain canonical data and the evidence it needs.
set local statement_timeout='300s';
set local lock_timeout='10s';
select pg_advisory_xact_lock(hashtext('velocity-records'));
select pg_advisory_xact_lock(hashtext('velocity-team-record-refresh'));

create temporary table pruning_canonical_before(relation text primary key,records bigint,contents text) on commit drop;
do $$ declare relation text; records bigint; contents text; relations text[]:=array['public.swims','public.relay_results','public.athletes','public.meets','public.standards','public.standard_cuts','public.knowledge_entries','public.public_swims','public.public_relay_results','public.public_athletes','public.athlete_bests','public.team_record_holders','public.result_moderation','private.athlete_source_identities','private.result_occurrences','private.result_source_identities']; begin
 if to_regclass('private.official_meet_leadoff_attestations') is not null then relations:=array_append(relations,'private.official_meet_leadoff_attestations'); end if;
 foreach relation in array relations loop
  execute format('select count(*),md5(string_agg(md5(row::text),'','' order by md5(row::text))) from (select to_jsonb(t) as row from %s t) rows',relation) into records,contents;
  insert into pruning_canonical_before values(relation,records,contents);
 end loop;
end; $$;
insert into private.retained_athlete_identity_links
 select distinct on (r.member_hash,r.athlete_id) r.member_hash,r.athlete_id,
 jsonb_build_object('reason',r.reason,'actor',r.reviewed_by,'at',r.reviewed_at)
 from private.velocity_import_swimmer_resolutions r join public.athletes a on a.id=r.athlete_id
 order by r.member_hash,r.athlete_id,r.reviewed_at desc
 on conflict(member_hash,athlete_id) do update set evidence=excluded.evidence;

create table private.retained_result_sources (
 record_path text not null, source_key text not null, source_url text,
 captured_at timestamptz, actor_id uuid references auth.users(id) on delete set null,
 evidence jsonb not null, primary key(record_path,source_key)
);
alter table private.retained_result_sources enable row level security;
revoke all on private.retained_result_sources from public,anon,authenticated;

-- Only evidence that actually links to a retained canonical entity survives.
insert into private.retained_result_sources(record_path,source_key,source_url,captured_at,actor_id,evidence)
select case r.kind when 'catalog_meet' then 'knowledge_entries/'||r.record_id else private.result_path(r.kind,r.record_id) end,
 'import:'||r.id,b.source_url,b.captured_at,r.reviewed_by,
 jsonb_strip_nulls(jsonb_build_object('sha256',b.sha256,'locator',r.locator,'reviewedAt',r.reviewed_at,'method',r.data#>>'{metadata,source}'))
from private.velocity_import_rows r join private.velocity_import_batches b on b.id=r.batch_id
where (r.kind='swim' and exists(select 1 from public.swims where id=r.record_id))
 or (r.kind='relay' and exists(select 1 from public.relay_results where id=r.record_id))
 or (r.kind='meet' and exists(select 1 from public.meets where id=r.record_id))
 or (r.kind='catalog_meet' and exists(select 1 from public.knowledge_entries where id=r.record_id));

insert into private.retained_result_sources(record_path,source_key,source_url,captured_at,actor_id,evidence)
select distinct w->>'path','batch:'||b.id,b.source_url,b.captured_at,b.reviewed_by,
 jsonb_strip_nulls(jsonb_build_object('method',b.evidence->>'method','reviewedAt',b.reviewed_at,'note',nullif(b.review_note,'')))
from public.collection_batches b cross join lateral jsonb_array_elements(b.writes) w
where exists(select 1 from public.app_records where path=w->>'path');

insert into private.retained_result_sources(record_path,source_key,source_url,captured_at,actor_id,evidence)
select distinct private.result_path(o.kind,links.record_id),'held:'||o.id,o.source_url,o.captured_at,null::uuid,
 jsonb_build_object('sourceMeetId',o.source_meet_id,'workbookSha256',o.workbook_sha256,'sourceRow',o.source_row,'round',o.round,'sourceClubCode',o.club_code)
from private.velocity_held_observations o
join (select observation_id,record_id from private.velocity_held_assessments
 union select observation_id,record_id from private.velocity_official_archive_acceptances) links on links.observation_id=o.id
where (o.kind='swim' and exists(select 1 from public.swims where id=links.record_id))
 or (o.kind='relay' and exists(select 1 from public.relay_results where id=links.record_id));

create function private.leadoff_attestation_binding(body jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object(
  'id',body->'id','athleteId',body->'athleteId','teamId',body->'teamId','eventCode',body->'eventCode',
  'distance',body->'distance','stroke',body->'stroke','course',body->'course','round',body->'round','gender',body->'gender',
  'timeMs',body->'timeMs','status',body->'status','isOfficial',body->'isOfficial',
  'isRelay',coalesce(body->'isRelay','false'),'isSplit',coalesce(body->'isSplit','false'),'isRelaySplit',coalesce(body->'isRelaySplit','false'),
  'resultOrigin',body->'resultOrigin','parentRelayResultId',body->'parentRelayResultId',
  'meetId',body#>'{meet,id}','date',body#>'{meet,date}',
  'occurrence',coalesce(body#>'{raceIdentity,occurrence}','"single"'), 'proof',body->'leadOffVerification');
$$;
create table private.result_source_attestations (
 result_id text primary key references public.swims(id) on delete cascade,
 binding jsonb not null, evidence jsonb not null, retained_at timestamptz not null default now()
);
alter table private.result_source_attestations enable row level security;
revoke all on private.result_source_attestations from public,anon,authenticated;
create temporary table pruning_leadoff_before on commit drop as
select id,private.velocity_official_source_leadoff(data) as eligible
from public.swims where data->>'resultOrigin'='relay_leadoff' and parent_relay_result_id is null;

insert into private.result_source_attestations(result_id,binding,evidence)
select s.id,private.leadoff_attestation_binding(s.data),jsonb_build_object(
 'observationId',o.id,'sourceUrl',o.source_url,'sourceMeetId',o.source_meet_id,'workbookSha256',o.workbook_sha256,
 'sourceRow',o.source_row,'sourceClubCode',o.club_code,'observed',o.observed-'raw',
 'sourceDisplay',o.observed#>>array['raw',jsonb_build_object('F','Final','P','Prelim','TT','Trial','S','Swim-off')->>o.round],
 'decisionId',d.id,'patch',d.patch,'reason',d.reason,'reviewedBy',d.reviewed_by,'reviewedAt',d.created_at,'reviewedAffiliation',d.reviewed_affiliation)
from public.swims s
join pruning_leadoff_before verified on verified.id=s.id and verified.eligible
join private.velocity_held_observations o on o.id::text=s.data#>>'{leadOffVerification,observationId}'
join private.velocity_held_decisions d on d.id::text=s.data#>>'{leadOffVerification,decisionId}'
where s.data->>'resultOrigin'='relay_leadoff' and s.parent_relay_result_id is null;

insert into private.retained_result_sources(record_path,source_key,source_url,captured_at,actor_id,evidence)
select 'swims/'||result_id,'attestation:'||result_id,evidence->>'sourceUrl',(evidence->>'reviewedAt')::timestamptz,
 (evidence->>'reviewedBy')::uuid,evidence from private.result_source_attestations;

create function private.retained_source_leadoff(body jsonb) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.result_source_attestations a
  join public.meets m on m.id=body#>>'{meet,id}'
  where a.result_id=body->>'id' and a.binding=private.leadoff_attestation_binding(body)
   and (select count(*)=1 and min(t.athlete_id)=body->>'athleteId' from private.source_swimmer_targets(body#>>'{leadOffVerification,memberIdHash}') t)
   and body#>>'{meet,date}' between coalesce(m.data->>'startsOn',m.data->>'startDate',m.data#>>'{dates,startDate}')
    and coalesce(m.data->>'endsOn',m.data->>'endDate',m.data#>>'{dates,endDate}',m.data->>'startsOn',m.data->>'startDate',m.data#>>'{dates,startDate}'))
 and not exists(select 1 from public.swims s where s.id<>body->>'id' and s.data->>'resultOrigin'='relay_leadoff'
  and s.parent_relay_result_id is not null and s.athlete_id=body->>'athleteId' and s.meet_id=body#>>'{meet,id}'
  and s.event_code=body->>'eventCode' and s.data#>>'{meet,date}'=body#>>'{meet,date}' and s.round=body->>'round'
  and coalesce(s.data#>>'{raceIdentity,occurrence}','single')=coalesce(body#>>'{raceIdentity,occurrence}','single'));
$$;
revoke all on function private.retained_source_leadoff(jsonb),private.leadoff_attestation_binding(jsonb) from public,anon,authenticated,service_role;

do $$ declare definition text; begin
 if exists(select 1 from pruning_leadoff_before verified join public.swims s on s.id=verified.id
  where verified.eligible is distinct from private.retained_source_leadoff(s.data)) then
  raise exception 'Lead-off validation changed during retirement'; end if;
 definition:=pg_get_functiondef('private.validate_relay_leadoff()'::regprocedure);
 if position('private.velocity_official_source_leadoff' in definition)=0 then raise exception 'Expected lead-off validator'; end if;
 execute replace(definition,'private.velocity_official_source_leadoff','private.retained_source_leadoff');
 definition:=pg_get_functiondef('private.read_result_moderation(text,text)'::regprocedure);
 definition:=replace(definition,$old$select source_url,evidence,captured_at from public.collection_batches
  where writes @> jsonb_build_array(jsonb_build_object('path',case kind when 'swim' then 'swims/' else 'relay_results/' end||rid))$old$,
 $new$select source_url,evidence,captured_at from private.retained_result_sources
  where record_path=private.result_path(kind,rid)$new$);
 if position('public.collection_batches' in definition)>0 then raise exception 'Moderation source migration did not match'; end if;
 execute definition;
end; $$;

-- Private source identities remain. Only export/review revision machinery is retired.
do $$ declare t record; begin
 for t in select tgrelid::regclass as relation,tgname from pg_trigger where not tgisinternal and tgfoid='private.advance_canonical_revision()'::regprocedure loop
  execute format('drop trigger %I on %s',t.tgname,t.relation);
 end loop;
end; $$;
drop trigger meet_collection_work_check on public.meet_collection_work;
drop view public.collection_batch_queue;
drop function private.velocity_held_json(private.velocity_held_review);
drop view private.velocity_held_review;
drop function public.meet_collection_queue(jsonb);
drop function private.meet_collection_queue(jsonb);
drop function public.review_collection(uuid,text,text);
drop function private.stage_collection(text,jsonb);
drop function public.stage_collection(text,jsonb);
drop function private.collection_review_summary(jsonb);
drop function private.review_collection(uuid,text,text);
drop function private.check_meet_collection_work();
drop index public.velocity_import_people_name_idx;
drop index public.velocity_import_team_name_idx;
drop function private.velocity_import_normalize_name(text);
drop function public.stage_velocity_import(text,jsonb);
drop function private.velocity_import_swimmer_group(text);
drop function private.velocity_import_can_match_swimmer(private.velocity_import_rows,text);
drop function private.validate_collection_identity_claims(jsonb,jsonb);
drop function public.private_race_baseline_page(text,text,integer,text);
drop function private.velocity_import_swimmer_match_version(uuid[]);
drop function private.stage_velocity_import(text,jsonb);
drop function private.velocity_import_swimmer_matches(jsonb);
drop function public.velocity_import_swimmer_matches(jsonb);
drop function private.resolve_velocity_import_swimmer(jsonb);
drop function public.resolve_velocity_import_swimmer(jsonb);
drop function private.approve_velocity_import(uuid);
drop function private.velocity_import_current_blocker(text,text);
drop function private.velocity_import_preview_prerequisites(uuid);
drop function private.velocity_import_sort(text);
drop function private.velocity_import_path(text,text);
drop function private.velocity_import_same_result(jsonb,jsonb);
drop function private.velocity_import_record_check(text,text,jsonb);
drop function private.velocity_import_references(text,jsonb,jsonb);
drop function private.velocity_import_prerequisite_issue(text,text,jsonb,jsonb);
drop function private.velocity_import_matches(text,text,uuid);
drop function private.velocity_official_archive_receipt(private.velocity_official_archive_runs,integer);
drop function private.velocity_accept_official_archive(integer);
drop function private.velocity_official_archive_status();
drop function private.velocity_held_detail(uuid);
drop function private.velocity_import_prepare_selection(uuid);
drop function public.velocity_import_queue(jsonb);
drop function private.velocity_import_detail(jsonb);
drop function public.velocity_import_detail(jsonb);
drop function private.approve_velocity_import_selection(uuid);
drop function public.approve_velocity_import(uuid);
drop function public.velocity_import_selection(jsonb);
drop function private.velocity_import_base_issue(private.velocity_import_rows,uuid,boolean);
drop function private.velocity_import_hytek_swim_digest(jsonb,text);
drop function private.velocity_import_swimmer_member(private.velocity_import_rows);
drop function private.velocity_import_swimmer_identity_targets(text);
drop function private.velocity_import_summary(private.velocity_import_rows,timestamp with time zone,boolean);
drop function private.velocity_import_issue(private.velocity_import_rows,uuid,boolean);
drop function private.velocity_import_row_json(private.velocity_import_rows,timestamp with time zone,boolean,text);
drop function private.velocity_import_issues(jsonb);
drop function public.velocity_import_issues(jsonb);
drop function private.velocity_import_clean_pending_swims();
drop function private.velocity_import_match_ids(text,text,uuid);
drop function private.velocity_import_queue(jsonb);
drop function private.velocity_import_selection(jsonb);
drop function private.reduce_velocity_import_approval_batch(uuid);
drop function public.reduce_velocity_import_approval_batch(uuid);
drop function private.velocity_held_stage_correction(uuid,text,text,jsonb,jsonb,text,text);
drop function private.velocity_held_safe_url(text);
drop function private.velocity_held_applies(private.velocity_held_decisions,private.velocity_held_observations);
drop function private.velocity_held_affected(private.velocity_held_decisions,uuid);
drop function private.velocity_held_athlete_name(jsonb);
drop function private.velocity_held_age_group(text);
drop function private.velocity_held_find_result(text,jsonb);
drop function private.velocity_held_write_assessment(uuid,jsonb);
drop function private.velocity_held_list(jsonb);
drop function private.velocity_held_record_decision(jsonb);
drop function private.velocity_held_refresh(uuid,integer,uuid);
drop function private.velocity_held_submit(jsonb);
drop function private.velocity_held_published_detail(jsonb,boolean);
drop function private.stage_velocity_held_observations(text,jsonb);
drop function public.stage_velocity_held_observations(text,jsonb);
drop function public.velocity_held_observations(jsonb);
drop function private.velocity_held_review_metadata(jsonb,text,text);
drop function private.velocity_held_review_decision(jsonb);
drop function private.velocity_held_approve_swimmer(jsonb);
drop function private.velocity_official_archive_source();
drop function private.velocity_official_archive_evaluate(private.velocity_held_observations,text);
drop function private.velocity_held_staff(jsonb);
drop function private.velocity_gomotion_swimmer_name_basis(text,text,jsonb);
drop function private.velocity_held_evaluate(private.velocity_held_observations,text);
drop function private.velocity_reconcile_official_swimmer_page(uuid,integer);
drop function private.velocity_held_evaluate_base(private.velocity_held_observations,text);
drop function private.velocity_official_source_leadoff(jsonb);
drop function private.advance_canonical_revision();
drop function private.update_bests_after_import(text[]);
drop table private.velocity_held_swimmer_approvals;
drop table private.velocity_official_archive_acceptances;
drop table private.velocity_official_archive_runs;
drop table private.velocity_held_assessments;
drop table private.velocity_held_decisions;
drop table private.velocity_held_observations;
drop table private.velocity_import_selection_rows;
drop table private.velocity_import_selections;
alter table private.velocity_import_rows drop constraint velocity_import_rows_swimmer_resolution_id_fkey;
drop table private.velocity_import_swimmer_resolutions;
drop table private.velocity_import_rows;
drop table private.velocity_import_batches;
drop table public.collection_reviews;
drop table public.collection_batches;
drop table public.meet_collection_work;
drop function public.collect_records(jsonb,jsonb);
drop table private.collection_workers;
drop table private.canonical_revision;

-- Prepared imports used evidence-record roots in the former Firebase adapter.
delete from public.evidence_records where root in ('import_batches','import_review_items','import_state','sync_requests');
create function private.reject_retired_import_evidence() returns trigger language plpgsql set search_path='' as $$
begin
 if split_part(new.path,'/',1) in ('import_batches','import_review_items','import_state','sync_requests') then
  raise exception 'Import staging has been retired. Use direct result management.';
 end if;
 return new;
end; $$;
revoke all on function private.reject_retired_import_evidence() from public,anon,authenticated,service_role;
create trigger reject_retired_import_evidence before insert or update on public.evidence_records for each row execute function private.reject_retired_import_evidence();

do $$ declare prior record; records bigint; contents text; begin
 for prior in select * from pruning_canonical_before loop
  execute format('select count(*),md5(string_agg(md5(row::text),'','' order by md5(row::text))) from (select to_jsonb(t) as row from %s t) rows',prior.relation) into records,contents;
  if records<>prior.records or contents is distinct from prior.contents then raise exception 'Retirement changed retained records in %',prior.relation; end if;
 end loop;
end; $$;

-- A compact receipt records the exact locked before/after comparison, including
-- any legitimate canonical additions made by other work before this migration.
insert into private.result_change_log(record_path,actor_id,source,changes)
select 'system/retire-collection-workflows',auth.uid(),jsonb_build_object('method','schema_migration','migration','retire_collection_workflows','databaseActor',current_user),
 jsonb_build_object('canonicalUnchanged',true,'checksumMethod','md5 of sorted complete-row md5 values','relations',jsonb_object_agg(relation,jsonb_build_object('records',records,'checksum',contents)),
  'retainedSourceRecords',(select count(*) from private.retained_result_sources),
  'retainedLeadOffAttestations',(select count(*) from private.result_source_attestations))
from pruning_canonical_before;
