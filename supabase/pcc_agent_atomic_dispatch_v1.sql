CREATE OR REPLACE FUNCTION public.pcc_agent_dispatch_v1(p_auth_subject uuid, p_work_order_id text, p_provider text DEFAULT 'OPENAI_AGENT_API'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pcc_institutional', 'pcc_workforce'
AS $function$
declare
  v_actor_id text;
  v_work pcc_workforce.work_orders%rowtype;
  v_stream pcc_workforce.stream_registry%rowtype;
  v_execution pcc_workforce.agent_executions%rowtype;
  v_execution_id text;
  v_claim_receipt_id uuid;
  v_registration_receipt_id uuid;
begin
  if p_auth_subject is null then
    raise exception 'AUTHENTICATED_RUNTIME_REQUIRED';
  end if;
  if nullif(trim(p_work_order_id),'') is null then
    raise exception 'WORK_ORDER_ID_REQUIRED';
  end if;

  select b.actor_id into v_actor_id
  from pcc_institutional.auth_actor_bindings b
  join pcc_institutional.actors a
    on a.actor_id=b.actor_id and a.status='ACTIVE'
  where b.auth_subject=p_auth_subject
    and b.status='ACTIVE'
    and b.valid_from<=now()
    and (b.valid_until is null or b.valid_until>now())
  order by b.created_at desc
  limit 1;

  if v_actor_id is null then
    raise exception 'ACTIVE_ACTOR_BINDING_REQUIRED';
  end if;
  if v_actor_id <> 'RPE-MASON-HQ' then
    raise exception 'MASON_SYSTEMS_COMMAND_REQUIRED';
  end if;

  select * into v_work
  from pcc_workforce.work_orders
  where work_order_id=trim(p_work_order_id)
  for update;

  if not found then
    raise exception 'WORK_ORDER_NOT_FOUND';
  end if;

  select * into v_stream
  from pcc_workforce.stream_registry
  where stream_id=v_work.workforce_stream_id
  for update;

  if not found then
    raise exception 'WORKFORCE_STREAM_NOT_FOUND';
  end if;
  if v_stream.stream_class <> 'WORKFORCE_STREAM' then
    raise exception 'WORKFORCE_STREAM_REQUIRED';
  end if;
  if v_stream.parent_actor_id <> v_actor_id then
    raise exception 'WORK_ORDER_ACTOR_MISMATCH';
  end if;
  if v_stream.expires_at is not null and v_stream.expires_at<=now() then
    raise exception 'WORKFORCE_STREAM_EXPIRED';
  end if;

  if v_work.status='ISSUED' and v_stream.status='ISSUED' then
    update pcc_workforce.stream_registry
      set status='ACTIVE',
          claimed_by_subject=p_auth_subject,
          claimed_at=now(),
          updated_at=now()
      where stream_id=v_stream.stream_id;

    update pcc_workforce.work_orders
      set status='ACTIVE',
          claimed_by_subject=p_auth_subject,
          claimed_at=now(),
          updated_at=now()
      where work_order_id=v_work.work_order_id;

    insert into pcc_workforce.adapter_receipts(
      action,actor_id,auth_subject,stream_id,work_order_id,result_state,details
    ) values (
      'DISPATCH_CLAIM_WORK_ORDER',v_actor_id,p_auth_subject,
      v_stream.stream_id,v_work.work_order_id,'CLAIMED',
      jsonb_build_object(
        'dispatch_mode','ATOMIC_AGENT_DISPATCH',
        'provider',upper(trim(coalesce(nullif(p_provider,''),'OPENAI_AGENT_API')))
      )
    ) returning receipt_id into v_claim_receipt_id;

    update pcc_workforce.stream_registry
      set latest_receipt_id=v_claim_receipt_id
      where stream_id=v_stream.stream_id;
    update pcc_workforce.work_orders
      set latest_receipt_id=v_claim_receipt_id
      where work_order_id=v_work.work_order_id;
  elsif v_work.claimed_by_subject is distinct from p_auth_subject
     or v_stream.claimed_by_subject is distinct from p_auth_subject then
    raise exception 'CLAIMED_RUNTIME_REQUIRED';
  elsif v_work.status not in ('ACTIVE','CHECKPOINTED')
     or v_stream.status not in ('ACTIVE','CHECKPOINTED') then
    raise exception 'WORK_ORDER_NOT_DISPATCHABLE';
  end if;

  select * into v_execution
  from pcc_workforce.agent_executions
  where work_order_id=v_work.work_order_id
    and runtime_subject=p_auth_subject
    and status in ('REGISTERED','ACTIVE','PAUSED')
  order by created_at desc
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'status','REGISTERED',
      'idempotent',true,
      'actor_id',v_actor_id,
      'runtime_subject',p_auth_subject,
      'stream_id',v_stream.stream_id,
      'work_order_id',v_work.work_order_id,
      'execution_id',v_execution.execution_id,
      'claim_receipt_id',v_claim_receipt_id,
      'registration_receipt_id',v_execution.latest_receipt_id
    );
  end if;

  v_execution_id := format(
    'PCC-EXEC-%s-%s',
    regexp_replace(upper(v_work.target_system),'[^A-Z0-9]+','-','g'),
    lpad(nextval('pcc_workforce.agent_execution_sequence')::text,6,'0')
  );

  insert into pcc_workforce.agent_executions(
    execution_id,stream_id,work_order_id,actor_id,runtime_subject,
    provider,status,metadata
  ) values (
    v_execution_id,v_stream.stream_id,v_work.work_order_id,v_actor_id,p_auth_subject,
    upper(trim(coalesce(nullif(p_provider,''),'OPENAI_AGENT_API'))),
    'REGISTERED',
    jsonb_build_object(
      'dispatch_mode','ATOMIC_AGENT_DISPATCH',
      'authenticated_runtime_subject',p_auth_subject,
      'authority_envelope',v_work.authority_envelope
    )
  );

  insert into pcc_workforce.adapter_receipts(
    action,actor_id,auth_subject,stream_id,work_order_id,result_state,details
  ) values (
    'DISPATCH_REGISTER_AGENT_EXECUTION',v_actor_id,p_auth_subject,
    v_stream.stream_id,v_work.work_order_id,'AGENT_EXECUTION_REGISTERED',
    jsonb_build_object(
      'execution_id',v_execution_id,
      'provider',upper(trim(coalesce(nullif(p_provider,''),'OPENAI_AGENT_API'))),
      'dispatch_mode','ATOMIC_AGENT_DISPATCH'
    )
  ) returning receipt_id into v_registration_receipt_id;

  update pcc_workforce.agent_executions
    set latest_receipt_id=v_registration_receipt_id,
        updated_at=now()
    where execution_id=v_execution_id;

  return jsonb_build_object(
    'status','REGISTERED',
    'idempotent',false,
    'actor_id',v_actor_id,
    'runtime_subject',p_auth_subject,
    'stream_id',v_stream.stream_id,
    'work_order_id',v_work.work_order_id,
    'execution_id',v_execution_id,
    'claim_receipt_id',v_claim_receipt_id,
    'registration_receipt_id',v_registration_receipt_id
  );
end;
$function$

revoke all on function public.pcc_agent_dispatch_v1(uuid,text,text) from public;
revoke all on function public.pcc_agent_dispatch_v1(uuid,text,text) from anon;
revoke all on function public.pcc_agent_dispatch_v1(uuid,text,text) from authenticated;
grant execute on function public.pcc_agent_dispatch_v1(uuid,text,text) to service_role;
comment on function public.pcc_agent_dispatch_v1(uuid,text,text) is
'PCC V1 atomic browser-authenticated work-order claim and Agent execution registration. Service-role callable only; caller must first validate the supplied Supabase Auth bearer token.';
