-- Record calculations run after publication, never on a page request. Keep only
-- winning IDs/eligibility metadata; names and relay lineups still come from the
-- current public projections, with their RLS and moderation checks.
create table public.team_record_holders (
  team text not null,
  course text not null,
  event text not null,
  gender text not null,
  age_group text not null,
  result_type text not null check (result_type in ('swim','relay')),
  result_id text not null,
  athlete_id text not null,
  swim_date text not null,
  time_ms bigint not null,
  relay boolean not null,
  age integer,
  relay_age text not null,
  primary key (team,course,event,gender,age_group,result_type,result_id)
);
alter table public.team_record_holders enable row level security;
revoke all on public.team_record_holders from public,anon,authenticated;
grant select on public.team_record_holders to anon,authenticated;
create policy public_read on public.team_record_holders for select to anon,authenticated
  using (exists (select 1 from public.public_times_teams t where t.id=team)
    and case when result_type='relay' then
      exists (select 1 from public.public_relay_results r where r.id=result_id)
    else exists (select 1 from public.public_swims s
      join public.public_athletes a on a.id=s.athlete_id where s.id=result_id) end);

create table public.team_record_refresh_state (
  id boolean primary key default true check (id),
  refreshed_at timestamptz
);
alter table public.team_record_refresh_state enable row level security;
revoke all on public.team_record_refresh_state from public,anon,authenticated;
grant select on public.team_record_refresh_state to anon,authenticated;
create policy public_read on public.team_record_refresh_state for select to anon,authenticated using (true);
insert into public.team_record_refresh_state(id) values(true);

-- One marker per publishing transaction: bulk imports do not rebuild records or
-- contend on a shared dirty flag. Consume exactly the markers visible BEFORE a
-- refresh, so concurrent/uncommitted imports cannot lose their refresh request.
create table private.team_record_refresh_queue (
  transaction_id bigint primary key
);
alter table private.team_record_refresh_queue enable row level security;
revoke all on private.team_record_refresh_queue from public,anon,authenticated;

create function private.queue_team_record_refresh() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into private.team_record_refresh_queue values(txid_current()) on conflict do nothing;
  return null;
end;
$$;
revoke all on function private.queue_team_record_refresh() from public,anon,authenticated;

create trigger queue_team_record_refresh after insert or update or delete or truncate on public.public_swims
  for each statement execute function private.queue_team_record_refresh();
create trigger queue_team_record_refresh after insert or update or delete or truncate on public.public_relay_results
  for each statement execute function private.queue_team_record_refresh();
create trigger queue_team_record_refresh after insert or update or delete or truncate on public.public_athletes
  for each statement execute function private.queue_team_record_refresh();
create trigger queue_team_record_refresh after insert or update or delete or truncate on public.result_moderation
  for each statement execute function private.queue_team_record_refresh();
create trigger queue_team_record_refresh after insert or update or delete or truncate on public.public_times_teams
  for each statement execute function private.queue_team_record_refresh();

-- Only the database owner runs this private worker (cron or a maintenance SQL
-- session). No public RPC can request a rebuild. DELETE + INSERT is atomic and
-- lets readers continue seeing the previous committed board during a refresh.
create function private.refresh_team_records() returns boolean
language plpgsql security invoker set search_path='' as $$
declare consumed bigint[];
begin
  if not pg_try_advisory_xact_lock(hashtext('velocity-team-record-refresh')) then return false; end if;
  select array_agg(transaction_id) into consumed from private.team_record_refresh_queue;
  if consumed is null then return false; end if;

  delete from public.team_record_holders;
  insert into public.team_record_holders
    (team,course,event,gender,age_group,result_type,result_id,athlete_id,swim_date,time_ms,relay,age,relay_age)
  with flagged_swims as (
    select result_id from public.result_moderation where flagged and result_type='swim'
  ), flagged_relays as (
    select result_id from public.result_moderation where flagged and result_type='relay'
  ), eligible as materialized (
    select s.times_team as team,s.id,s.athlete_id,s.swim_date as date,s.times_course as course,
      s.times_event as event,s.times_time as time,s.times_relay as relay,s.times_gender as gender,
      case when not s.times_relay then s.times_age end as age,
      case when s.times_relay then coalesce(s.data->>'ageGroup','') else '' end as relay_age,
      'swim'::text as result_type
    from public.public_swims s
    join public.public_times_teams t on t.id=s.times_team
    join public.public_athletes a on a.id=s.athlete_id
    where s.times_status='OK' and s.times_time>0 and s.times_gender in ('F','M','X')
      and s.times_leg is null and not s.times_split
      and not exists (select 1 from flagged_swims m where m.result_id=s.id)
      and not exists (select 1 from flagged_relays m where m.result_id=s.data->>'parentRelayResultId')
    union all
    select s.team_id,s.id,''::text,s.swim_date,s.times_course,s.times_event,s.times_time,true,
      s.data->>'gender',null::integer,coalesce(s.data->>'ageGroup',''),'relay'
    from public.public_relay_results s join public.public_times_teams t on t.id=s.team_id
    where s.data->>'status'='OK' and s.times_time>0 and s.data->>'gender' in ('F','M','X')
      and not exists (select 1 from flagged_relays m where m.result_id=s.id)
  ), fastest_by_age as (
    -- Preserve the upstream optimization: a slower swim in an identical age
    -- category cannot win any enclosing age group. Expand only its fastest ties.
    select e.*,rank() over(partition by team,course,event,gender,relay,age,relay_age order by time) as age_rank
    from eligible e
  ), defaults as materialized (
    select unnest(array['8&U','9-10','11-12','13-14','15-16','17-18','19&O','10&U','12&U','13&O','15&O','Open']) as age_group
  ), groups as materialized (
    select null::text as team,age_group,public.ies_times_age_range(age_group) as ages from defaults
    union all
    select distinct team,relay_age,public.ies_times_age_range(relay_age) from eligible
    where relay and relay_age<>'' and relay_age not in (select age_group from defaults)
  ), categorized as (
    select e.*,g.age_group from fastest_by_age e join groups g
      on (g.team is null or g.team=e.team)
      and case when e.relay then e.relay_age<>'' and
        (e.relay_age=g.age_group or g.ages @> public.ies_times_age_range(e.relay_age))
      else g.ages @> e.age end
    where e.age_rank=1
  ), fastest as (
    select e.*,min(time) over(partition by team,course,event,gender,age_group) as fastest from categorized e
  ), holders as (
    select f.*,row_number() over(partition by team,course,event,gender,age_group,
      case when relay then id else athlete_id end order by date,id) as pick
    from fastest f where time=fastest
  )
  select team,course,event,gender,age_group,result_type,id,
    case when relay then '' else athlete_id end,date,time,relay,age,relay_age
  from holders where pick=1;

  update public.team_record_refresh_state set refreshed_at=clock_timestamp() where id;
  delete from private.team_record_refresh_queue where transaction_id=any(consumed);
  return true;
