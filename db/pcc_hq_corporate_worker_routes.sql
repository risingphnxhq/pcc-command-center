-- Review-only Corporate worker route generalization. Apply only after Canon review.
begin;

create table pcc_hq.corporate_worker_routes (
  assignment_id text primary key references pcc_hq.workforce_assignments(assignment_id),
  office_id text not null references pcc_hq.office_registry(office_id),
  actor_id text not null unique references corporate_psc.actor_registry(actor_id),
  worker_subject uuid not null unique,
  route_state text not null check (route_state in ('ACTIVE','HELD')),
  authority_psc text not null,
  created_at timestamptz not null default now(),
  unique (assignment_id, office_id, actor_id, worker_subject)
);
alter table pcc_hq.corporate_worker_routes enable row level security;
revoke all on pcc_hq.corporate_worker_routes from public, anon, authenticated;

-- Existing verified route is the only seed. New routes require their own
-- verified Auth principal, assignment, PSC, and explicit registration.
insert into pcc_hq.corporate_worker_routes
  (assignment_id, office_id, actor_id, worker_subject, route_state, authority_psc)
select 'G1-PATRICK-CORP-ENG', 'PATRICK_ROSS', b.actor_id, b.auth_subject,
  'ACTIVE', b.authority_psc
from corporate_psc.actor_auth_bindings b
join corporate_psc.actor_registry ar on ar.actor_id=b.actor_id and ar.active
join auth.users u on u.id=b.auth_subject
where b.actor_id='corporate-patrick-ross-worker'
  and b.binding_state='ACTIVE'
  and u.raw_app_meta_data->>'rpe_actor_id'=b.actor_id
  and u.raw_app_meta_data->>'rpe_office_id'='PATRICK_ROSS'
  and u.raw_app_meta_data->>'rpe_authority_domain'='CORPORATE'
  and u.raw_app_meta_data->>'rpe_identity_class'='CORPORATE_SERVICE_WORKER';

do $$ begin
  if (select count(*) from pcc_hq.corporate_worker_routes) <> 1 then
    raise exception 'PATRICK_ROUTE_SEED_NOT_VERIFIED';
  end if;
end $$;

