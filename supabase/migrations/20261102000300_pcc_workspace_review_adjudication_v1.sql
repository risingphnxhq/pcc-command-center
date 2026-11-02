-- PCC creative workspace review/adjudication v1.
-- Triage decisions are auditable and never grant execution, canon, rendering, or publication authority.
create table if not exists public.pcc_workspace_intake_review_events_v1 (
  review_action_id uuid primary key,
  intake_id uuid not null references public.pcc_workspace_intake_v1(intake_id),
  reviewer_subject uuid not null references auth.users(id),
  reviewer_actor_id text not null check (reviewer_actor_id = 'RPE-MASON-HQ'),
  decision text not null check (decision in ('ACCEPTED','NEEDS_CHANGES','DECLINED')),
  reason text not null default '' check (length(reason) <= 2000),
  reviewed_at timestamptz not null default now(),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  route_resolution jsonb not null default '{}'::jsonb check (jsonb_typeof(route_resolution)='object'),
  decision_receipt jsonb not null default '{}'::jsonb check (jsonb_typeof(decision_receipt)='object')
);
create index if not exists pcc_workspace_review_queue_idx
  on public.pcc_workspace_intake_v1(status,review_state,created_at);

alter table public.pcc_workspace_intake_review_events_v1 enable row level security;
revoke all on public.pcc_workspace_intake_review_events_v1 from anon, authenticated;
grant select, insert on public.pcc_workspace_intake_review_events_v1 to service_role;
revoke update, delete on public.pcc_workspace_intake_review_events_v1 from service_role;

create or replace function public.pcc_workspace_review_intake_v1(
  p_intake_id uuid,
  p_reviewer_subject uuid,
  p_review_action_id uuid,
  p_decision text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pcc_institutional
as $function$
declare
  v_intake public.pcc_workspace_intake_v1%rowtype;
  v_existing public.pcc_workspace_intake_review_events_v1%rowtype;
  v_now timestamptz := clock_timestamp();
  v_reason text := coalesce(p_reason,'');
  v_route jsonb;
  v_receipt jsonb;
begin
  if p_intake_id is null or p_reviewer_subject is null or p_review_action_id is null then
    return jsonb_build_object('ok',false,'error','REVIEW_FIELDS_REQUIRED');
  end if;
  if p_decision is null or p_decision not in ('ACCEPTED','NEEDS_CHANGES','DECLINED') or length(v_reason)>2000 then
    return jsonb_build_object('ok',false,'error','REVIEW_DECISION_INVALID');
  end if;
  if p_decision in ('NEEDS_CHANGES','DECLINED') and length(btrim(v_reason))=0 then
    return jsonb_build_object('ok',false,'error','REVIEW_REASON_REQUIRED');
  end if;

  if not exists (
    select 1
    from pcc_institutional.auth_actor_bindings b
    join pcc_institutional.authority_assignments a on a.actor_id=b.actor_id
    where b.auth_subject=p_reviewer_subject
      and b.actor_id='RPE-MASON-HQ'
      and b.binding_class='DIRECT_ACTOR'
      and b.status='ACTIVE'
      and b.metadata->>'runtime_lane'='PRIME_MASON_ACCOUNT'
      and b.valid_from<=v_now
      and (b.valid_until is null or b.valid_until>=v_now)
      and a.authority_code='RPE-CSE'
      and a.status='ACTIVE'
      and a.valid_from<=v_now
      and (a.valid_until is null or a.valid_until>=v_now)
      and a.capabilities ? 'VERIFICATION'
  ) then
    return jsonb_build_object('ok',false,'error','WORKSPACE_REVIEW_AUTHORITY_REQUIRED');
  end if;

  select * into v_intake
  from public.pcc_workspace_intake_v1
  where intake_id=p_intake_id
  for update;
  if not found then return jsonb_build_object('ok',false,'error','INTAKE_NOT_FOUND'); end if;

  -- Lock the intake before checking the idempotency key so concurrent retries
  -- observe and return the first committed decision receipt.
  select * into v_existing
  from public.pcc_workspace_intake_review_events_v1
  where review_action_id=p_review_action_id;
  if found then
    if v_existing.intake_id=p_intake_id
      and v_existing.reviewer_subject=p_reviewer_subject
      and v_existing.decision=p_decision
      and v_existing.reason=v_reason then
      return jsonb_build_object('ok',true,'duplicate',true,'decision_receipt',v_existing.decision_receipt);
    end if;
    return jsonb_build_object('ok',false,'error','REVIEW_IDEMPOTENCY_MISMATCH');
  end if;
  if v_intake.status<>'PENDING_PCC_TRIAGE' or v_intake.review_state<>'UNREVIEWED' then
    return jsonb_build_object('ok',false,'error','INTAKE_NOT_REVIEWABLE');
  end if;

  v_route := case
    when jsonb_typeof(v_intake.receipt->'route_resolution')='object' then v_intake.receipt->'route_resolution'
    else '{}'::jsonb end;
  v_receipt := jsonb_build_object(
    'review_action_id',p_review_action_id,
    'intake_id',p_intake_id,
    'decision',p_decision,
    'reason',v_reason,
    'reviewer_subject',p_reviewer_subject,
    'reviewer_actor_id','RPE-MASON-HQ',
    'reviewer_authority','RPE-CSE:VERIFICATION',
    'reviewed_at',v_now,
    'payload_sha256',v_intake.payload_sha256,
    'route_resolution',v_route,
    'approved_for_execution',false,
    'execution_eligible',false,
    'dispatch_state','HELD_DISPATCH_NOT_CONNECTED'
  );

  insert into public.pcc_workspace_intake_review_events_v1(
    review_action_id,intake_id,reviewer_subject,reviewer_actor_id,decision,reason,reviewed_at,
    payload_sha256,route_resolution,decision_receipt
  ) values (
    p_review_action_id,p_intake_id,p_reviewer_subject,'RPE-MASON-HQ',p_decision,v_reason,v_now,
    v_intake.payload_sha256,v_route,v_receipt
  );

  update public.pcc_workspace_intake_v1
    set review_state=p_decision,
        status=case when p_decision='DECLINED' then 'REJECTED' else status end,
        approved_for_execution=false,
        routed_at=null,
        receipt=coalesce(receipt,'{}'::jsonb) || jsonb_build_object(
          'review',v_receipt,
          'review_state',p_decision,
          'approval_state','TRIAGE_REVIEWED_NOT_EXECUTION_APPROVED',
          'execution_eligible',false
        )
    where intake_id=p_intake_id;

  return jsonb_build_object('ok',true,'duplicate',false,'decision_receipt',v_receipt);
end;
$function$;

revoke all on function public.pcc_workspace_review_intake_v1(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.pcc_workspace_review_intake_v1(uuid,uuid,uuid,text,text) to service_role;
comment on table public.pcc_workspace_intake_review_events_v1 is
  'Append-only PCC triage decisions for GPT creative workspace submissions. Triage acceptance is not execution, canon, rendering, or publication approval.';
