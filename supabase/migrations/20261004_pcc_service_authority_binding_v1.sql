-- PCC_RECONCILED_V1
-- Mandatory System Comps / Gate 1 approved design artifact.
-- Purpose: truthful service-principal authority binding without human UUID impersonation.
-- This migration does NOT close Gate 1, start Gate 2, grant Gate 4, or grant Gate 5.

create table if not exists pcc_institutional.service_authority_bindings (
  service_principal_id text primary key,
  actor_id text not null references pcc_institutional.actors(actor_id) on update cascade on delete restrict,
  binding_class text not null default 'SERVICE_PRINCIPAL' check (binding_class='SERVICE_PRINCIPAL'),
  runtime_lane text not null,
  credential_scope text not null,
  allowed_gate_codes text[] not null default '{}',
  allowed_actions text[] not null default '{}',
  status text not null default 'ACTIVE' check (status in ('ACTIVE','SUSPENDED','REVOKED')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table pcc_institutional.service_authority_bindings enable row level security;
revoke all on pcc_institutional.service_authority_bindings from public, anon, authenticated;

insert into pcc_institutional.service_authority_bindings
(service_principal_id,actor_id,runtime_lane,credential_scope,allowed_gate_codes,allowed_actions,status,metadata)
values (
  'PCC_PRIME_SYSTEMS_EXECUTOR',
  'RPE-MASON-HQ',
  'PRIME_MASON_EXECUTOR',
  'pcc-prime-systems-executor',
  array['0','1','2','3'],
  array['START_GATE','RECORD_EVIDENCE','SET_GATE_OUTCOME'],
  'ACTIVE',
  jsonb_build_object(
    'identity_class','MACHINE_SERVICE_PRINCIPAL',
    'authority_boundary','Machine performs bounded Prime Build operations; RPE-MASON-HQ remains authority owner. No human auth-subject impersonation.',
    'protocol_psc_id','RPE-CSE-PSC-PHOENIX-OS-SYSTEM-BUILDING-PROTOCOL-V2-2026-10-02-001',
    'msc','MANDATORY_SYSTEM_COMPS_EXTENSION',
    'gate4','DENIED',
    'gate5','DENIED'
  )
)
on conflict (service_principal_id) do update set
  actor_id=excluded.actor_id,
  runtime_lane=excluded.runtime_lane,
  credential_scope=excluded.credential_scope,
  allowed_gate_codes=excluded.allowed_gate_codes,
  allowed_actions=excluded.allowed_actions,
  status=excluded.status,
  metadata=excluded.metadata,
  updated_at=now();

create or replace function public.pcc_build_control_service_gate_v1(
  p_service_principal_id text,
  p_credential_scope text,
  p_action text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path=pcc_institutional,public,pg_temp
as $$
declare
  v_binding pcc_institutional.service_authority_bindings%rowtype;
  v_control_id text := nullif(trim(coalesce(p_payload->>'build_control_id','')),'');
  v_gate_code text := nullif(trim(coalesce(p_payload->>'gate_code','')),'');
  v_action text := upper(coalesce(p_action,''));
begin
  select * into v_binding
  from pcc_institutional.service_authority_bindings
  where service_principal_id=p_service_principal_id and status='ACTIVE'
  limit 1;

  if not found then
    return jsonb_build_object('status','DENIED','error','SERVICE_PRINCIPAL_NOT_AUTHORIZED');
  end if;

  if v_binding.actor_id <> 'RPE-MASON-HQ'
     or v_binding.runtime_lane <> 'PRIME_MASON_EXECUTOR'
     or v_binding.credential_scope <> p_credential_scope then
    return jsonb_build_object('status','DENIED','error','SERVICE_AUTHORITY_BINDING_MISMATCH');
  end if;

  if not (v_action=any(v_binding.allowed_actions)) then
    return jsonb_build_object('status','DENIED','error','SERVICE_ACTION_NOT_AUTHORIZED');
  end if;

  if v_gate_code is null or not (v_gate_code=any(v_binding.allowed_gate_codes)) then
    return jsonb_build_object('status','DENIED','error','SERVICE_GATE_NOT_AUTHORIZED');
  end if;

  if v_control_id is null or not exists (
    select 1
    from pcc_institutional.build_control_records r
    join pcc_institutional.boas_registry br on br.boas_entry_id=r.boas_entry_id
    where r.build_control_id=v_control_id and br.registry_state='ACTIVE'
  ) then
    return jsonb_build_object('status','DENIED','error','ACTIVE_BOAS_BUILD_CONTROL_REQUIRED');
  end if;

  -- Phase A deliberately installs authorization discovery only.
  -- Mutations remain fail-closed until machine provenance fields/receipts are installed.
  return jsonb_build_object(
    'status','AUTHORIZED_BOUNDARY',
    'build_control_id',v_control_id,
    'gate_code',v_gate_code,
    'action',v_action,
    'runtime_lane',v_binding.runtime_lane,
    'service_principal_id',v_binding.service_principal_id,
    'authority_owner',v_binding.actor_id,
    'mutation_enabled',false,
    'next','INSTALL_MACHINE_PROVENANCE_AND_RECEIPTS'
  );
end
$$;

revoke all on function public.pcc_build_control_service_gate_v1(text,text,text,jsonb) from public,anon,authenticated;
