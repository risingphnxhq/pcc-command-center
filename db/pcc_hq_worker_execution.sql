begin;

alter table pcc_hq.corporate_task_queue
  drop constraint if exists corporate_task_queue_state_check;
alter table pcc_hq.corporate_task_queue
  add constraint corporate_task_queue_state_check
  check (state in ('ASSIGNED','CLAIMED','IN_PROGRESS','EVIDENCE_SUBMITTED','COMPLETED','HOLD','CANCELLED'));

alter table pcc_hq.corporate_task_history
  drop constraint if exists corporate_task_history_operation_check;
alter table pcc_hq.corporate_task_history
  add constraint corporate_task_history_operation_check
  check (operation in ('CREATE_TASK','CLAIM_TASK','START_TASK','SUBMIT_EVIDENCE','COMPLETE_TASK','HOLD_TASK','CANCEL_TASK'));

create table if not exists pcc_hq.corporate_task_outputs (
  output_id uuid primary key default gen_random_uuid(),
  task_id uuid not null references pcc_hq.corporate_task_queue(task_id),
  action_id uuid not null references pcc_hq.actions(action_id),
  worker_actor_id text not null references corporate_psc.actor_registry(actor_id),
  output_summary text not null check (length(btrim(output_summary)) between 20 and 2000),
  source_ref text not null check (length(btrim(source_ref)) between 5 and 500),
  digest_sha256 text not null check (digest_sha256 ~ '^[0-9a-f]{64}$'),
  evidence_state text not null default 'SUBMITTED' check (evidence_state in ('SUBMITTED','VERIFIED','REJECTED')),
  created_at timestamptz not null default now(),
  unique (task_id, action_id)
);

alter table pcc_hq.corporate_task_outputs enable row level security;
revoke all on table pcc_hq.corporate_task_outputs from public,anon,authenticated;

