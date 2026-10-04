-- PCC_RECONCILED_V1
-- Gate transition hardening for PCC_PRIME_SYSTEMS_EXECUTOR.
-- Applied after service authority/provenance migrations.
-- Required controls:
--   START_GATE requires every predecessor gate to be PASS.
--   SET_GATE_OUTCOME requires target gate to be IN_PROGRESS.
-- Gates 4 and 5 remain outside machine authority.

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
  v_gate_state text := upper(nullif(trim(coalesce(p_payload->>'state','')),''));
  v_action text := upper(coalesce(p_action,''));
  v_result jsonb;
  v_receipt uuid;
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

  if v_gate_code is null or v_gate_code not in ('0','1','2','3')
     or not (v_gate_code=any(v_binding.allowed_gate_codes)) then
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

  if v_action='START_GATE' then
    if exists (
      select 1
      from pcc_institutional.build_control_gates g
      where g.build_control_id=v_control_id
        and g.gate_code in ('0','1','2','3','4','5')
        and g.gate_code::int < v_gate_code::int
        and g.state <> 'PASS'
    ) then
      v_result:=jsonb_build_object('status','DENIED','error','PREDECESSOR_GATE_NOT_PASS');
    else
      update pcc_institutional.build_control_gates
      set state='IN_PROGRESS',updated_at=now()
      where build_control_id=v_control_id and gate_code=v_gate_code and state='NOT_STARTED';
      if not found then
        v_result:=jsonb_build_object('status','DENIED','error','GATE_NOT_STARTABLE');
      else
        update pcc_institutional.build_control_records
        set state='ACTIVE',updated_at=now()
        where build_control_id=v_control_id;
        v_result:=jsonb_build_object('status','OK','state','IN_PROGRESS');
      end if;
    end if;

  elsif v_action='RECORD_EVIDENCE' then
    if nullif(trim(coalesce(p_payload->>'evidence_type','')),'') is null
       or nullif(trim(coalesce(p_payload->>'summary','')),'') is null then
      v_result:=jsonb_build_object('status','DENIED','error','EVIDENCE_REQUIRED_FIELDS_MISSING');
    else
      v_result:=jsonb_build_object('status','RECORDED_MACHINE_RECEIPT','evidence_type',p_payload->>'evidence_type');
    end if;

  elsif v_action='SET_GATE_OUTCOME' then
    if v_gate_state is null or v_gate_state not in ('PASS','HOLD','CORRECT') then
      v_result:=jsonb_build_object('status','DENIED','error','INVALID_GATE_OUTCOME');
    elsif not exists (
      select 1 from pcc_institutional.build_control_gates
      where build_control_id=v_control_id and gate_code=v_gate_code and state='IN_PROGRESS'
    ) then
      v_result:=jsonb_build_object('status','DENIED','error','GATE_OUTCOME_REQUIRES_IN_PROGRESS');
    else
      update pcc_institutional.build_control_gates
      set state=v_gate_state,completed_at=now(),updated_at=now()
      where build_control_id=v_control_id and gate_code=v_gate_code and state='IN_PROGRESS';
      update pcc_institutional.build_control_records
      set state=case
        when v_gate_state in ('HOLD','CORRECT') then 'ON_HOLD'
        when v_gate_code='3' and v_gate_state='PASS' then 'READY_FOR_ASSURANCE'
        else state end,
        updated_at=now()
      where build_control_id=v_control_id;
      v_result:=jsonb_build_object('status','OK','state',v_gate_state);
    end if;
  else
    v_result:=jsonb_build_object('status','DENIED','error','SERVICE_ACTION_NOT_PERMITTED');
  end if;

  insert into pcc_institutional.service_execution_receipts(
    service_principal_id,authority_actor_id,runtime_lane,credential_scope,
    build_control_id,gate_code,action,requested_state,result_state,reference_id,
    request_payload,result_payload
  ) values (
    v_binding.service_principal_id,v_binding.actor_id,v_binding.runtime_lane,v_binding.credential_scope,
    v_control_id,v_gate_code,v_action,v_gate_state,coalesce(v_result->>'status','UNKNOWN'),
    nullif(trim(coalesce(p_payload->>'reference_id','')),''),
    p_payload,v_result
  ) returning receipt_id into v_receipt;

  return v_result || jsonb_build_object(
    'build_control_id',v_control_id,
    'gate_code',v_gate_code,
    'runtime_lane',v_binding.runtime_lane,
    'service_principal_id',v_binding.service_principal_id,
    'authority_owner',v_binding.actor_id,
    'receipt_id',v_receipt
  );
end $$;

revoke all on function public.pcc_build_control_service_gate_v1(text,text,text,jsonb) from public,anon,authenticated;
