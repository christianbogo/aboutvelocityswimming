-- Retire volunteer shifts, historical credit, invitations, and old settings.
-- Family identities/contact membership and all Times/attendance data remain shared.
delete from private.reminders;
delete from private.guest_invitations;
delete from public.registrations;
delete from public.manual_hours;
delete from public.postings;
delete from public.work_descriptions;
delete from public.workshare_members;
delete from public.evidence_records
  where root in ('postings', 'registrations', 'manual_hours', 'work_descriptions');
update public.families set data = data - 'requirements' where data ? 'requirements';

create function private.reject_retired_workshare_write() returns trigger language plpgsql
security invoker set search_path = '' as $$
begin
  raise feature_not_supported using message = 'Legacy Workshare has been retired. Use Accounts & Roster.';
end;
$$;

-- These guards also cover reviewed/generic record RPCs running with elevated rights.
create trigger reject_retired_workshare_write before insert or update on public.postings
  for each statement execute function private.reject_retired_workshare_write();
create trigger reject_retired_workshare_write before insert or update on public.registrations
  for each statement execute function private.reject_retired_workshare_write();
create trigger reject_retired_workshare_write before insert or update on public.manual_hours
  for each statement execute function private.reject_retired_workshare_write();
create trigger reject_retired_workshare_write before insert or update on public.work_descriptions
  for each statement execute function private.reject_retired_workshare_write();
create trigger reject_retired_workshare_write before insert or update on public.workshare_members
  for each statement execute function private.reject_retired_workshare_write();
create trigger reject_retired_workshare_write before insert or update on private.guest_invitations
  for each statement execute function private.reject_retired_workshare_write();
create trigger reject_retired_workshare_write before insert or update on private.reminders
  for each statement execute function private.reject_retired_workshare_write();

create function private.reject_retired_workshare_evidence() returns trigger language plpgsql
security invoker set search_path = '' as $$
begin
  if split_part(new.path, '/', 1) in ('postings', 'registrations', 'manual_hours', 'work_descriptions') then
    raise feature_not_supported using message = 'Legacy Workshare has been retired. Use Accounts & Roster.';
  end if;
  return new;
end;
$$;
create trigger reject_retired_workshare_evidence before insert or update on public.evidence_records
  for each row execute function private.reject_retired_workshare_evidence();

create function private.strip_retired_workshare_requirements() returns trigger language plpgsql
security invoker set search_path = '' as $$
begin
  new.data := new.data - 'requirements';
  return new;
end;
$$;
create trigger strip_retired_workshare_requirements before insert or update on public.families
  for each row execute function private.strip_retired_workshare_requirements();

create or replace function public.workshare_action(operation text, input jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  raise feature_not_supported using message = 'Legacy Workshare has been retired. Use Accounts & Roster.';
end;
$$;
revoke all on function public.workshare_action(text,jsonb) from public, anon, authenticated;

-- Previously deployed reminder workers and cron invocations must send no notices.
create or replace function public.claim_shift_reminders(dry_run boolean default true)
returns jsonb language sql security invoker set search_path = '' as $$ select '[]'::jsonb; $$;
create or replace function public.finish_shift_reminder(registration_id text, reminder_date date, delivery_id text default null, failure text default null)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  raise feature_not_supported using message = 'Legacy Workshare reminders have been retired.';
end;
$$;
create or replace function private.invoke_shift_reminders()
returns void language plpgsql security invoker set search_path = '' as $$ begin return; end; $$;
revoke all on function public.claim_shift_reminders(boolean), public.finish_shift_reminder(text,date,text,text) from public, anon, authenticated;
revoke all on function private.invoke_shift_reminders(), private.reject_retired_workshare_write(),
  private.reject_retired_workshare_evidence(), private.strip_retired_workshare_requirements() from public, anon, authenticated;

do $$
declare reminder_job bigint;
begin
  if to_regclass('cron.job') is not null then
    for reminder_job in execute 'select jobid from cron.job where jobname = $1 or command like $2'
      using 'velocity-shift-reminders', '%private.invoke_shift_reminders%'
    loop
      perform cron.unschedule(reminder_job);
    end loop;
  end if;
end;
$$;
