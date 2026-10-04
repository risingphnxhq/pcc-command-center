-- PCC Build Control V2 — governed gate operations
-- Scope: add BOAS-bound gate operations without changing PCC runtime features.
-- Authority: Prime Mason Gates 0-3; New Mason/CATE Gate 4; Gate 5 reserved.

create or replace function public.pcc_build_control_gate_v2(
  p_auth_subject uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = 'pcc_institutional','public','pg_temp'
as $function$
declare
  v_binding record;
  v_lane text;
  v_control_id text := nullif(trim(coalesce(p_payload->>'build_control_id','')),'');
  v_gate_code text := nullif(trim(coalesce(p_payload->>'gate_code','')),'');
  v_gate_state text := upper(nullif(trim(coalesce(p_payload->>'state','')),''));
begin
  select * into v_binding
  from pcc_institutional.auth_actor_bindings
  where auth_subject=p_auth_subject
    and status='ACTIVE'
    and (valid_until is null or valid_until>now())
  order by updated_at desc
  limit 1;

  if not found or v_binding.actor_id <> 'RPE-MASON-HQ' then
    return jsonb_build_object('status','DENIED','error','PCC_BUILD_CONTROL_RUNTIME_NOT_AUTHORIZED');
  end if;

  if coalesce(v_binding.metadata->>'runtime_lane','')='PRIME_MASON_ACCOUNT'
     and v_binding.binding_class='DIRECT_ACTOR' then
    v_lane := 'PRIME_MASON_ACCOUNT';
  elsif coalesce(v_binding.metadata->>'runtime_lane','')='NEW_MASON_ACCOUNT' then
    v_lane := 'NEW_MASON_ACCOUNT';
  else
    return jsonb_build_object('status','DENIED','error','PCC_BUILD_CONTROL_RUNTIME_LANE_NOT_AUTHORIZED');
  end if;

  if v_control_id is null or not exists (
    select 1
    from pcc_institutional.build_control_records r
    join pcc_institutional.boas_registry br on br.boas_entry_id=r.boas_entry_id
    where r.build_control_id=v_control_id and br.registry_state='ACTIVE'
  ) then
    return jsonb_build_object('status','DENIED','error','ACTIVE_BOAS_BUILD_CONTROL_REQUIRED');
  end if;

  case upper(coalesce(p_action,''))
    when 'START_GATE' then
      if v_lane <> 'PRIME_MASON_ACCOUNT'
         or v_gate_code is null
         or v_gate_code not in ('0','1','2','3') then
        return jsonb_build_object('status','DENIED','error','PRIME_GATE_CONTROL_REQUIRED');
      end if;
      update pcc_institutional.build_control_gates
      set state='IN_PROGRESS',updated_at=now()
      where build_control_id=v_control_id
        and gate_code=v_gate_code
        and state='NOT_STARTED';
      if not found then
        return jsonb_build_object('status','DENIED','error','GATE_NOT_STARTABLE');
      end if;
      update pcc_institutional.build_control_records
      set state='ACTIVE',updated_at=now()
      where build_control_id=v_control_id;
      return jsonb_build_object('status','OK','build_control_id',v_control_id,'gate_code',v_gate_code,'state','IN_PROGRESS','runtime_lane',v_lane);

    when 'RECORD_EVIDENCE' then
      if v_gate_code is null
         or nullif(trim(coalesce(p_payload->>'evidence_type','')),'') is null
         or nullif(trim(coalesce(p_payload->>'summary','')),'') is null then
        return jsonb_build_object('status','DENIED','error','EVIDENCE_REQUIRED_FIELDS_MISSING');
      end if;
      if v_lane='PRIME_MASON_ACCOUNT' and v_gate_code not in ('0','1','2','3') then
        return jsonb_build_object('status','DENIED','error','PRIME_EVIDENCE_GATE_0_3_ONLY');
      end if;
      if v_lane='NEW_MASON_ACCOUNT' and v_gate_code <> '4' then
        return jsonb_build_object('status','DENIED','error','AUDIT_RUNTIME_GATE_4_ONLY');
      end if;
      insert into pcc_institutional.build_control_evidence
        (build_control_id,gate_code,evidence_type,reference_id,summary,evidence,reported_by_subject)
      values
        (v_control_id,v_gate_code,p_payload->>'evidence_type',
         nullif(trim(coalesce(p_payload->>'reference_id','')),''),
         p_payload->>'summary',coalesce(p_payload->'evidence','{}'::jsonb),p_auth_subject);
      return jsonb_build_object('status','RECORDED','build_control_id',v_control_id,'gate_code',v_gate_code,'runtime_lane',v_lane);

    when 'SET_GATE_OUTCOME' then
      if v_gate_code is null or v_gate_state is null or v_gate_state not in ('PASS','HOLD','CORRECT') then
        return jsonb_build_object('status','DENIED','error','INVALID_GATE_OUTCOME');
      end if;
      if v_lane='PRIME_MASON_ACCOUNT' and v_gate_code not in ('0','1','2','3') then
        return jsonb_build_object('status','DENIED','error','PRIME_CANNOT_COMPLETE_ASSURANCE_OR_RELEASE_GATE');
      end if;
      if v_lane='NEW_MASON_ACCOUNT' and v_gate_code <> '4' then
        return jsonb_build_object('status','DENIED','error','AUDIT_RUNTIME_GATE_4_ONLY');
      end if;
      update pcc_institutional.build_control_gates
      set state=v_gate_state,completed_by_subject=p_auth_subject,completed_at=now(),updated_at=now()
      where build_control_id=v_control_id and gate_code=v_gate_code;
      if not found then
        return jsonb_build_object('status','NOT_FOUND','error','BUILD_CONTROL_GATE_NOT_FOUND');
      end if;
      update pcc_institutional.build_control_records
      set state=case
        when v_gate_state in ('HOLD','CORRECT') then 'ON_HOLD'
        when v_gate_code='3' and v_gate_state='PASS' then 'READY_FOR_ASSURANCE'
        when v_gate_code='4' and v_gate_state='PASS' then 'READY_FOR_RELEASE'
        else state
      end,updated_at=now()
      where build_control_id=v_control_id;
      return jsonb_build_object('status','OK','build_control_id',v_control_id,'gate_code',v_gate_code,'state',v_gate_state,'runtime_lane',v_lane);

    else
      return jsonb_build_object('status','DENIED','error','BUILD_CONTROL_GATE_V2_ACTION_NOT_PERMITTED');
  end case;
end;
$function$;

revoke execute on function public.pcc_build_control_gate_v2(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.pcc_build_control_gate_v2(uuid,text,jsonb) to service_role;

comment on function public.pcc_build_control_gate_v2(uuid,text,jsonb) is
'BOAS-bound PCC Build Control gate operations. Prime Mason controls Gates 0-3; New Mason/CATE is limited to Gate 4; Gate 5 remains reserved for governed certification/release authority.';
