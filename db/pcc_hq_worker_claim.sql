begin;

alter table pcc_hq.corporate_task_queue
  drop constraint if exists corporate_task_queue_state_check;
alter table pcc_hq.corporate_task_queue
  add constraint corporate_task_queue_state_check
  check (state in ('ASSIGNED','CLAIMED','HOLD','CANCELLED'));

alter table pcc_hq.corporate_task_history
  drop constraint if exists corporate_task_history_operation_check;
alter table pcc_hq.corporate_task_history
  add constraint corporate_task_history_operation_check
  check (operation in ('CREATE_TASK','CLAIM_TASK','HOLD_TASK','CANCEL_TASK'));

create or replace function public.pcc_provision_corporate_worker(
  p_commander_subject uuid,
  p_worker_subject uuid,
  p_assignment_id text,
  p_actor_id text,
  p_display_name text,
  p_role_title text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog,public,pcc_hq,corporate_psc,auth,extensions
as $$
declare
  v_office_id text;
  v_runtime_state text;
begin
  if p_commander_subject is null or p_worker_subject is null then
    raise exception using errcode='42501',message='AUTH_REQUIRED';
  end if;
  if not exists (
    select 1 from pcc_hq.command_authorizations a
    join pcc_hq.source_identity_registry s
      on s.actor_id=a.actor_id and s.auth_subject=a.auth_subject
    where a.actor_id='corporate-coo-chad-g-pennington'
      and a.auth_subject=p_commander_subject
      and a.capability='PCC_CORPORATE_TASK_QUEUE'
      and a.state='ACTIVE'
  ) then
    raise exception using errcode='42501',message='COMMAND_AUTHORITY_REQUIRED';
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id=p_worker_subject
      and u.email_confirmed_at is not null
      and u.raw_app_meta_data->>'rpe_actor_id'=p_actor_id
      and u.raw_app_meta_data->>'rpe_identity_class'='CORPORATE_SERVICE_WORKER'
  ) then
    raise exception using errcode='42501',message='WORKER_AUTH_PRINCIPAL_REQUIRED';
  end if;
  select w.office_id into v_office_id
  from pcc_hq.workforce_assignments w
  join pcc_hq.office_registry o on o.office_id=w.office_id
  where w.assignment_id=p_assignment_id
    and w.lifecycle_state='REGISTERED'
    and w.jurisdiction like 'CORPORATE%'
    and o.authority_domain='CORPORATE'
    and o.state='ACTIVE';
  if v_office_id is null then
    raise exception using errcode='22023',message='ASSIGNMENT_NOT_ELIGIBLE';
  end if;
  if p_assignment_id<>'G1-PATRICK-CORP-ENG'
     or p_actor_id<>'corporate-patrick-ross-worker'
     or v_office_id<>'PATRICK_ROSS' then
    raise exception using errcode='22023',message='WORKER_BINDING_SCOPE_MISMATCH';
  end if;

  insert into corporate_psc.actor_registry
    (actor_id,display_name,role_title,authority_scope,active)
  values
    (p_actor_id,p_display_name,p_role_title,
     'Bounded Corporate Engineering task claim and evidence production for Patrick Ross assignments; no Systems authority',true)
  on conflict (actor_id) do update
    set display_name=excluded.display_name,
        role_title=excluded.role_title,
        authority_scope=excluded.authority_scope,
        active=true;

  insert into corporate_psc.actor_auth_bindings
    (auth_subject,actor_id,binding_state,authority_psc)
  values
    (p_worker_subject,p_actor_id,'ACTIVE',
     'PSC-A-CORPORATE-PCC-PATRICK-WORKER-IDENTITY-BINDING-BLOCKER-2026-09-26-001')
  on conflict (auth_subject) do update
    set actor_id=excluded.actor_id,
        binding_state='ACTIVE',
        authority_psc=excluded.authority_psc;

  update pcc_hq.workforce_assignments
  set runtime_state='BOUND',updated_at=now()
  where assignment_id=p_assignment_id
  returning runtime_state into v_runtime_state;

  return jsonb_build_object(
    'ok',true,
    'operation','PROVISION_WORKER',
    'assignment_id',p_assignment_id,
    'office_id',v_office_id,
    'actor_id',p_actor_id,
    'auth_subject',p_worker_subject,
    'runtime_state',v_runtime_state,
    'authority_domain','CORPORATE',
    'direct_login','DISABLED_BY_UNDISCLOSED_RANDOM_CREDENTIAL'
  );
end;
$$;

