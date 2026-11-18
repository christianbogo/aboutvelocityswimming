\set ON_ERROR_STOP on
begin;
-- Synthetic identities and writes disappear on rollback.
insert into auth.users(id,email,email_confirmed_at,is_anonymous,raw_app_meta_data,raw_user_meta_data)
values
('72720000-0000-4000-8000-000000000001','domain-coach@velocity-swimming.com',now(),false,'{}','{}'),
('72720000-0000-4000-8000-000000000002','UPPER@VELOCITY-SWIMMING.COM',now(),false,'{}','{}'),
('72720000-0000-4000-8000-000000000003','unverified@velocity-swimming.com',null,false,'{}','{}'),
('72720000-0000-4000-8000-000000000004','coach@velocity-swimming.com.evil.test',now(),false,'{}','{}'),
('72720000-0000-4000-8000-000000000005','spoof@example.test',now(),false,'{"staff":true}','{"email":"coach@velocity-swimming.com","staff":true}'),
('72720000-0000-4000-8000-000000000006','anonymous@velocity-swimming.com',now(),true,'{}','{}'),
('72720000-0000-4000-8000-000000000007','explicit-workshare@example.test',now(),false,'{}','{}');
insert into public.administrators(user_id) values('72720000-0000-4000-8000-000000000007');
do $$ begin
  assert not has_function_privilege('anon','public.is_workshare_staff()','execute'), 'Anonymous callers cannot use scoped authority RPC';
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"72720000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ declare a jsonb; begin
  assert public.is_workshare_staff(), 'Verified exact domain gains Workshare access without manual grants';
  assert not public.is_staff(), 'Domain does not gain broad Imports or race staff authority';
  perform public.list_workshare_seasons();
  a := public.save_workshare_account('{"fullName":"Synthetic domain authority account","emails":[],"athletes":[],"isArchived":false}');
  assert exists(select 1 from public.workshare_accounts where id=a->>'id'), 'Domain can read via Workshare RLS';
  a := public.save_workshare_account((a-array['currentSeason','generalHoursRequired','starlightHoursRequired','appleCapitalHoursRequired']) || '{"fullName":"Updated synthetic domain account"}');
  assert a->>'fullName'='Updated synthetic domain account', 'Domain can save accounts through legacy wrapper';
end $$;
select set_config('request.jwt.claims','{"sub":"72720000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$ begin assert public.is_workshare_staff(), 'Domain comparison ignores case'; end $$;
select set_config('request.jwt.claims','{"sub":"72720000-0000-4000-8000-000000000007","role":"authenticated"}',true);
do $$ begin assert public.is_workshare_staff() and public.is_staff(), 'Explicit grants remain valid'; end $$;
do $$ declare uid text; begin
  foreach uid in array array[
    '72720000-0000-4000-8000-000000000003',
    '72720000-0000-4000-8000-000000000004',
    '72720000-0000-4000-8000-000000000005',
    '72720000-0000-4000-8000-000000000006'
  ] loop
    perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
    assert not public.is_workshare_staff(), 'Unverified, spoofed, and anonymous identities are denied';
    assert not exists(select 1 from public.workshare_accounts where full_name='Updated synthetic domain account'), 'Denied identities cannot read Workshare rows';
    begin
      perform public.list_workshare_accounts();
      raise exception 'Denied identity listed accounts';
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;
reset role;
do $$ begin
  assert not exists(select 1 from public.administrators where user_id in ('72720000-0000-4000-8000-000000000001','72720000-0000-4000-8000-000000000002')), 'Eligibility creates no permanent staff grants';
end $$;
rollback;
\echo 'Workshare domain authority passed'
