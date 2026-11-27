\set ON_ERROR_STOP on
begin;
-- Synthetic fixtures and temporary clears never escape this transaction.
delete from public.workshare_tickets;
delete from public.workshare_account_requirements;
delete from public.workshare_seasons;
delete from public.workshare_ticket_create_keys;
delete from public.workshare_accounts;

insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous)
values
('95111111-1111-4111-8111-111111111111','Summary-Parent@Example.Test',now(),'{}','{}',false),
('95222222-2222-4222-8222-222222222222','summary-other@example.test',now(),'{}','{"email":"summary-parent@example.test","staff":true}',false),
('95333333-3333-4333-8333-333333333333','summary-unverified@example.test',null,'{}','{}',false),
('95444444-4444-4444-8444-444444444444','summary-anonymous@example.test',now(),'{}','{}',true);

insert into public.workshare_accounts(id,full_name,is_archived,general_hours_required,starlight_hours_required,apple_capital_hours_required)
values
('summary-linked-a','Summary Active',false,null,0,16),
('summary-linked-b','Summary Archived',true,8,9,10),
('summary-unrelated','Unrelated Private Account',false,99,98,97),
('summary-unverified','Unverified Association',false,1,1,1),
('summary-anonymous','Anonymous Association',false,1,1,1);
insert into public.workshare_account_emails(account_id,email)
values
('summary-linked-a','summary-parent@example.test'),
('summary-linked-a','private-secondary@example.test'),
('summary-linked-b','summary-parent@example.test'),
('summary-unrelated','someone-else@example.test'),
('summary-unverified','summary-unverified@example.test'),
('summary-anonymous','summary-anonymous@example.test');

insert into public.workshare_athletes(account_id,full_name,training_group)
values ('summary-linked-a','Summary Swimmer','Juniors'), ('summary-unrelated','Private Swimmer','Seniors');
update auth.users set encrypted_password='synthetic-hash' where id='95222222-2222-4222-8222-222222222222';

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"95111111-1111-4111-8111-111111111111","role":"authenticated","email":"forged@example.test"}',true);
do $$
declare result jsonb; item jsonb;
begin
  result := public.read_my_workshare_summary();
  assert result->'seasons'='[]'::jsonb and result->'seasonId'='null'::jsonb, 'No season is fabricated before setup';
  assert jsonb_array_length(result->'accounts')=2, 'All associated accounts are included';
  assert not exists(select 1 from jsonb_array_elements(result->'accounts') a where a->>'id'='summary-unrelated'), 'Unrelated accounts stay private';
  select value into item from jsonb_array_elements(result->'accounts') where value->>'id'='summary-linked-a';
  assert item->'requirements'='{"generalHoursRequired":null,"starlightHoursRequired":0,"appleCapitalHoursRequired":16}'::jsonb, 'Legacy blank, zero, and configured requirements are preserved';
  assert item->'completed'='{"general":0,"starlight":0,"appleCapital":0}'::jsonb, 'No-season completed hours start at zero';
  assert item->'emails'='["private-secondary@example.test","summary-parent@example.test"]'::jsonb, 'All linked account emails are included';
  assert item->'athletes'->0->>'fullName'='Summary Swimmer', 'Linked athlete name is included';
  assert item->'athletes'->0->>'trainingGroup'='Juniors', 'Linked athlete training group is included';
  assert not(item ? 'updatedAt'), 'Internal revision stays private';
  assert not public.has_account_password(), 'Account without a password returns false';
  assert item->'tickets'='[]'::jsonb, 'No season has no tickets';
  assert (select bool_or((value->>'isArchived')::boolean) from jsonb_array_elements(result->'accounts')), 'Archived association is retained';
  assert (select count(*) from public.workshare_accounts)=0, 'Reading a summary does not grant direct roster access';
end;
$$;

select set_config('request.jwt.claims','{"sub":"95222222-2222-4222-8222-222222222222","role":"authenticated","email":"summary-parent@example.test","user_metadata":{"email":"summary-parent@example.test","staff":true}}',true);
do $$
begin
  assert public.has_account_password(), 'Status resolves only the current user';
  assert public.read_my_workshare_summary()->'accounts'='[]'::jsonb, 'JWT email and editable metadata cannot impersonate the associated account';
