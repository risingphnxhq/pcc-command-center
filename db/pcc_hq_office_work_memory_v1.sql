-- Corporate office work memory. No model call, speech provider, or execution
-- authority is granted by these records. Private service-role access only.
begin;
create table pcc_hq.office_work_threads (
  thread_id uuid primary key default gen_random_uuid(),
  office_id text not null references pcc_hq.office_registry(office_id),
  title text not null check (length(title) between 3 and 240),
  mission_id text references pcc_hq.mission_registry(mission_id),
  founder_subject uuid not null references auth.users(id),
  state text not null default 'OPEN' check (state in ('OPEN','CLOSED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table pcc_hq.office_work_entries (
  entry_id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references pcc_hq.office_work_threads(thread_id),
  entry_kind text not null check (entry_kind in
    ('FOUNDER_DIRECTION','OFFICE_ADVISORY_DRAFT','OFFICE_FINDING','RECOMMENDATION','FOUNDER_DECISION','EVIDENCE','RECEIPT')),
  body text not null check (length(body) between 3 and 4000),
  source_ref text,
  evidence_at timestamptz,
  owner_office_id text references pcc_hq.office_registry(office_id),
  created_at timestamptz not null default now(),
  check (entry_kind not in ('OFFICE_FINDING','EVIDENCE','RECEIPT') or
    (source_ref is not null and length(source_ref) between 5 and 500)),
  check (entry_kind <> 'OFFICE_FINDING' or evidence_at is not null)
);
create index office_work_threads_office_idx on pcc_hq.office_work_threads(office_id,updated_at desc);
create index office_work_entries_thread_idx on pcc_hq.office_work_entries(thread_id,created_at);
alter table pcc_hq.office_work_threads enable row level security;
alter table pcc_hq.office_work_threads force row level security;
alter table pcc_hq.office_work_entries enable row level security;
alter table pcc_hq.office_work_entries force row level security;
revoke all on pcc_hq.office_work_threads,pcc_hq.office_work_entries from public,anon,authenticated;
grant select,insert,update on pcc_hq.office_work_threads to service_role;
grant select,insert on pcc_hq.office_work_entries to service_role;

create or replace function public.pcc_office_work_record(
  p_founder_subject uuid,p_office_id text,p_operation text,p_thread_id uuid default null,
  p_title text default null,p_kind text default null,p_body text default null,
  p_source_ref text default null,p_evidence_at timestamptz default null,
  p_owner_office_id text default null
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pcc_hq,auth
as $$
declare v_thread uuid; v_entry uuid; v_operation text:=upper(btrim(coalesce(p_operation,'')));
begin
  if p_founder_subject is null or
     public.pcc_founder_private_subject(p_founder_subject) is distinct from true then
    raise exception using errcode='42501',message='FOUNDER_IDENTITY_REQUIRED';
  end if;
  if not exists (select 1 from pcc_hq.office_registry
    where office_id=p_office_id and authority_domain='CORPORATE' and state='ACTIVE'
      and office_id<>'PHOENIX_KING') then
    raise exception using errcode='42501',message='CORPORATE_OFFICE_REQUIRED';
  end if;
  if v_operation='OPEN' then
    if p_thread_id is not null or length(btrim(coalesce(p_title,''))) not between 3 and 240
      then raise exception using errcode='22023',message='TITLE_REQUIRED'; end if;
    insert into pcc_hq.office_work_threads(office_id,title,founder_subject)
      values(p_office_id,btrim(p_title),p_founder_subject) returning thread_id into v_thread;
    return jsonb_build_object('ok',true,'thread_id',v_thread,'state','OPEN');
  elsif v_operation='APPEND' then
    select thread_id into v_thread from pcc_hq.office_work_threads
      where thread_id=p_thread_id and office_id=p_office_id
        and founder_subject=p_founder_subject and state='OPEN' for update;
    if not found then raise exception using errcode='42501',message='OPEN_THREAD_REQUIRED'; end if;
    if p_kind not in ('FOUNDER_DIRECTION','FOUNDER_DECISION') then
      raise exception using errcode='42501',message='FOUNDER_ENTRY_KIND_REQUIRED';
    end if;
    insert into pcc_hq.office_work_entries
      (thread_id,entry_kind,body,source_ref,evidence_at,owner_office_id)
      values(v_thread,p_kind,btrim(p_body),p_source_ref,p_evidence_at,p_owner_office_id)
      returning entry_id into v_entry;
    update pcc_hq.office_work_threads set updated_at=now() where thread_id=v_thread;
    return jsonb_build_object('ok',true,'thread_id',v_thread,'entry_id',v_entry,
      'kind',p_kind,'execution','NOT_CLAIMED');
  else raise exception using errcode='22023',message='OPERATION_NOT_ALLOWED'; end if;
end $$;
revoke all on function public.pcc_office_work_record(uuid,text,text,uuid,text,text,text,text,timestamptz,text)
  from public,anon,authenticated;
grant execute on function public.pcc_office_work_record(uuid,text,text,uuid,text,text,text,text,timestamptz,text)
  to service_role;

create or replace function public.pcc_office_work_advisory(
  p_founder_subject uuid,p_office_id text,p_thread_id uuid,p_body text,
  p_provider_ref text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pcc_hq,auth
as $$
declare v_entry uuid;
begin
  if public.pcc_founder_private_subject(p_founder_subject) is distinct from true then
    raise exception using errcode='42501',message='FOUNDER_IDENTITY_REQUIRED'; end if;
  if not exists (select 1 from pcc_hq.office_work_threads
    where thread_id=p_thread_id and office_id=p_office_id
      and founder_subject=p_founder_subject and state='OPEN') then
    raise exception using errcode='42501',message='OPEN_THREAD_REQUIRED'; end if;
  if length(btrim(coalesce(p_body,''))) not between 3 and 4000 or
     length(btrim(coalesce(p_provider_ref,''))) not between 5 and 500 then
    raise exception using errcode='22023',message='ADVISORY_EVIDENCE_REQUIRED'; end if;
  insert into pcc_hq.office_work_entries(thread_id,entry_kind,body,source_ref,owner_office_id)
    values(p_thread_id,'OFFICE_ADVISORY_DRAFT',btrim(p_body),p_provider_ref,p_office_id)
    returning entry_id into v_entry;
  update pcc_hq.office_work_threads set updated_at=now() where thread_id=p_thread_id;
  return jsonb_build_object('ok',true,'entry_id',v_entry,'thread_id',p_thread_id,
    'state','ADVISORY_DRAFT','execution','NOT_CLAIMED');
end $$;
revoke all on function public.pcc_office_work_advisory(uuid,text,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.pcc_office_work_advisory(uuid,text,uuid,text,text)
  to service_role;

create or replace function public.pcc_office_work_read(
  p_founder_subject uuid,p_office_id text,p_thread_id uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pcc_hq,auth
as $$
declare v_result jsonb;
begin
  if public.pcc_founder_private_subject(p_founder_subject) is distinct from true then
    raise exception using errcode='42501',message='FOUNDER_IDENTITY_REQUIRED'; end if;
  select jsonb_build_object('thread_id',t.thread_id,'office_id',t.office_id,
    'title',t.title,'state',t.state,'updated_at',t.updated_at,
    'entries',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at)
      from (select entry_id,entry_kind,body,source_ref,evidence_at,owner_office_id,created_at
        from pcc_hq.office_work_entries where thread_id=t.thread_id
        order by created_at desc limit 12) e),'[]'::jsonb)) into v_result
  from pcc_hq.office_work_threads t where t.thread_id=p_thread_id
    and t.office_id=p_office_id and t.founder_subject=p_founder_subject;
  if v_result is null then raise exception using errcode='42501',message='THREAD_NOT_FOUND'; end if;
  return v_result;
end $$;
revoke all on function public.pcc_office_work_read(uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.pcc_office_work_read(uuid,text,uuid)
  to service_role;
commit;
