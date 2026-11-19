-- Original meet PDFs can verify first-leg swims independently of GoMotion.
-- Only trusted maintenance may register an attestation; public clients cannot
-- self-certify a time by supplying a URL or a verification boolean.
create function private.meet_leadoff_binding(body jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('id',body->'id','athleteId',body->'athleteId','teamId',body->'teamId',
  'eventCode',body->'eventCode','distance',body->'distance','stroke',body->'stroke','course',body->'course',
  'timeMs',body->'timeMs','round',body->'round','gender',body->'gender','ageAtSwim',body->'ageAtSwim',
  'isOfficial',body->'isOfficial','status',body->'status','isRelay',coalesce(body->'isRelay','false'),
  'isSplit',coalesce(body->'isSplit','false'),'isRelaySplit',coalesce(body->'isRelaySplit','false'),
  'resultOrigin',body->'resultOrigin','parentRelayResultId',body->'parentRelayResultId',
  'meetId',body#>'{meet,id}','date',body#>'{meet,date}',
  'occurrence',coalesce(body#>'{raceIdentity,occurrence}','"single"'),
  'proof',body->'leadOffVerification');
$$;
create table private.official_meet_leadoff_attestations (
 id uuid primary key,
 result_id text not null unique references public.swims(id) on delete cascade deferrable initially deferred,
 binding jsonb not null,
 evidence jsonb not null check (jsonb_typeof(evidence)='object'),
 reviewed_at timestamptz not null default now()
);
alter table private.official_meet_leadoff_attestations enable row level security;
revoke all on private.official_meet_leadoff_attestations from public,anon,authenticated,service_role;

create function private.reviewed_meet_leadoff(body jsonb) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(body->>'resultOrigin'='relay_leadoff'
  and body->>'parentRelayResultId' is null and body->>'isRelay'='false'
  and coalesce(body->>'isSplit','false')='false' and coalesce(body->>'isRelaySplit','false')='false'
  and body->>'status'='OK' and body->'isOfficial'='true'::jsonb
  and body->>'eventCode' ~ '^(25|50|100|200)_(FR|BK)_(SCY|SCM|LCM)$'
  and body->>'eventCode'=(body->>'distance')||'_'||(body->>'stroke')||'_'||(body->>'course')
  and body#>>'{leadOffVerification,method}'='Official meet result'
  and body#>'{leadOffVerification,verified}'='true'::jsonb
  and body#>'{leadOffVerification,flatStart}'='true'::jsonb
  and body#>'{leadOffVerification,timingVerified}'='true'::jsonb
  and body#>>'{leadOffVerification,leadOffStatus}'='OK'
  and exists(select 1 from private.official_meet_leadoff_attestations a
   join public.meets m on m.id=body#>>'{meet,id}'
   where a.id::text=body#>>'{leadOffVerification,attestationId}' and a.result_id=body->>'id'
    and a.binding=private.meet_leadoff_binding(body)
    and a.evidence->>'sourceUrl'=body#>>'{leadOffVerification,sourceUrl}'
    and body#>>'{meet,date}' between coalesce(m.data->>'startsOn',m.data->>'startDate',m.data#>>'{dates,startDate}')
     and coalesce(m.data->>'endsOn',m.data->>'endDate',m.data#>>'{dates,endDate}',m.data->>'startsOn',m.data->>'startDate',m.data#>>'{dates,startDate}')),false);
$$;
revoke all on function private.meet_leadoff_binding(jsonb),private.reviewed_meet_leadoff(jsonb) from public,anon,authenticated,service_role;

do $$ declare definition text; old_condition text; begin
 definition:=pg_get_functiondef('private.validate_relay_leadoff()'::regprocedure);
 -- Support both the retained-source migration and the earlier archive guard.
 old_condition:=case when position('if not private.retained_source_leadoff(new.data) then' in definition)>0
  then 'if not private.retained_source_leadoff(new.data) then'
  else 'if not private.velocity_official_source_leadoff(new.data) then' end;
 if position(old_condition in definition)=0 then raise exception 'Expected parentless first-leg source guard'; end if;
 execute replace(definition,old_condition,replace(old_condition,' then',' and not private.reviewed_meet_leadoff(new.data) then'));
end; $$;
