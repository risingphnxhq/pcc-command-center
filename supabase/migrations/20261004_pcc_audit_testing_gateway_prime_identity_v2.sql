-- PCC Gate 0 bounded correction: remove legacy Bridge as Prime Build runtime.
-- Current Prime Mason direct-actor identity becomes the only Prime bypass into workforce build routing.
-- New Mason/CATE audit-test behavior remains unchanged.

create or replace function public.pcc_audit_testing_gateway_v1(
  p_auth_subject uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pcc_institutional', 'pcc_workforce'
as $function$
declare
  v_actor_id text;
  v_lane text;
  v_binding_class text;
  v_action text := upper(trim(coalesce(p_action,'')));
  v_work_order_id text := nullif(trim(coalesce(p_payload->>'work_order_id','')),'');
  v_stream_id text := nullif(trim(coalesce(p_payload->>'stream_id','')),'');
  v_execution_id text := nullif(trim(coalesce(p_payload->>'execution_id','')),'');
  v_work pcc_workforce.work_orders%rowtype;
  v_execution pcc_workforce.agent_executions%rowtype;
  v_result jsonb;
begin
  select b.actor_id, b.metadata->>'runtime_lane', b.binding_class
    into v_actor_id, v_lane, v_binding_class
  from pcc_institutional.auth_actor_bindings b
  join pcc_institutional.actors a
    on a.actor_id=b.actor_id and a.status='ACTIVE'
  where b.auth_subject=p_auth_subject and b.status='ACTIVE'
    and b.valid_from<=now() and (b.valid_until is null or b.valid_until>now())
  order by b.created_at desc limit 1;

  if v_actor_id is null then raise exception 'ACTIVE_ACTOR_BINDING_REQUIRED'; end if;
  if v_actor_id <> 'RPE-MASON-HQ' then raise exception 'MASON_SYSTEMS_COMMAND_REQUIRED'; end if;

  if coalesce(v_lane,'') <> 'NEW_MASON_ACCOUNT' then
    if p_auth_subject = '277a74df-5c86-4a16-8e00-1636dad052db'::uuid
       and coalesce(v_lane,'') = 'PRIME_MASON_ACCOUNT'
       and coalesce(v_binding_class,'') = 'DIRECT_ACTOR' then
      return jsonb_build_object('status','PRIME_BUILD_RUNTIME','runtime_lane','PRIME_MASON_ACCOUNT');
    end if;
    raise exception 'RUNTIME_LANE_NOT_AUTHORIZED';
  end if;

  if v_action not in ('HEALTH','LIST_OPEN_WORK','READ_ACTIVATION_PACKAGE','CLAIM_WORK_ORDER','WRITE_CHECKPOINT','LIST_AGENT_EXECUTIONS','READ_AGENT_EXECUTION','AGENT_DISPATCH','AGENT_LAUNCH','AGENT_CONTINUE','AGENT_STATUS') then
    raise exception 'AUDIT_ACTION_NOT_PERMITTED';
  end if;

  if v_action='HEALTH' then
    return jsonb_build_object('status','READY','gateway','PCC_AUDIT_TESTING_GATEWAY_V1','actor_id',v_actor_id,'runtime_lane',v_lane,'allowed_roles',jsonb_build_array('AUDITOR','TESTER','CERTIFIER'),'allowed_actions',jsonb_build_array('READ_ASSIGNED_EVIDENCE','CLAIM_ASSIGNED_AUDIT_WORK','WRITE_AUDIT_CHECKPOINT','READ_AUDIT_EXECUTION','LIST_AUDIT_EXECUTIONS','DISPATCH_APPROVED_AUDIT_AGENT','READ_AUDIT_AGENT_STATUS'));
  end if;

  if v_action='LIST_OPEN_WORK' then
    select coalesce(jsonb_agg(to_jsonb(w) order by w.created_at),'[]'::jsonb) into v_result
    from pcc_workforce.work_orders w
    where w.workforce_role in ('AUDITOR','TESTER','CERTIFIER')
      and (w.status='ISSUED' or (w.claimed_by_subject=p_auth_subject and w.status in ('ACTIVE','CHECKPOINTED')));
    return jsonb_build_object('status','OK','work_orders',v_result,'runtime_lane',v_lane);
  end if;

  if v_action='READ_ACTIVATION_PACKAGE' then
    select w.* into v_work from pcc_workforce.work_orders w
    where w.workforce_stream_id=v_stream_id and w.workforce_role in ('AUDITOR','TESTER','CERTIFIER')
      and (w.status='ISSUED' or w.claimed_by_subject=p_auth_subject) limit 1;
    if not found then raise exception 'AUDIT_WORK_ORDER_NOT_FOUND_OR_NOT_AUTHORIZED'; end if;
    select jsonb_build_object('status','FOUND','stream',to_jsonb(s),'work_order',to_jsonb(v_work)) into v_result
    from pcc_workforce.stream_registry s where s.stream_id=v_stream_id;
    return v_result;
  end if;

  if v_action in ('CLAIM_WORK_ORDER','WRITE_CHECKPOINT') then
    select * into v_work from pcc_workforce.work_orders where work_order_id=v_work_order_id and workforce_stream_id=v_stream_id for update;
    if not found then raise exception 'AUDIT_WORK_ORDER_NOT_FOUND_OR_NOT_AUTHORIZED'; end if;
    if v_work.workforce_role not in ('AUDITOR','TESTER','CERTIFIER') then raise exception 'AUDIT_ROLE_REQUIRED'; end if;
    if v_action='WRITE_CHECKPOINT' and upper(coalesce(p_payload->>'state','CHECKPOINTED')) in ('COMPLETED','CERTIFIED','APPROVED') then raise exception 'AUDIT_LANE_CANNOT_FINALIZE_OR_CERTIFY'; end if;
    return public.pcc_workforce_adapter_v1_core(p_auth_subject,v_action,p_payload);
  end if;

  if v_action='LIST_AGENT_EXECUTIONS' then
    select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc),'[]'::jsonb) into v_result
    from pcc_workforce.agent_executions e join pcc_workforce.work_orders w on w.work_order_id=e.work_order_id
    where e.runtime_subject=p_auth_subject and w.workforce_role in ('AUDITOR','TESTER','CERTIFIER')
      and (v_stream_id is null or e.stream_id=v_stream_id)
      and (v_work_order_id is null or e.work_order_id=v_work_order_id);
    return jsonb_build_object('status','OK','agent_executions',v_result);
  end if;

  if v_action in ('READ_AGENT_EXECUTION','AGENT_LAUNCH','AGENT_CONTINUE','AGENT_STATUS') then
    select e.* into v_execution from pcc_workforce.agent_executions e
    join pcc_workforce.work_orders w on w.work_order_id=e.work_order_id
    where e.execution_id=v_execution_id and e.runtime_subject=p_auth_subject
      and w.workforce_role in ('AUDITOR','TESTER','CERTIFIER') for update;
    if not found then raise exception 'AUDIT_EXECUTION_NOT_FOUND_OR_NOT_AUTHORIZED'; end if;
    if v_action='READ_AGENT_EXECUTION' then
      select jsonb_build_object('status','FOUND','execution',to_jsonb(v_execution),'stream',to_jsonb(s),'work_order',to_jsonb(w),'latest_checkpoint',(select to_jsonb(c) from pcc_workforce.checkpoints c where c.stream_id=v_execution.stream_id order by c.created_at desc limit 1)) into v_result
      from pcc_workforce.stream_registry s join pcc_workforce.work_orders w on w.work_order_id=v_execution.work_order_id
      where s.stream_id=v_execution.stream_id;
      return v_result;
    end if;
    return jsonb_build_object('status','AUTHORIZED','execution_id',v_execution_id,'work_order_id',v_execution.work_order_id);
  end if;

  select * into v_work from pcc_workforce.work_orders where work_order_id=v_work_order_id for update;
  if not found or v_work.workforce_role not in ('AUDITOR','TESTER','CERTIFIER') then raise exception 'AUDIT_ROLE_REQUIRED'; end if;
  if v_work.status not in ('ISSUED','ACTIVE','CHECKPOINTED') then raise exception 'AUDIT_WORK_ORDER_NOT_DISPATCHABLE'; end if;
  if v_work.claimed_by_subject is not null and v_work.claimed_by_subject<>p_auth_subject then raise exception 'CLAIMED_RUNTIME_REQUIRED'; end if;
  return jsonb_build_object('status','AUTHORIZED','work_order_id',v_work.work_order_id,'workforce_role',v_work.workforce_role);
end;
$function$;

revoke all on function public.pcc_audit_testing_gateway_v1(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.pcc_audit_testing_gateway_v1(uuid,text,jsonb) to service_role;
