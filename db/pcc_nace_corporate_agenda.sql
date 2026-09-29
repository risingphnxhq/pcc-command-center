-- NACE's private, bounded Corporate task projection. Gateway verifies individual Founder
-- identity and the bound Chad machine principal before calling this service-only RPC.
create or replace function public.pcc_nace_corporate_agenda(p_commander_subject uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pcc_hq, corporate_psc
as $function$
declare v_tasks jsonb; v_open integer; v_receipts integer;
begin
  if not exists (
    select 1 from pcc_hq.command_authorizations a
    join pcc_hq.source_identity_registry s
      on s.actor_id=a.actor_id and s.auth_subject=a.auth_subject
    where a.actor_id='corporate-coo-chad-g-pennington'
      and a.auth_subject=p_commander_subject
      and a.capability='PCC_CORPORATE_TASK_QUEUE' and a.state='ACTIVE'
  ) then raise exception using errcode='42501',message='COMMAND_AUTHORITY_REQUIRED'; end if;

  select count(*) filter (where state not in ('CANCELLED','COMPLETED'))
    into v_open from pcc_hq.corporate_task_queue;
  select count(*) into v_receipts from pcc_hq.action_receipts ar
    join pcc_hq.corporate_task_queue t on t.current_action_id=ar.action_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'task_id',x.task_id,'title',x.title,'state',x.state,
    'assignment_id',x.assignment_id,'updated_at',x.updated_at,
    'receipt_id',x.receipt_id,'verification_result',x.verification_result
  ) order by x.updated_at desc),'[]'::jsonb) into v_tasks
  from (
    select t.task_id,t.title,t.state,t.assignment_id,t.updated_at,
      ar.receipt_id,ar.verification_result
    from pcc_hq.corporate_task_queue t
    left join lateral (
      select r.receipt_id,r.verification_result from pcc_hq.action_receipts r
      where r.action_id=t.current_action_id order by r.verified_at desc limit 1
    ) ar on true
    order by (t.state not in ('CANCELLED','COMPLETED')) desc,t.updated_at desc
    limit 8
  ) x;
  return jsonb_build_object('source','PCC_CORPORATE_TASK_QUEUE','generated_at',clock_timestamp(),
    'open_task_count',v_open,'current_action_receipt_count',v_receipts,'tasks',v_tasks,
    'independent_verification','NOT_ESTABLISHED_BY_THIS_PROJECTION',
    'systems_state','UNKNOWN_NO_PSC_C_RUNTIME_FEED');
end;
$function$;
revoke all on function public.pcc_nace_corporate_agenda(uuid) from public, anon, authenticated;
grant execute on function public.pcc_nace_corporate_agenda(uuid) to service_role;