create or replace function public.pcc_corporate_worker_execution(
  p_commander_subject uuid,
  p_operation text,
  p_task_id uuid,
  p_worker_subject uuid,
  p_output_summary text default null,
  p_source_ref text default null,
  p_digest_sha256 text default null
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
  v_output_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_digest text;
  v_next_state text;
  v_evidence_kind text;
  v_note text;
begin
  if v_operation not in ('START_TASK','SUBMIT_EVIDENCE','COMPLETE_TASK') then
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

  select t.* into v_task from pcc_hq.corporate_task_queue t
  where t.task_id=p_task_id for update;
  if not found then raise exception using errcode='P0001',message='TASK_NOT_FOUND'; end if;

  select b.actor_id,w.office_id into v_actor_id,v_office_id
  from corporate_psc.actor_auth_bindings b
  join corporate_psc.actor_registry ar on ar.actor_id=b.actor_id and ar.active
  join pcc_hq.workforce_assignments w on w.assignment_id=v_task.assignment_id
  where b.auth_subject=p_worker_subject and b.binding_state='ACTIVE'
    and w.runtime_state='BOUND' and w.office_id='PATRICK_ROSS'
    and b.actor_id='corporate-patrick-ross-worker';
  if v_actor_id is null then
    raise exception using errcode='42501',message='BOUND_WORKER_REQUIRED';
  end if;

  if v_operation='START_TASK' then
    if v_task.state<>'CLAIMED' then raise exception using errcode='P0001',message='TASK_NOT_STARTABLE'; end if;
    v_next_state:='IN_PROGRESS';
    v_evidence_kind:='WORKER_START_POSTCONDITION';
    v_note:='Patrick bounded worker start transition verified. Material output and completion are not claimed.';
  elsif v_operation='SUBMIT_EVIDENCE' then
    if v_task.state<>'IN_PROGRESS' then raise exception using errcode='P0001',message='TASK_NOT_ACCEPTING_EVIDENCE'; end if;
    if length(btrim(coalesce(p_output_summary,''))) not between 20 and 2000
       or length(btrim(coalesce(p_source_ref,''))) not between 5 and 500
       or lower(btrim(coalesce(p_digest_sha256,''))) !~ '^[0-9a-f]{64}$' then
      raise exception using errcode='22023',message='VALID_EVIDENCE_REQUIRED';
    end if;
    v_next_state:='EVIDENCE_SUBMITTED';
    v_evidence_kind:='WORKER_OUTPUT_SUBMISSION';
    v_note:='Patrick submitted bounded output evidence. Receipt verifies durable submission only, not quality or completion.';
  else
    if v_task.state<>'EVIDENCE_SUBMITTED' then raise exception using errcode='P0001',message='TASK_NOT_COMPLETABLE'; end if;
    if not exists (select 1 from pcc_hq.corporate_task_outputs o where o.task_id=p_task_id and o.evidence_state='SUBMITTED') then
      raise exception using errcode='P0001',message='SUBMITTED_EVIDENCE_REQUIRED';
    end if;
    v_next_state:='COMPLETED';
    v_evidence_kind:='WORKER_COMPLETION_POSTCONDITION';
    v_note:='Task completion transition verified against a durable submitted-output record.';
  end if;

  v_before:=to_jsonb(v_task);
  insert into pcc_hq.actions
    (mission_id,workstream_id,owner_office_id,authority_id,title,state)
  values
    (v_task.mission_id,v_task.workstream_id,v_office_id,v_task.command_authority_id,
     replace(initcap(replace(lower(v_operation),'_',' ')),'Task','task')||': '||left(v_task.title,170),'EXECUTED')
  returning action_id into v_action_id;

  if v_operation='SUBMIT_EVIDENCE' then
    insert into pcc_hq.corporate_task_outputs
      (task_id,action_id,worker_actor_id,output_summary,source_ref,digest_sha256)
    values
      (p_task_id,v_action_id,v_actor_id,btrim(p_output_summary),btrim(p_source_ref),lower(btrim(p_digest_sha256)))
    returning output_id into v_output_id;
  end if;

  update pcc_hq.corporate_task_queue
  set state=v_next_state,current_action_id=v_action_id,updated_at=now()
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
    (v_action_id,v_evidence_kind,
     case when v_output_id is null then 'pcc_hq.corporate_task_queue/'||p_task_id
          else 'pcc_hq.corporate_task_outputs/'||v_output_id end,
     case when v_output_id is null then v_digest else lower(btrim(p_digest_sha256)) end,v_office_id)
  returning evidence_id into v_evidence_id;

  update pcc_hq.actions set state='VERIFIED',updated_at=now() where action_id=v_action_id;
  insert into pcc_hq.action_receipts
    (action_id,evidence_id,verifier_office_id,verification_result,verification_note,canon_psc_id)
  values
    (v_action_id,v_evidence_id,'AIDEN_MERCER','PASS',v_note,
     'PSC-A-CORPORATE-PCC-PATRICK-WORKER-CLAIM-FOUNDER-BROWSER-ACCEPTANCE-2026-09-26-001')
  returning receipt_id into v_receipt_id;

  return jsonb_build_object(
    'ok',true,'operation',v_operation,'task',v_after,
    'worker_actor_id',v_actor_id,'worker_subject',p_worker_subject,
    'action_id',v_action_id,'event_id',v_event_id,'output_id',v_output_id,
    'evidence_id',v_evidence_id,'receipt_id',v_receipt_id,
    'truth_boundary',case
      when v_operation='START_TASK' then 'WORK_STARTED_ONLY'
      when v_operation='SUBMIT_EVIDENCE' then 'EVIDENCE_SUBMITTED_NOT_COMPLETED'
      else 'COMPLETION_TRANSITION_WITH_DURABLE_EVIDENCE' end
  );
end;
$$;

revoke all on function public.pcc_corporate_worker_execution(uuid,text,uuid,uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.pcc_corporate_worker_execution(uuid,text,uuid,uuid,text,text,text)
  to service_role;

commit;
