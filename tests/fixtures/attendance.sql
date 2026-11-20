begin;
do $test$
declare
  staff_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  session_data jsonb := '{"id":"attendance-test-session","date":"2099-11-19","trainingGroup":"Attendance Test"}';
  mark_a jsonb := '{"id":"attendance-test-a","athleteId":"attendance-test-swimmer-a","sessionId":"attendance-test-session","date":"2099-11-19","status":"absent","note":"Preserved"}';
  mark_b jsonb := '{"id":"attendance-test-b","athleteId":"attendance-test-swimmer-b","sessionId":"attendance-test-session","date":"2099-11-19","status":"present"}';
  reviewed jsonb;
  changes jsonb;
  rejected boolean;
begin
  insert into auth.users(id,email,email_confirmed_at,role) values
    (staff_id,staff_id::text||'@example.test',now(),'authenticated'),
    (outsider_id,outsider_id::text||'@example.test',now(),'authenticated');
  insert into public.administrators(user_id) values(staff_id);
  insert into public.training_groups(id,name) values('attendance-test-group','Attendance Test');
  insert into public.people(id,data) values
    ('attendance-test-person-a','{"name":"Avery Attendance","structuredName":{"first":"Avery","last":"Attendance"}}'),
    ('attendance-test-person-b','{"name":"Blake Attendance","structuredName":{"first":"Blake","last":"Attendance"}}');
  insert into public.athletes(id,data,person_id,group_id) values
    ('attendance-test-swimmer-a','{"status":"active"}','attendance-test-person-a','attendance-test-group'),
    ('attendance-test-swimmer-b','{"status":"active"}','attendance-test-person-b','attendance-test-group');
  reviewed := '[{"path":"practice_sessions/attendance-test-session","before":null},{"path":"attendance/attendance-test-a","before":null},{"path":"attendance/attendance-test-b","before":null}]';
  changes := jsonb_build_array(
    jsonb_build_object('path','practice_sessions/attendance-test-session','after',session_data),
    jsonb_build_object('path','attendance/attendance-test-a','after',mark_a),
    jsonb_build_object('path','attendance/attendance-test-b','after',mark_b));

  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider_id,'role','authenticated')::text,true);
  rejected := false;
  begin perform public.commit_records(reviewed, changes);
  exception when insufficient_privilege then rejected := true; end;
  if not rejected or exists(select 1 from public.practice_sessions where id='attendance-test-session') then
    raise exception 'Unprivileged attendance write allowed';
  end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',staff_id,'role','authenticated')::text,true);
  perform public.commit_records(reviewed, changes);
  if (select count(*) from public.attendance where session_id='attendance-test-session') <> 2 then
    raise exception 'Attendance batch did not save every mark';
  end if;
  if not exists(select 1 from public.practice_sessions where id='attendance-test-session' and practice_date='2099-11-19' and group_name='Attendance Test') then
    raise exception 'Practice projections do not support date lookup';
  end if;
  rejected := false;
  begin perform public.commit_records(reviewed, changes);
  exception when serialization_failure then rejected := true; end;
  if not rejected then raise exception 'Competing first save overwrote attendance'; end if;

  reviewed := jsonb_build_array(
    jsonb_build_object('path','practice_sessions/attendance-test-session','before',session_data),
    jsonb_build_object('path','attendance/attendance-test-a','before',mark_a),
    jsonb_build_object('path','attendance/attendance-test-b','before',mark_b));
  changes := jsonb_build_array(
    jsonb_build_object('path','attendance/attendance-test-a','after',mark_a||'{"status":"present"}'),
    jsonb_build_object('path','attendance/attendance-test-b','after',mark_b||'{"status":"late"}'));
  -- A different editor updates B after this browser loaded its before-image.
  update public.attendance set data=data||'{"status":"excused"}' where id='attendance-test-b';
  rejected := false;
  begin perform public.commit_records(reviewed, changes);
  exception when serialization_failure then rejected := true; end;
  if not rejected or (select data->>'status' from public.attendance where id='attendance-test-a') <> 'absent'
    or (select data->>'status' from public.attendance where id='attendance-test-b') <> 'excused' then
    raise exception 'Stale batch partly saved or overwrote the newer mark';
  end if;
  reviewed := jsonb_set(reviewed,'{2,before}',mark_b||'{"status":"excused"}');
  perform public.commit_records(reviewed, changes);
  if (select data->>'status' from public.attendance where id='attendance-test-a') <> 'present'
    or (select data->>'status' from public.attendance where id='attendance-test-b') <> 'late'
    or (select data->>'note' from public.attendance where id='attendance-test-a') <> 'Preserved' then
    raise exception 'Reviewed retry failed or discarded attendance metadata';
  end if;

  -- Relational reads retain the same staff-only visibility as the old facade.
  execute 'set local role authenticated';
  if (select count(*) from public.attendance where session_id='attendance-test-session') <> 2 then
    raise exception 'Staff cannot read saved attendance';
  end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider_id,'role','authenticated')::text,true);
  if exists(select 1 from public.attendance where session_id='attendance-test-session')
    or exists(select 1 from public.practice_sessions where id='attendance-test-session')
    or exists(select 1 from public.athletes where id='attendance-test-swimmer-a') then
    raise exception 'Nonstaff relational reads expose attendance or roster';
  end if;
  execute 'reset role';
  if has_function_privilege('anon','public.commit_records(jsonb,jsonb)','EXECUTE') then
    raise exception 'Anonymous users can execute attendance writes';
  end if;
end;
$test$;
rollback;
