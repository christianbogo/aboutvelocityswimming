-- Domain eligibility applies only to Workshare Admin. The broad staff authority
-- for Imports, race review, and the other Tools keeps its explicit grants.
create function private.is_workshare_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and not coalesce(u.is_anonymous, false)
      and (
        lower(u.email) = 'christiancutter02@gmail.com'
        or lower(u.email) ~ '^[^@[:space:]]+@velocity-swimming[.]com$'
        or private.is_staff()
      )
  );
$$;
revoke all on function private.is_workshare_staff() from public, anon;
grant execute on function private.is_workshare_staff() to authenticated, service_role;

create function public.is_workshare_staff() returns boolean
language sql stable security invoker set search_path = '' as $$
  select private.is_workshare_staff();
$$;
revoke all on function public.is_workshare_staff() from public, anon;
grant execute on function public.is_workshare_staff() to authenticated, service_role;

-- Preserve the tested write implementations while replacing only their scoped
-- authority. This fails closed if a prerequisite function no longer has its
-- expected staff check, instead of silently migrating an unexpected body.
do $$
declare signature text; definition text;
begin
  foreach signature in array array[
    'private.workshare_require_staff()',
    'public.list_workshare_accounts()',
    'private.save_workshare_account_legacy(jsonb)',
    'public.import_workshare_accounts(jsonb)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position('private.is_staff()' in definition) = 0 then
      raise exception 'Expected Workshare staff guard missing in %', signature;
    end if;
    execute replace(definition, 'private.is_staff()', 'private.is_workshare_staff()');
  end loop;
end;
$$;

alter policy workshare_accounts_staff on public.workshare_accounts
  using ((select private.is_workshare_staff())) with check ((select private.is_workshare_staff()));
alter policy workshare_account_emails_staff on public.workshare_account_emails
  using ((select private.is_workshare_staff())) with check ((select private.is_workshare_staff()));
alter policy workshare_athletes_staff on public.workshare_athletes
  using ((select private.is_workshare_staff())) with check ((select private.is_workshare_staff()));
alter policy workshare_seasons_staff on public.workshare_seasons
  using ((select private.is_workshare_staff())) with check ((select private.is_workshare_staff()));
alter policy workshare_requirements_staff on public.workshare_account_requirements
  using ((select private.is_workshare_staff())) with check ((select private.is_workshare_staff()));
alter policy workshare_ticket_keys_staff on public.workshare_ticket_create_keys
  using ((select private.is_workshare_staff())) with check ((select private.is_workshare_staff()));
alter policy workshare_tickets_staff on public.workshare_tickets
  using ((select private.is_workshare_staff())) with check ((select private.is_workshare_staff()));

comment on function public.is_workshare_staff() is 'Verified Workshare Admin access: owner, exact velocity-swimming.com domain, or an existing explicit staff grant. Does not grant other Tools access.';
notify pgrst, 'reload schema';
