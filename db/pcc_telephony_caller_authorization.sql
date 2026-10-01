-- Caller cannot supply or impersonate another subject. This exposes only their own eligibility.
begin;
create or replace function public.pcc_telephony_caller_authorized()
returns boolean language sql stable security definer
set search_path = pg_catalog, pcc_hq
as $$
  select auth.uid() is not null and exists (
    select 1 from pcc_hq.founder_private_subjects
    where auth_subject = auth.uid() and office_id = 'PHOENIX_KING' and state = 'ACTIVE'
  );
$$;
revoke all on function public.pcc_telephony_caller_authorized() from public, anon;
grant execute on function public.pcc_telephony_caller_authorized() to authenticated;
commit;