create or replace function public.pcc_resolve_corporate_worker(p_assignment_id text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pcc_hq,corporate_psc,auth
as $$
declare v_route record;
begin
  select r.assignment_id,r.office_id,r.actor_id,r.worker_subject into v_route
  from pcc_hq.corporate_worker_routes r
  join pcc_hq.workforce_assignments w
    on w.assignment_id=r.assignment_id and w.office_id=r.office_id
  join pcc_hq.office_registry o on o.office_id=r.office_id
  join corporate_psc.actor_auth_bindings b
    on b.actor_id=r.actor_id and b.auth_subject=r.worker_subject
  join corporate_psc.actor_registry ar on ar.actor_id=r.actor_id
  join auth.users u on u.id=r.worker_subject
  where r.assignment_id=p_assignment_id and r.route_state='ACTIVE'
    and w.lifecycle_state='REGISTERED' and w.runtime_state='BOUND'
    and w.jurisdiction like 'CORPORATE%'
    and o.state='ACTIVE' and o.authority_domain='CORPORATE'
    and b.binding_state='ACTIVE' and ar.active
    and u.email_confirmed_at is not null
    and u.raw_app_meta_data->>'rpe_actor_id'=r.actor_id
    and u.raw_app_meta_data->>'rpe_office_id'=r.office_id
    and u.raw_app_meta_data->>'rpe_identity_class'='CORPORATE_SERVICE_WORKER'
    and u.raw_app_meta_data->>'rpe_authority_domain'='CORPORATE';
  if not found then raise exception using errcode='42501',message='BOUND_CORPORATE_WORKER_REQUIRED'; end if;
  return jsonb_build_object('assignment_id',v_route.assignment_id,
    'office_id',v_route.office_id,'actor_id',v_route.actor_id,
    'worker_subject',v_route.worker_subject);
end $$;
revoke all on function public.pcc_resolve_corporate_worker(text) from public,anon,authenticated;
grant execute on function public.pcc_resolve_corporate_worker(text) to service_role;

create or replace function public.pcc_resolve_corporate_task_worker(p_task_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pcc_hq,corporate_psc,auth
as $$
declare v_assignment_id text;
begin
  select assignment_id into v_assignment_id
  from pcc_hq.corporate_task_queue where task_id=p_task_id;
  if not found then raise exception using errcode='P0001',message='TASK_NOT_FOUND'; end if;
  return public.pcc_resolve_corporate_worker(v_assignment_id);
end $$;
revoke all on function public.pcc_resolve_corporate_task_worker(uuid) from public,anon,authenticated;
grant execute on function public.pcc_resolve_corporate_task_worker(uuid) to service_role;

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

  select r.actor_id, r.office_id into v_actor_id, v_office_id
  from pcc_hq.corporate_worker_routes r
  where r.assignment_id=v_task.assignment_id
    and r.worker_subject=p_worker_subject
    and r.route_state='ACTIVE';
  if v_actor_id is null then
    raise exception using errcode='42501',message='BOUND_WORKER_REQUIRED';
  end if;
  -- The resolver validates the office, assignment, actor, Auth principal,
  -- and Corporate domain on every transition, not just at provisioning.
  if (public.pcc_resolve_corporate_worker(v_task.assignment_id)->>'worker_subject')::uuid
     is distinct from p_worker_subject then
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
     'Bound Corporate worker identity and atomic CLAIMED postcondition verified. Canon closure pending.',
     null)
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

  select r.actor_id, r.office_id into v_actor_id, v_office_id
  from pcc_hq.corporate_worker_routes r
  where r.assignment_id=v_task.assignment_id
    and r.worker_subject=p_worker_subject
    and r.route_state='ACTIVE';
  if v_actor_id is null then
    raise exception using errcode='42501',message='BOUND_WORKER_REQUIRED';
  end if;
  -- The resolver validates the office, assignment, actor, Auth principal,
  -- and Corporate domain on every transition, not just at provisioning.
  if (public.pcc_resolve_corporate_worker(v_task.assignment_id)->>'worker_subject')::uuid
     is distinct from p_worker_subject then
    raise exception using errcode='42501',message='BOUND_WORKER_REQUIRED';
  end if;

  if v_operation='START_TASK' then
    if v_task.state<>'CLAIMED' then raise exception using errcode='P0001',message='TASK_NOT_STARTABLE'; end if;
    v_next_state:='IN_PROGRESS';
    v_evidence_kind:='WORKER_START_POSTCONDITION';
    v_note:='Bounded Corporate worker start transition verified. Canon closure pending.';
  elsif v_operation='SUBMIT_EVIDENCE' then
    if v_task.state<>'IN_PROGRESS' then raise exception using errcode='P0001',message='TASK_NOT_ACCEPTING_EVIDENCE'; end if;
    if length(btrim(coalesce(p_output_summary,''))) not between 20 and 2000
       or length(btrim(coalesce(p_source_ref,''))) not between 5 and 500
       or lower(btrim(coalesce(p_digest_sha256,''))) !~ '^[0-9a-f]{64}$' then
      raise exception using errcode='22023',message='VALID_EVIDENCE_REQUIRED';
    end if;
    v_next_state:='EVIDENCE_SUBMITTED';
    v_evidence_kind:='WORKER_OUTPUT_SUBMISSION';
    v_note:='Corporate worker submitted durable output evidence. Canon closure pending.';
  else
    if v_task.state<>'EVIDENCE_SUBMITTED' then raise exception using errcode='P0001',message='TASK_NOT_COMPLETABLE'; end if;
    if not exists (select 1 from pcc_hq.corporate_task_outputs o where o.task_id=p_task_id and o.worker_actor_id=v_actor_id and o.evidence_state='SUBMITTED') then
      raise exception using errcode='P0001',message='SUBMITTED_EVIDENCE_REQUIRED';
    end if;
    v_next_state:='COMPLETED';
    v_evidence_kind:='WORKER_COMPLETION_POSTCONDITION';
    v_note:='Task completion transition verified against a bound worker output. Canon closure pending.';
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
     null)
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

revoke all on function public.pcc_corporate_worker_command(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.pcc_corporate_worker_command(uuid,text,uuid,uuid) to service_role;
revoke all on function public.pcc_corporate_worker_execution(uuid,text,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.pcc_corporate_worker_execution(uuid,text,uuid,uuid,text,text,text) to service_role;
commit;
