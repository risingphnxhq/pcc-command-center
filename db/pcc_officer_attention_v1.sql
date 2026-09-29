-- Review and apply as a controlled Corporate migration. No seed requests.
create table if not exists pcc_hq.officer_attention_requests (
  request_id uuid primary key default gen_random_uuid(),
  requesting_office text not null references pcc_hq.office_registry(office_id),
  category text not null check (category in ('BUSINESS','SYSTEMS')),
  priority text not null check (priority in ('ROUTINE','TIME_SENSITIVE','URGENT')),
  subject text not null check (char_length(subject) between 3 and 160),
  reason_and_requested_outcome text not null check (char_length(reason_and_requested_outcome) between 10 and 2000),
  source_or_evidence_ref text not null check (char_length(source_or_evidence_ref) between 3 and 240),
  confidentiality_scope text not null check (confidentiality_scope in ('FOUNDER_PRIVATE','CORPORATE_RESTRICTED')),
  requested_contact text not null check (requested_contact in ('CONVERSATION','MEETING','DECISION','REVIEW')),
  related_mission_or_decision text,
  due_at timestamptz,
  status text not null default 'REQUESTED' check (status in ('REQUESTED','PRESENTED','ACKNOWLEDGED','SCHEDULED_OR_ROUTED','RESOLVED','CANCELLED')),
  verified_worker_subject uuid not null,
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  disposition_receipt text,
  constraint urgent_due_or_reason check (priority <> 'URGENT' or due_at is not null)
);
create index if not exists officer_attention_open_idx on pcc_hq.officer_attention_requests(priority,created_at desc)
  where status in ('REQUESTED','PRESENTED','ACKNOWLEDGED','SCHEDULED_OR_ROUTED');
create unique index if not exists officer_attention_active_source_idx
  on pcc_hq.officer_attention_requests(requesting_office,source_or_evidence_ref)
  where status in ('REQUESTED','PRESENTED','ACKNOWLEDGED','SCHEDULED_OR_ROUTED');
alter table pcc_hq.officer_attention_requests enable row level security;
revoke all on pcc_hq.officer_attention_requests from public,anon,authenticated;
grant usage on schema pcc_hq to service_role;
grant select,insert,update on pcc_hq.officer_attention_requests to service_role;

create or replace function public.pcc_founder_attention_list()
returns jsonb language sql stable security invoker set search_path = pg_catalog,pcc_hq as $$
  select coalesce(jsonb_agg(to_jsonb(r) - 'verified_worker_subject' order by
    case r.priority when 'URGENT' then 0 when 'TIME_SENSITIVE' then 1 else 2 end,
    r.created_at desc), '[]'::jsonb)
  from (select request_id,requesting_office,category,priority,subject,reason_and_requested_outcome,
      source_or_evidence_ref,confidentiality_scope,requested_contact,related_mission_or_decision,
      due_at,status,created_at,acknowledged_at,disposition_receipt
    from pcc_hq.officer_attention_requests
    where status in ('REQUESTED','PRESENTED','ACKNOWLEDGED','SCHEDULED_OR_ROUTED')
    order by created_at desc limit 100) r;
$$;
revoke all on function public.pcc_founder_attention_list() from public,anon,authenticated;
grant execute on function public.pcc_founder_attention_list() to service_role;

create or replace function public.pcc_founder_attention_ack(p_request_id uuid)
returns boolean language plpgsql security invoker set search_path = pg_catalog,pcc_hq as $$
begin
  update pcc_hq.officer_attention_requests
  set status='ACKNOWLEDGED',acknowledged_at=now()
  where request_id=p_request_id and status in ('REQUESTED','PRESENTED');
  return found;
end;
$$;
revoke all on function public.pcc_founder_attention_ack(uuid) from public,anon,authenticated;
grant execute on function public.pcc_founder_attention_ack(uuid) to service_role;

create or replace function public.pcc_officer_attention_store(p_request jsonb)
returns uuid language plpgsql security invoker set search_path = pg_catalog,pcc_hq as $$
declare v_id uuid;
begin
  insert into pcc_hq.officer_attention_requests (
    requesting_office,category,priority,subject,reason_and_requested_outcome,
    source_or_evidence_ref,confidentiality_scope,requested_contact,related_mission_or_decision,
    due_at,verified_worker_subject,verified_at)
  values (
    p_request->>'requesting_office',p_request->>'category',p_request->>'priority',
    p_request->>'subject',p_request->>'reason_and_requested_outcome',
    p_request->>'source_or_evidence_ref',p_request->>'confidentiality_scope',
    p_request->>'requested_contact',p_request->>'related_mission_or_decision',
    nullif(p_request->>'due_at','')::timestamptz,(p_request->>'verified_worker_subject')::uuid,
    (p_request->>'verified_at')::timestamptz)
  returning request_id into v_id;
  return v_id;
end;
$$;
revoke all on function public.pcc_officer_attention_store(jsonb) from public,anon,authenticated;
grant execute on function public.pcc_officer_attention_store(jsonb) to service_role;