end;
$$;
revoke all on function private.refresh_team_records() from public,anon,authenticated;

create function public.ies_team_records(team_id text) returns jsonb
language sql stable security invoker set search_path='' as $$
  with selected as materialized (
    select h.* from public.team_record_holders h where h.team=team_id
      and exists(select 1 from public.public_times_teams t where t.id=team_id)
  ), races as materialized (
    select result_id,public.ies_times_json_id(result_id) as race
    from (select distinct result_id from selected) ids
  ), current_holders as materialized (
    select h.*,r.race from selected h join races r using(result_id)
    -- Exclude deleted, hidden, flagged and edited winners immediately, even
    -- before cron promotes a replacement. Never serve stale eligibility data.
    where r.race->>'team'=h.team and r.race->>'course'=h.course and r.race->>'event'=h.event
      and r.race->>'gender'=h.gender and r.race->>'resultType'=h.result_type
      and r.race->>'athleteId'=h.athlete_id and r.race->>'date'=h.swim_date
      and (r.race->>'time')::bigint=h.time_ms and (r.race->>'relay')::boolean=h.relay
      and (h.relay or (r.race->>'ageAtSwim')::integer is not distinct from h.age)
      and (not h.relay or coalesce(r.race->>'relayAgeGroup','')=h.relay_age)
      and (r.race->>'calculationEligible')::boolean
  ), cells as (
    select course||':'||age_group||':'||event||':'||gender as key,
      jsonb_agg(result_id order by swim_date,athlete_id,result_id) as holders
    from current_holders group by course,age_group,event,gender
  )
  select jsonb_build_object(
    'records',coalesce((select jsonb_object_agg(key,holders) from cells),'{}'),
    -- Retain the compact, unique winners list for older clients and event labels.
    'races',coalesce((select jsonb_agg(race order by race->>'course',race->>'event',race->>'gender',race->>'date',race->>'id')
      from (select distinct result_id,race from current_holders) winners),'[]'),
    'recordsUpdatedAt',(select refreshed_at from public.team_record_refresh_state where id)
  );
$$;
revoke all on function public.ies_team_records(text) from public;
grant execute on function public.ies_team_records(text) to anon,authenticated,service_role;

-- Replace only records; preserve all other query paths and their later patches.
do $migration$
declare definition text; begin_at integer; end_at integer;
begin
  select pg_get_functiondef('public.ies_times_query(text,jsonb)'::regprocedure) into definition;
  begin_at:=strpos(definition,' elsif query_kind=''records'' then');
  end_at:=strpos(definition,' elsif query_kind=''athletes'' then');
  if begin_at=0 or end_at<=begin_at then raise exception 'Cannot locate records query branch'; end if;
  definition:=left(definition,begin_at-1)||$replacement$
 elsif query_kind='record_teams' then
  select jsonb_build_object('teams',coalesce(jsonb_agg(jsonb_build_array(id,name) order by name,id),'[]'))
  into answer from public.public_times_teams;
 elsif query_kind='records' then
  answer:=public.ies_team_records(input->>'team');
$replacement$||substr(definition,end_at);
  execute definition;
end;
$migration$;

-- Seed the board once. Subsequent refreshes do nothing if no inputs changed.
insert into private.team_record_refresh_queue values(txid_current()) on conflict do nothing;
select private.refresh_team_records();
create extension if not exists pg_cron;
select cron.schedule('refresh-team-records','*/5 * * * *','select private.refresh_team_records()');
