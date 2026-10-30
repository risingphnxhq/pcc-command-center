-- Records the immutable held-intake receipt returned by Systems/PMF.
-- PCC does not advance to rendering or publication from this receipt.
begin;

create or replace function public.pcc_animation_record_pmf_receipt_v1(
  p_subject uuid,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','public','auth','pg_temp'
as $function$
declare
  v_job public.pcc_animation_jobs%rowtype;
  v_id uuid;
  v_receipt jsonb := p_payload->'pmf_receipt';
  v_can_stage boolean := coalesce((p_payload->>'can_stage')::boolean,false);
  v_can_review boolean := coalesce((p_payload->>'can_review')::boolean,false);
begin
  if p_subject is null or not v_can_stage or jsonb_typeof(v_receipt) is distinct from 'object' then
    raise exception 'PCC_PMF_RECEIPT_AUTHORITY_REQUIRED';
  end if;
  begin
    v_id := (p_payload->>'job_id')::uuid;
  exception when others then
    raise exception 'PCC_ANIMATION_JOB_ID_INVALID';
  end;
  if v_receipt->>'request_id' is distinct from v_id::text
     or v_receipt->>'state' is distinct from 'HELD_PMF_ADMISSION_REQUIRED'
     or v_receipt->>'render_dispatch' is distinct from 'DISABLED'
     or v_receipt->>'cep_enqueue' is distinct from 'DISABLED' then
    raise exception 'PCC_PMF_RECEIPT_INVALID_OR_NOT_HELD';
  end if;

  update public.pcc_animation_jobs
     set handoff_receipt = coalesce(handoff_receipt,'{}'::jsonb)
                            || jsonb_build_object('pmf_intake_receipt',v_receipt),
         updated_at = now()
   where job_id=v_id
     and handoff_state='HELD_PMF_ADMISSION_REQUIRED'
     and handoff_packet is not null
     and (requester_subject=p_subject or v_can_review)
   returning * into v_job;

  if not found then raise exception 'PCC_ANIMATION_HELD_HANDOFF_NOT_FOUND'; end if;
  return to_jsonb(v_job);
end;
$function$;

revoke all on function public.pcc_animation_record_pmf_receipt_v1(uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.pcc_animation_record_pmf_receipt_v1(uuid,jsonb)
  to service_role;

commit;
