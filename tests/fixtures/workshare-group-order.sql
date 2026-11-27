begin;
do $test$
declare
  staff_id uuid := gen_random_uuid(); outsider_id uuid := gen_random_uuid();
  before_order jsonb; requested jsonb; current_order jsonb; bad jsonb;
  snapshot jsonb; rejected boolean; first_id text; last_position integer;
begin
  insert into auth.users(id,email,email_confirmed_at,role) values
    (staff_id,staff_id||'@velocity-swimming.com',now(),'authenticated'),
    (outsider_id,outsider_id||'@example.test',now(),'authenticated');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',staff_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  perform public.manage_workshare_athletes('{"action":"createGroup","name":"Order Test A","coach":"Coach A"}');
  perform public.manage_workshare_athletes('{"action":"createGroup","name":"Order Test B","coach":"Coach B"}');
  select jsonb_agg(jsonb_build_object('id',id,'updatedAt',updated_at) order by sort_order) into before_order from public.workshare_groups where id<>'unassigned';
  select jsonb_agg(x order by position desc) into requested from jsonb_array_elements(before_order) with ordinality t(x,position);
  select jsonb_agg(jsonb_build_object('id',id,'name',name,'coach',coach) order by id) into snapshot from public.workshare_groups;
  perform public.reorder_workshare_groups(jsonb_build_object('action','reorderGroups','groups',requested));
  select jsonb_agg(jsonb_build_object('id',id,'name',name,'coach',coach) order by id) into current_order from public.workshare_groups;
  if snapshot <> current_order then raise exception 'Reorder changed group names or coaches'; end if;
  select jsonb_agg(id order by sort_order) into current_order from public.workshare_groups where id<>'unassigned';
  if current_order <> (select jsonb_agg(x->>'id' order by position) from jsonb_array_elements(requested) with ordinality t(x,position)) then raise exception 'Order was not saved'; end if;
  if (select sort_order from public.workshare_groups where id='unassigned') <> 0 then raise exception 'Unassigned moved'; end if;
  rejected := false;
  begin perform public.reorder_workshare_groups(jsonb_build_object('action','reorderGroups','groups',before_order)); exception when serialization_failure then rejected := true; end;
  if not rejected then raise exception 'Stale reorder overwrote newer order'; end if;
  select jsonb_agg(jsonb_build_object('id',id,'updatedAt',updated_at) order by sort_order) into before_order from public.workshare_groups where id<>'unassigned';
  foreach bad in array array[before_order - 0, jsonb_set(before_order,'{0}',before_order->1), jsonb_set(before_order,'{0,id}','"unassigned"'), jsonb_set(before_order,'{0,id}','"missing"')] loop
    rejected := false;
    begin perform public.reorder_workshare_groups(jsonb_build_object('action','reorderGroups','groups',bad)); exception when serialization_failure or check_violation then rejected := true; end;
    if not rejected then raise exception 'Invalid group list accepted'; end if;
    if current_order <> (select jsonb_agg(id order by sort_order) from public.workshare_groups where id<>'unassigned') then raise exception 'Rejected reorder changed order'; end if;
  end loop;
  first_id := before_order->0->>'id';
  perform public.manage_workshare_athletes(jsonb_build_object('action','updateGroup','id',first_id,'updatedAt',before_order->0->>'updatedAt','name','ZZZ Order Renamed','coach','Coach B'));
  if (select sort_order from public.workshare_groups where id=first_id) <> 1 then raise exception 'Rename changed display order'; end if;
  select max(sort_order) into last_position from public.workshare_groups;
  perform public.manage_workshare_athletes('{"action":"createGroup","name":"AAA Order Appended","coach":""}');
  if (select sort_order from public.workshare_groups where name='AAA Order Appended') <= last_position then raise exception 'New group not appended'; end if;
  rejected := false;
  begin perform public.reorder_workshare_groups(jsonb_build_object('action','reorderGroups','groups',before_order)); exception when serialization_failure then rejected := true; end;
  if not rejected then raise exception 'Added group omitted by stale reorder'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider_id,'role','authenticated')::text,true);
  rejected := false;
  begin perform public.reorder_workshare_groups(jsonb_build_object('action','reorderGroups','groups',before_order)); exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'Nonstaff reordered groups'; end if;
  execute 'reset role';
  if has_function_privilege('anon','public.reorder_workshare_groups(jsonb)','EXECUTE') then raise exception 'Anonymous reorder allowed'; end if;
end;
$test$;
rollback;
