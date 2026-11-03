-- Persistent, atomic replay/idempotency ledger for the trusted Systems -> PCC Writer bridge.
begin;

create table if not exists public.pcc_workspace_bridge_requests_v1 (
  dispatch_action_id uuid primary key,
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('IN_PROGRESS','COMPLETE','FAILED')),
  response jsonb check (response is null or jsonb_typeof(response)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.pcc_workspace_bridge_nonces_v1 (
  nonce uuid primary key,
  dispatch_action_id uuid not null references public.pcc_workspace_bridge_requests_v1(dispatch_action_id) on delete restrict,
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  received_at timestamptz not null default now()
);
create index if not exists pcc_workspace_bridge_nonces_received_idx_v1
  on public.pcc_workspace_bridge_nonces_v1(received_at);

alter table public.pcc_workspace_bridge_requests_v1 enable row level security;
alter table public.pcc_workspace_bridge_nonces_v1 enable row level security;
revoke all on public.pcc_workspace_bridge_requests_v1, public.pcc_workspace_bridge_nonces_v1 from public, anon, authenticated;
grant select, insert, update on public.pcc_workspace_bridge_requests_v1 to service_role;
grant select, insert on public.pcc_workspace_bridge_nonces_v1 to service_role;
revoke delete, truncate, references, trigger on public.pcc_workspace_bridge_requests_v1, public.pcc_workspace_bridge_nonces_v1 from service_role;

create or replace function public.pcc_workspace_bridge_claim_v1(
  p_dispatch_action_id uuid,
  p_nonce uuid,
  p_request_sha256 text
) returns jsonb
language plpgsql security definer
set search_path = 'pg_catalog','public','pg_temp'
as $function$
declare
  v_request public.pcc_workspace_bridge_requests_v1%rowtype;
  v_rows integer;
begin
  if p_dispatch_action_id is null or p_nonce is null or coalesce(p_request_sha256,'') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok',false,'reason','BRIDGE_CLAIM_INPUT_INVALID');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_dispatch_action_id::text, 0));
  select * into v_request from public.pcc_workspace_bridge_requests_v1
   where dispatch_action_id=p_dispatch_action_id for update;
  if found and v_request.request_sha256 <> p_request_sha256 then
    return jsonb_build_object('ok',false,'reason','BRIDGE_IDEMPOTENCY_HASH_MISMATCH');
  end if;
  insert into public.pcc_workspace_bridge_requests_v1(dispatch_action_id,request_sha256,state)
  values(p_dispatch_action_id,p_request_sha256,'IN_PROGRESS') on conflict(dispatch_action_id) do nothing;
  insert into public.pcc_workspace_bridge_nonces_v1(nonce,dispatch_action_id,request_sha256)
  values(p_nonce,p_dispatch_action_id,p_request_sha256) on conflict(nonce) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('ok',false,'reason','BRIDGE_NONCE_REPLAY');
  end if;
  select * into v_request from public.pcc_workspace_bridge_requests_v1
   where dispatch_action_id=p_dispatch_action_id for update;
  if v_request.state='COMPLETE' then
    return jsonb_build_object('ok',true,'state','DUPLICATE_COMPLETE','response',v_request.response);
  end if;
  if v_request.state='IN_PROGRESS' and v_request.created_at < now() - interval '2 minutes' then
    update public.pcc_workspace_bridge_requests_v1 set state='IN_PROGRESS',updated_at=now()
     where dispatch_action_id=p_dispatch_action_id;
    return jsonb_build_object('ok',true,'state','CLAIMED_RECOVERY');
  end if;
  if v_request.state='IN_PROGRESS' and v_request.updated_at > v_request.created_at then
    return jsonb_build_object('ok',false,'reason','BRIDGE_REQUEST_IN_PROGRESS');
  end if;
  if v_request.state='IN_PROGRESS' then
    update public.pcc_workspace_bridge_requests_v1 set updated_at=now()
     where dispatch_action_id=p_dispatch_action_id;
    return jsonb_build_object('ok',true,'state','CLAIMED');
  end if;
  update public.pcc_workspace_bridge_requests_v1 set state='IN_PROGRESS',response=null,updated_at=now()
   where dispatch_action_id=p_dispatch_action_id;
  return jsonb_build_object('ok',true,'state','CLAIMED_RETRY');
end;
$function$;

create or replace function public.pcc_workspace_bridge_finish_v1(
  p_dispatch_action_id uuid,
  p_request_sha256 text,
  p_response jsonb,
  p_success boolean
) returns boolean
language plpgsql security definer
set search_path = 'pg_catalog','public','pg_temp'
as $function$
declare v_rows integer;
begin
  if p_dispatch_action_id is null or coalesce(p_request_sha256,'') !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_response) is distinct from 'object'
     or octet_length(p_response::text) > 500000 then
    raise exception 'PCC_WORKSPACE_BRIDGE_FINISH_INPUT_INVALID';
  end if;
  update public.pcc_workspace_bridge_requests_v1
     set state=case when p_success then 'COMPLETE' else 'FAILED' end,
         response=p_response,updated_at=now()
   where dispatch_action_id=p_dispatch_action_id
     and request_sha256=p_request_sha256 and state='IN_PROGRESS';
  get diagnostics v_rows = row_count;
  return v_rows=1;
end;
$function$;

revoke all on function public.pcc_workspace_bridge_claim_v1(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.pcc_workspace_bridge_finish_v1(uuid,text,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.pcc_workspace_bridge_claim_v1(uuid,uuid,text) to service_role;
grant execute on function public.pcc_workspace_bridge_finish_v1(uuid,text,jsonb,boolean) to service_role;
commit;