end;
$$;
select set_config('request.jwt.claims','{"sub":"95333333-3333-4333-8333-333333333333","role":"authenticated"}',true);
do $$
begin
  begin
    perform public.read_my_workshare_summary(); raise exception 'Expected unverified rejection';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select set_config('request.jwt.claims','{"sub":"95444444-4444-4444-8444-444444444444","role":"authenticated"}',true);
do $$
begin
  begin
    perform public.read_my_workshare_summary(); raise exception 'Expected anonymous rejection';
  exception when insufficient_privilege then null;
  end;
end;
$$;
set local role anon;
do $$
begin
  begin
    perform public.has_account_password(); raise exception 'Expected signed-out password-status rejection';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.read_my_workshare_summary(); raise exception 'Expected signed-out rejection';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
insert into public.workshare_seasons(id,name,starts_on,ends_on)
values
('95111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Earlier Season','2025-01-01','2025-12-31'),
('95222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Current Season','2026-01-01','2026-12-31');
insert into public.workshare_account_requirements(account_id,season_id,general_hours_required,starlight_hours_required,apple_capital_hours_required)
values
('summary-linked-a','95111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',4,null,0),
('summary-linked-b','95111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',5,6,7),
('summary-linked-a','95222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb',12,0,null),
('summary-linked-b','95222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb',13,14,15),
('summary-unrelated','95222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb',99,98,97);
insert into public.workshare_ticket_create_keys(id,payload_fingerprint)
select id,repeat('a',64) from (values
('95111111-0000-4000-8000-000000000001'::uuid),
('95111111-0000-4000-8000-000000000002'::uuid),
('95111111-0000-4000-8000-000000000003'::uuid),
('95111111-0000-4000-8000-000000000004'::uuid),
('95111111-0000-4000-8000-000000000005'::uuid),
('95111111-0000-4000-8000-000000000006'::uuid)) v(id);
insert into public.workshare_tickets(id,account_id,season_id,completed_on,description,category,hours)
values
('95111111-0000-4000-8000-000000000001','summary-linked-a','95111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2025-06-01','Historical job','general',1.25),
('95111111-0000-4000-8000-000000000002','summary-linked-a','95222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb','2026-06-01','Timing','general',2.25),
('95111111-0000-4000-8000-000000000003','summary-linked-a','95222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb','2026-06-01','Timing again','general',1.5),
('95111111-0000-4000-8000-000000000004','summary-linked-a','95222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb','2026-06-01','Meet help','starlight',4),
('95111111-0000-4000-8000-000000000005','summary-linked-b','95222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb','2026-06-01','Archived job','apple_capital',6.5),
('95111111-0000-4000-8000-000000000006','summary-unrelated','95222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb','2026-06-01','Private unrelated job','general',99);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"95111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
do $$
declare result jsonb; item jsonb;
begin
  assert public.read_my_workshare_summary()->>'seasonId' = case
    when (current_timestamp at time zone 'America/Los_Angeles')::date < '2026-01-01'::date
      then '95111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      else '95222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb' end,
    'Default season uses the containing season, most recent past season, or earliest future season';
  result := public.read_my_workshare_summary('95222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert jsonb_array_length(result->'accounts')=2 and jsonb_array_length(result->'seasons')=2, 'Available seasons and only associated accounts are returned';
  assert result->>'seasonId'='95222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Requested season is honored';
  select value into item from jsonb_array_elements(result->'accounts') where value->>'id'='summary-linked-a';
  assert item->'requirements'='{"generalHoursRequired":12,"starlightHoursRequired":0,"appleCapitalHoursRequired":null}'::jsonb, 'Selected-season requirements replace legacy values';
  assert item->'completed'='{"general":3.75,"starlight":4,"appleCapital":0}'::jsonb, 'Tickets sum by associated account, selected season, and category';
  assert jsonb_array_length(item->'tickets')=3, 'All selected-season tickets are returned';
  assert item->'tickets'->0->>'description'='Meet help', 'Tickets use stable date and ID ordering';
  assert item->'tickets'->2->>'hours'='2.25', 'Fractional ticket hours are retained';
  assert position('Private unrelated job' in result::text)=0, 'Other accounts tickets stay private';
  assert position('Historical job' in result::text)=0, 'Other seasons tickets are excluded';
  assert (select count(*) from public.workshare_tickets)=0, 'Summary grants no direct ticket access';
  select value into item from jsonb_array_elements(result->'accounts') where value->>'id'='summary-linked-b';
  assert jsonb_array_length(item->'tickets')=1, 'Archived account retains its own tickets';
  assert item->'completed'='{"general":0,"starlight":0,"appleCapital":6.5}'::jsonb, 'Archived account ticket totals stay independent';
  result := public.read_my_workshare_summary('95111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  select value into item from jsonb_array_elements(result->'accounts') where value->>'id'='summary-linked-a';
  assert item->'completed'='{"general":1.25,"starlight":0,"appleCapital":0}'::jsonb, 'Historical corrections can be reviewed without leaking current totals';
  assert jsonb_array_length(item->'tickets')=1 and item->'tickets'->0->>'description'='Historical job', 'Season switching returns historical tickets';
  begin
    perform public.read_my_workshare_summary('95999999-9999-4999-8999-999999999999');
    raise exception 'Expected unknown season rejection';
  exception when no_data_found then null;
  end;
end;
$$;
reset role;
do $$
declare original jsonb; saved jsonb;
begin
  original := private.workshare_account_snapshot('summary-linked-a');
  assert original->'requireWorkshare' = 'true'::jsonb and original->>'workshareNote' = '', 'Existing accounts default to required with no note';
  saved := public.save_workshare_account(original || '{"requireWorkshare":false,"workshareNote":"  Waived for this account.  "}');
  assert saved->'requireWorkshare' = 'false'::jsonb and saved->>'workshareNote' = 'Waived for this account.', 'Preferences persist and trim notes';
  begin
    perform public.save_workshare_account(original || '{"requireWorkshare":true}');
    raise exception 'Expected stale preference version rejection';
  exception when serialization_failure then null;
  end;
  saved := public.save_workshare_account(saved - array['requireWorkshare','workshareNote']);
  assert saved->'requireWorkshare' = 'false'::jsonb and saved->>'workshareNote' = 'Waived for this account.', 'Older clients preserve new preferences';
  begin
    perform public.save_workshare_account(saved || '{"requireWorkshare":"false"}');
    raise exception 'Expected boolean validation';
  exception when check_violation then null;
  end;
  begin
    perform public.save_workshare_account(saved || jsonb_build_object('workshareNote',repeat('x',2001)));
    raise exception 'Expected note length validation';
  exception when check_violation then null;
  end;
  assert (select general_hours_required from public.workshare_account_requirements where account_id='summary-linked-a' and season_id='95222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb') = 12, 'Exemptions retain seasonal quotas';
end;
$$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"95111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
do $$
declare result jsonb; item jsonb;
begin
  result := public.read_my_workshare_summary('95222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  select value into item from jsonb_array_elements(result->'accounts') where value->>'id'='summary-linked-a';
  assert item->'requireWorkshare' = 'false'::jsonb and item->>'workshareNote' = 'Waived for this account.', 'Linked account can read the workshare note and exemption';
  assert item->'requirements' = '{"generalHoursRequired":0,"starlightHoursRequired":0,"appleCapitalHoursRequired":0}'::jsonb, 'Exempt accounts have zero effective requirements';
  assert item->'completed'->>'general' = '3.75', 'Exemptions preserve completed credit';
  begin
    perform public.save_workshare_account(jsonb_build_object('id','summary-linked-a','requireWorkshare',true));
    raise exception 'Expected account-holder write denial';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select set_config('request.jwt.claims','{"sub":"95222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
do $$
begin
  assert position('Waived for this account.' in public.read_my_workshare_summary()::text)=0, 'Unrelated users cannot read the note';
end;
$$;

reset role;
select public.save_workshare_account(private.workshare_account_snapshot('summary-linked-a') || '{"requireWorkshare":true,"workshareNote":""}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"95111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
do $$
declare item jsonb;
begin
  select value into item from jsonb_array_elements(public.read_my_workshare_summary('95222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb')->'accounts') where value->>'id'='summary-linked-a';
  assert item->'requireWorkshare' = 'true'::jsonb and item->>'workshareNote' = '', 'Staff can restore the requirement and clear a note';
  assert item->'requirements'->>'generalHoursRequired' = '12', 'Requiring workshare again restores saved quotas';
end;
$$;

rollback;
\echo 'Workshare account summaries association, privacy, verification, historical totals, categories and blank-versus-zero passed.'
