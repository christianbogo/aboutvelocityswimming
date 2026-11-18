\set ON_ERROR_STOP on
begin;
-- All synthetic fixtures and temporary clears are restored by the final rollback.
delete from public.workshare_tickets;
delete from public.workshare_account_requirements;
delete from public.workshare_seasons;
delete from public.workshare_ticket_create_keys;
delete from public.workshare_accounts;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values('33333333-3333-4333-8333-333333333333','ticket-staff@example.test',now(),'{}','{}'),
('44444444-4444-4444-8444-444444444444','ticket-family@example.test',now(),'{}','{}');
insert into public.administrators(user_id) values('33333333-3333-4333-8333-333333333333');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}',true);
do $$
declare
  a jsonb; b jsonb; first_season jsonb; next_season jsonb; req jsonb; edited_req jsonb; ticket jsonb; edited_ticket jsonb; copy jsonb;
  payload jsonb; summaries jsonb; listing jsonb; core_version text; i integer;
  first_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  next_id uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
begin
  assert public.list_workshare_seasons()='[]'::jsonb, 'No guessed season is seeded';
  a := public.save_workshare_account('{"fullName":"Ticket Account","emails":[],"athletes":[],"currentSeason":null,"generalHoursRequired":null,"starlightHoursRequired":0,"appleCapitalHoursRequired":16,"isArchived":false}');
  b := public.save_workshare_account('{"fullName":"Archived Account","emails":[],"athletes":[],"isArchived":true}');
  core_version := a->>'updatedAt';
  first_season := public.create_workshare_season(jsonb_build_object('id',first_id,'name','First Season','startsOn','2026-01-01','endsOn','2026-12-31','copyFromSeasonId',null));
  assert first_season=public.create_workshare_season(jsonb_build_object('id',first_id,'name','First Season','startsOn','2026-01-01','endsOn','2026-12-31','copyFromSeasonId',null)), 'Season creation retries are idempotent';
  begin
    update public.workshare_seasons set ends_on='2026-11-30' where id=first_id;
    raise exception 'Expected immutable season rejection';
  exception when feature_not_supported then null;
  end;
  summaries := public.list_workshare_account_summaries(first_id);
  assert jsonb_array_length(summaries)=2, 'Archived accounts remain in summaries';
  select value->'requirements' into req from jsonb_array_elements(summaries) where value->'account'->>'id'=a->>'id';
  assert req->'generalHoursRequired'='null'::jsonb and req->'starlightHoursRequired'='0'::jsonb and req->'appleCapitalHoursRequired'='16'::jsonb, 'First season adopts null, zero, and configured quotas';
  assert private.workshare_account_snapshot(a->>'id')->>'updatedAt'=core_version, 'Adoption leaves core version independent';
  edited_req := public.save_workshare_requirements(a->>'id',(req-'accountId') || '{"generalHoursRequired":12.5}');
  assert edited_req->>'updatedAt' <> req->>'updatedAt', 'Requirements have a separate version';
  assert private.workshare_account_snapshot(a->>'id')->>'updatedAt'=core_version, 'Requirement edits do not advance core version';
  begin
    perform public.save_workshare_requirements(a->>'id',req-'accountId');
    raise exception 'Expected stale requirements rejection';
  exception when serialization_failure then null;
  end;
  a := public.save_workshare_account((a-array['currentSeason','generalHoursRequired','starlightHoursRequired','appleCapitalHoursRequired']) || '{"fullName":"Renamed Ticket Account"}');
  assert a->'appleCapitalHoursRequired'='16'::jsonb, 'Core-only save preserves legacy metadata';
  begin
    perform public.save_workshare_account(a || '{"appleCapitalHoursRequired":3}');
    raise exception 'Expected legacy quota freeze';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_workshare_season(jsonb_build_object('id',gen_random_uuid(),'name','Overlap','startsOn','2026-12-31','endsOn','2027-03-01','copyFromSeasonId',first_id));
    raise exception 'Expected inclusive overlap rejection';
  exception when exclusion_violation then null;
  end;
  payload := jsonb_build_object('id',gen_random_uuid(),'accountId',a->>'id','seasonId',first_id,'completedOn','2026-06-15','description','Meet setup','category','general','hours',2.25);
  ticket := public.create_workshare_ticket(payload);
  assert ticket=public.create_workshare_ticket(payload), 'Retrying creation returns one ticket';
  assert ticket=public.create_workshare_ticket(payload || '{"hours":2.250}'), 'Idempotency normalizes numeric scale';
  begin
    delete from public.workshare_ticket_create_keys where id=(ticket->>'id')::uuid;
    raise exception 'Expected persistent create-key delete denial';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.workshare_tickets)=1, 'Creation is not duplicated';
  begin
    perform public.create_workshare_ticket(payload || '{"hours":3}');
    raise exception 'Expected mismatched retry rejection';
  exception when unique_violation then null;
  end;
  begin
    perform public.create_workshare_ticket(payload || jsonb_build_object('id',gen_random_uuid(),'hours',0));
    raise exception 'Expected positive-hour validation';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_workshare_ticket(payload || jsonb_build_object('id',gen_random_uuid(),'hours',0.001));
    raise exception 'Expected precision validation';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_workshare_ticket(payload || jsonb_build_object('id',gen_random_uuid(),'completedOn','2027-01-01'));
    raise exception 'Expected date validation';
  exception when check_violation then null;
  end;
  edited_ticket := public.update_workshare_ticket((ticket->>'id')::uuid,jsonb_build_object('updatedAt',ticket->>'updatedAt','completedOn','2026-06-16','description','Updated meet setup','category','starlight','hours',3.5));
  assert edited_ticket->>'updatedAt' <> ticket->>'updatedAt', 'Ticket edit advances its own version';
  assert public.create_workshare_ticket(payload)=edited_ticket, 'A create retry returns the current edited ticket';
  begin
    perform public.update_workshare_ticket((ticket->>'id')::uuid,jsonb_build_object('updatedAt',ticket->>'updatedAt','completedOn','2026-06-16','description','Stale','category','general','hours',1));
    raise exception 'Expected stale ticket rejection';
  exception when serialization_failure then null;
  end;
  copy := public.create_workshare_ticket((payload-'id') || jsonb_build_object('id',gen_random_uuid(),'accountId',b->>'id'));
  perform public.delete_workshare_ticket((copy->>'id')::uuid,(copy->>'updatedAt')::timestamptz);
  assert public.delete_workshare_ticket((copy->>'id')::uuid,(copy->>'updatedAt')::timestamptz)='null'::jsonb, 'Undo is repeatable';
  begin
    perform public.create_workshare_ticket((payload-'id') || jsonb_build_object('id',copy->>'id','accountId',b->>'id'));
    raise exception 'Expected deleted-copy retry rejection';
  exception when sqlstate 'P0410' then null;
  end;
  assert exists(select 1 from public.workshare_tickets where id=(ticket->>'id')::uuid), 'Undo leaves the original ticket';
  summaries := public.list_workshare_account_summaries(first_id);
  assert (select value->'completed' from jsonb_array_elements(summaries) where value->'account'->>'id'=a->>'id')='{"general":0,"starlight":3.5,"appleCapital":0}'::jsonb, 'Totals follow ticket category edits';
  assert private.workshare_account_snapshot(a->>'id')->>'updatedAt'=a->>'updatedAt', 'Tickets leave core version independent';
  assert private.workshare_requirements_snapshot(a->>'id',first_id)=edited_req, 'Tickets leave requirements independent';
  listing := public.list_workshare_tickets(jsonb_build_object('seasonId',first_id,'category','starlight','q','renamed','from','2026-06-16','to','2026-06-16','page',1));
  assert listing->'total'='1'::jsonb and jsonb_array_length(listing->'tickets')=1, 'Season/account-name/category/date filters compose';
  for i in 1..53 loop
    perform public.create_workshare_ticket((payload-'id') || jsonb_build_object('id',gen_random_uuid(),'description','Pagination ticket ' || i));
  end loop;
  listing := public.list_workshare_tickets(jsonb_build_object('seasonId',first_id,'q','Pagination','page',1));
  assert listing->'total'='53'::jsonb and jsonb_array_length(listing->'tickets')=50, 'Tickets paginate at 50';
  listing := public.list_workshare_tickets(jsonb_build_object('seasonId',first_id,'q','Pagination','page',2));
  assert jsonb_array_length(listing->'tickets')=3, 'Second page retains remaining tickets';
  next_season := public.create_workshare_season(jsonb_build_object('id',next_id,'name','Next Season','startsOn','2027-01-01','endsOn','2027-12-31','copyFromSeasonId',first_id));
  summaries := public.list_workshare_account_summaries(next_id);
  assert (select value->'requirements'->'generalHoursRequired' from jsonb_array_elements(summaries) where value->'account'->>'id'=a->>'id')='12.5'::jsonb, 'Next season copies selected source requirements';
  assert (select bool_and(value->'completed'='{"general":0,"starlight":0,"appleCapital":0}'::jsonb) from jsonb_array_elements(summaries)), 'New season starts with zero completed hours';
  assert (public.list_workshare_tickets(jsonb_build_object('seasonId',next_id)))->'total'='0'::jsonb, 'Tickets are never copied';
  perform set_config('test.workshare_ticket_id',ticket->>'id',true);
end;
$$;
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',true);
do $$
begin
  assert (select count(*) from public.workshare_tickets)=0, 'Nonstaff RLS hides tickets';
  assert (select count(*) from public.workshare_account_requirements)=0, 'Nonstaff RLS hides requirements';
  assert (select count(*) from public.workshare_seasons)=0, 'Nonstaff RLS hides seasons';
  begin
    perform public.list_workshare_seasons(); raise exception 'Expected nonstaff RPC rejection';
  exception when insufficient_privilege then null;
  end;
end;
$$;
set local role anon;
do $$
begin
  begin
    perform public.list_workshare_seasons(); raise exception 'Expected anonymous RPC rejection';
  exception when insufficient_privilege then null;
  end;
end;
$$;
rollback;
\echo 'Workshare seasons, requirements, tickets, idempotency, totals, versions, filters, pagination and RLS passed.'
