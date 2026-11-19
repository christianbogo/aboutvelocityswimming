-- Moderation is part of owner-only Data management, including direct RPC use.
do $$ declare signature text; definition text; begin
 foreach signature in array array['private.read_result_moderation(text,text)','private.list_result_moderation(integer,integer,boolean)','private.moderate_result(text,text,text,text,text,integer)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if position('private.is_staff()' in definition)=0 then raise exception 'Expected moderation authorization check: %',signature; end if;
  definition:=replace(definition,'private.is_staff()','private.is_data_owner()');
  definition:=replace(definition,'Verified staff access required','Only the data owner can review results');
  execute definition;
 end loop;
 definition:=pg_get_functiondef('private.moderate_result(text,text,text,text,text,integer)'::regprocedure);
 definition:=replace(definition,'return private.read_result_moderation(kind,rid);',
  'if kind=''relay'' then events:=array_append(coalesce(events,''{}''::text[]),raw->>''eventCode''); end if; perform private.refresh_result_record_events(events); return private.read_result_moderation(kind,rid);');
 execute definition;
end $$;
alter function public.moderate_result(text,text,text,text,text,integer) set statement_timeout='45s';
notify pgrst,'reload schema';
