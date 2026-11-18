\set ON_ERROR_STOP on
begin;
-- Reset only within this transaction; the final rollback restores existing local accounts.
delete from public.workshare_tickets;
delete from public.workshare_account_requirements;
delete from public.workshare_seasons;
delete from public.workshare_ticket_create_keys;
delete from public.workshare_accounts;
insert into auth.users (id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values ('11111111-1111-4111-8111-111111111111','workshare-staff@example.test',now(),'{}','{}'),
       ('22222222-2222-4222-8222-222222222222','workshare-family@example.test',now(),'{}','{}');
insert into public.administrators(user_id) values('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
do $$
declare
  sample jsonb := '{"fullName":"Import Account","emails":[],"athletes":[],"currentSeason":null,"generalHoursRequired":null,"starlightHoursRequired":null,"appleCapitalHoursRequired":null,"isArchived":false}';
  result jsonb;
begin
  begin
    perform public.import_workshare_accounts(jsonb_build_object('accounts',jsonb_build_array(sample,sample || '{"fullName":""}')));
    raise exception 'Expected atomic import failure';
  exception when check_violation then null;
  end;
  assert (select count(*) from public.workshare_accounts) = 0, 'Partial imports rolled back';
  begin
    result := public.import_workshare_accounts(jsonb_build_object('accounts',jsonb_build_array(sample)));
    assert result = '{"accountCount":1,"athleteCount":0}'::jsonb, 'Import counts returned';
    begin
      perform public.import_workshare_accounts(jsonb_build_object('accounts',jsonb_build_array(sample)));
      raise exception 'Expected repeat import rejection';
    exception when unique_violation then null;
    end;
    raise sqlstate 'PZ001' using message = 'Roll back successful import fixture';
  exception when sqlstate 'PZ001' then null;
  end;
  assert (select count(*) from public.workshare_accounts) = 0, 'Import test fixture cleaned';
end;
$$;
select public.save_workshare_account('{"fullName":"Test Account","emails":["PARENT@example.test"],"athletes":[{"fullName":"Test Athlete","trainingGroup":"Juniors","timesAthleteId":null,"isArchived":false}],"currentSeason":null,"generalHoursRequired":null,"starlightHoursRequired":0,"appleCapitalHoursRequired":1.25,"isArchived":false}') as account \gset created_
select set_config('test.workshare_account', :'created_account',true);
do $$
declare a jsonb := current_setting('test.workshare_account')::jsonb; b jsonb;
begin
  assert a->'generalHoursRequired' = 'null'::jsonb, 'Unset hours retained';
  assert a->'starlightHoursRequired' = '0'::jsonb, 'Zero hours retained';
  assert a->'emails' = '["parent@example.test"]'::jsonb, 'Emails normalized';
  assert jsonb_array_length(public.list_workshare_accounts()) >= 1, 'Admin can list';
  b := public.save_workshare_account(a || '{"fullName":"Edited Account","currentSeason":"2026–2027","generalHoursRequired":12.5,"isArchived":true}');
  assert b->>'fullName' = 'Edited Account', 'Name edited';
  assert b->'athletes'->0->>'id' = a->'athletes'->0->>'id', 'Athlete ID stable';
  assert b->>'updatedAt' <> a->>'updatedAt', 'Version advanced';
  begin
    perform public.save_workshare_account(a || '{"fullName":"Stale overwrite"}');
    raise exception 'Expected stale write failure';
  exception when serialization_failure then null;
  end;
  begin
    perform public.save_workshare_account(b || '{"generalHoursRequired":-1}');
    raise exception 'Expected negative hours failure';
  exception when check_violation then null;
  end;
  begin
    perform public.save_workshare_account(b || '{"generalHoursRequired":1.001}');
    raise exception 'Expected precision failure';
  exception when check_violation then null;
  end;
  begin
    perform public.save_workshare_account(b || jsonb_build_object('athletes',jsonb_build_array((b->'athletes'->0) || '{"id":"wrong-account-athlete"}')));
    raise exception 'Expected foreign athlete failure';
  exception when check_violation then null;
  end;
  assert private.workshare_account_snapshot(b->>'id') = b, 'Failed save rolled back';
  update public.workshare_athletes set training_group = 'Seniors' where account_id = b->>'id';
  assert (private.workshare_account_snapshot(b->>'id')->>'updatedAt') <> b->>'updatedAt', 'Direct child edits advance account version';
  b := private.workshare_account_snapshot(b->>'id');
  b := public.save_workshare_account(b || '{"athletes":[],"emails":[]}');
  assert b->'athletes' = '[]'::jsonb and b->'emails' = '[]'::jsonb, 'Removals persisted';
end;
$$;
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
do $$
begin
  assert (select count(*) from public.workshare_accounts) = 0, 'Nonstaff cannot read accounts';
  assert (select count(*) from public.workshare_account_emails) = 0, 'Nonstaff cannot read emails';
  assert (select count(*) from public.workshare_athletes) = 0, 'Nonstaff cannot read roster';
  begin
    perform public.list_workshare_accounts();
    raise exception 'Expected nonstaff RPC denial';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_workshare_account(current_setting('test.workshare_account')::jsonb);
    raise exception 'Expected nonstaff save denial';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.workshare_accounts(full_name) values ('Unauthorized');
    raise exception 'Expected direct-write RLS denial';
  exception when insufficient_privilege then null;
  end;
end;
$$;
set local role anon;
do $$
begin
  begin
    perform public.list_workshare_accounts();
    raise exception 'Expected anonymous RPC denial';
  exception when insufficient_privilege then null;
  end;
end;
$$;
set local role service_role;
do $$
begin
  assert jsonb_array_length(public.list_workshare_accounts()) >= 1, 'Service role can manage accounts';
  assert public.claim_shift_reminders(false) = '[]'::jsonb, 'Retired reminders send no work';
  assert (select count(*) from public.postings) = 0, 'Legacy shifts removed';
  assert (select count(*) from public.registrations) = 0, 'Legacy registrations removed';
  assert (select count(*) from public.manual_hours) = 0, 'Legacy hour credits removed';
  assert (select count(*) from public.work_descriptions) = 0, 'Legacy settings removed';
  assert (select count(*) from public.workshare_members) = 0, 'Legacy roster removed';
  assert not exists(select 1 from public.families where data ? 'requirements'), 'Legacy requirements removed';
  begin
    perform public.workshare_action('registerForShift', '{}');
    raise exception 'Expected retired action denial';
  exception when feature_not_supported then null;
  end;
  begin
    insert into public.work_descriptions(id,data) values ('retired-test','{"text":"retired"}');
    raise exception 'Expected retired table insert denial';
  exception when feature_not_supported then null;
  end;
  begin
    insert into public.workshare_members(id,family_id,name,group_name) values ('retired-test','unused','retired','');
    raise exception 'Expected retired roster insert denial';
  exception when feature_not_supported then null;
  end;
  begin
    perform public.collect_records('[]','[{"path":"work_descriptions/retired-test","after":{"text":"retired"}}]');
    raise exception 'Expected generic retired write denial';
  exception when feature_not_supported then null;
  end;
end;
$$;
rollback;
\echo 'Accounts & Roster CRUD, archive, null/zero, validation, atomicity, versions and RLS passed.'