revoke all on function public.pcc_provision_corporate_worker(uuid,uuid,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.pcc_provision_corporate_worker(uuid,uuid,text,text,text,text)
  to service_role;

create or replace function public.pcc_corporate_worker_command(
  p_commander_subject uuid,
  p_operation text,
  p_task_id uuid,
  p_worker_subject uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog,public,pcc_hq,corporate_psc,auth,extensions
as $$
declare
  v_operation text:=upper(btrim(coalesce(p_operation,'')));
  v_task pcc_hq.corporate_task_queue%rowtype;
  v_actor_id text;
  v_office_id text;
  v_action_id uuid;
  v_event_id uuid;
  v_evidence_id uuid;
  v_receipt_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_digest text;
begin
  if v_operation<>'CLAIM_TASK' then
    raise exception using errcode='22023',message='OPERATION_NOT_ALLOWED';
  end if;
  if not exists (
    select 1 from pcc_hq.command_authorizations a
    join pcc_hq.source_identity_registry s
      on s.actor_id=a.actor_id and s.auth_subject=a.auth_subject
    where a.actor_id='corporate-coo-chad-g-pennington'
      and a.auth_subject=p_commander_subject
      and a.capability='PCC_CORPORATE_TASK_QUEUE'
      and a.state='ACTIVE'
  ) then
    raise exception using errcode='42501',message='COMMAND_AUTHORITY_REQUIRED';
  end if;

  select t.* into v_task
  from pcc_hq.corporate_task_queue t
  where t.task_id=p_task_id
  for update;
  if not found then raise exception using errcode='P0001',message='TASK_NOT_FOUND'; end if;
  if v_task.state<>'ASSIGNED' then
    raise exception using errcode='P0001',message='TASK_NOT_CLAIMABLE';
  end if;

  select b.actor_id,w.office_id into v_actor_id,v_office_id
  from corporate_psc.actor_auth_bindings b
  join corporate_psc.actor_registry ar on ar.actor_id=b.actor_id and ar.active
  join pcc_hq.workforce_assignments w on w.assignment_id=v_task.assignment_id
  where b.auth_subject=p_worker_subject
    and b.binding_state='ACTIVE'
    and w.runtime_state='BOUND'
    and w.office_id='PATRICK_ROSS'
    and b.actor_id='corporate-patrick-ross-worker';
  if v_actor_id is null then
    raise exception using errcode='42501',message='BOUND_WORKER_REQUIRED';
  end if;

  v_before:=to_jsonb(v_task);
  insert into pcc_hq.actions
    (mission_id,workstream_id,owner_office_id,authority_id,title,state)
  values
    (v_task.mission_id,v_task.workstream_id,v_office_id,v_task.command_authority_id,
     'Worker claim: '||left(v_task.title,180),'EXECUTED')
  returning action_id into v_action_id;

  update pcc_hq.corporate_task_queue
  set state='CLAIMED',current_action_id=v_action_id,updated_at=now()
  where task_id=p_task_id;
  select to_jsonb(t) into v_after from pcc_hq.corporate_task_queue t where t.task_id=p_task_id;
  v_digest:=encode(extensions.digest(convert_to(v_after::text,'UTF8'),'sha256'),'hex');

  insert into pcc_hq.corporate_task_history
    (task_id,action_id,operation,previous_state,resulting_state)
  values(p_task_id,v_action_id,v_operation,v_before,v_after)
  returning event_id into v_event_id;

  insert into pcc_hq.action_evidence
    (action_id,evidence_kind,source_ref,digest_sha256,recorded_by_office_id)
  values
    (v_action_id,'WORKER_CLAIM_POSTCONDITION',
     'pcc_hq.corporate_task_queue/'||p_task_id,v_digest,v_office_id)
  returning evidence_id into v_evidence_id;

  update pcc_hq.actions set state='VERIFIED',updated_at=now() where action_id=v_action_id;
  insert into pcc_hq.action_receipts
    (action_id,evidence_id,verifier_office_id,verification_result,verification_note,canon_psc_id)
  values
    (v_action_id,v_evidence_id,'AIDEN_MERCER','PASS',
     'Bound Patrick worker identity and atomic CLAIMED postcondition verified. Execution and material output are not claimed.',
     'PSC-A-CORPORATE-PCC-PATRICK-WORKER-IDENTITY-BINDING-BLOCKER-2026-09-26-001')
  returning receipt_id into v_receipt_id;

  return jsonb_build_object(
    'ok',true,'operation',v_operation,'task',v_after,
    'worker_actor_id',v_actor_id,'worker_subject',p_worker_subject,
    'action_id',v_action_id,'event_id',v_event_id,
    'evidence_id',v_evidence_id,'receipt_id',v_receipt_id,
    'worker_execution','CLAIM_ONLY','material_output','NOT_CLAIMED'
  );
end;
$$;

revoke all on function public.pcc_corporate_worker_command(uuid,text,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.pcc_corporate_worker_command(uuid,text,uuid,uuid)
  to service_role;

commit;
