-- Record a PMF animation result on the existing PCC job as a private,
-- review-required artifact. This migration never marks quality approved or publishes.
begin;

alter table public.pcc_animation_jobs
  add column if not exists render_result_receipt_id text,
  add column if not exists render_execution_id uuid,
  add column if not exists render_authorization_receipt_id text;

create unique index if not exists pcc_animation_jobs_render_result_receipt_id_uq
  on public.pcc_animation_jobs(render_result_receipt_id)
  where render_result_receipt_id is not null;

create table if not exists public.pcc_animation_render_result_nonces (
  key_id text not null check (key_id = 'pmf-animation-result-v1'),
  nonce uuid not null,
  result_receipt_id text not null,
  receipt jsonb not null check (jsonb_typeof(receipt) = 'object'),
  created_at timestamptz not null default now(),
  primary key (key_id, nonce)
);
alter table public.pcc_animation_render_result_nonces enable row level security;
revoke all on table public.pcc_animation_render_result_nonces from public, anon, authenticated;
grant all on table public.pcc_animation_render_result_nonces to service_role;

create or replace function public.pcc_animation_record_render_receipt_v1(
  p_key_id text,
  p_nonce uuid,
  p_receipt jsonb
) returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','public','auth','pg_temp'
as $function$
declare
  v_job public.pcc_animation_jobs%rowtype;
  v_existing public.pcc_animation_render_result_nonces%rowtype;
  v_job_id uuid;
  v_receipt_id text;
begin
  if p_key_id is distinct from 'pmf-animation-result-v1' or p_nonce is null
     or jsonb_typeof(p_receipt) is distinct from 'object'
     or p_receipt->>'state' is distinct from 'ANIMATION_RECORDED_REVIEW_REQUIRED'
     or p_receipt->>'quality_approved' is distinct from 'false'
     or p_receipt->>'distribution_performed' is distinct from 'false'
     or p_receipt->'artifact'->>'mime_type' is distinct from 'video/mp4'
     or coalesce(p_receipt->'artifact'->>'sha256','') !~* '^[a-f0-9]{64}$'
     or coalesce((p_receipt->'artifact'->>'bytes')::bigint,0) not between 1 and 2000000000 then
    raise exception 'PCC_PMF_RENDER_RECEIPT_INVALID';
  end if;
  begin
    v_job_id := (p_receipt->>'pcc_request_id')::uuid;
  exception when others then
    raise exception 'PCC_PMF_RENDER_REQUEST_ID_INVALID';
  end;
  v_receipt_id := p_receipt->>'result_receipt_id';
  if coalesce(v_receipt_id,'') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'
     or coalesce(p_receipt->>'execution_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(p_receipt->>'render_authorization_receipt_id','') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'
     or p_receipt->'artifact'->>'storage_ref' is distinct from
        'pmf-animation-private/'||p_receipt->>'execution_id'||'/scene.mp4' then
    raise exception 'PCC_PMF_RENDER_RECEIPT_INVALID';
  end if;

  select * into v_existing from public.pcc_animation_render_result_nonces
   where key_id=p_key_id and nonce=p_nonce;
  if found then
    if v_existing.result_receipt_id is distinct from v_receipt_id
       or v_existing.receipt is distinct from p_receipt then
      raise exception 'PCC_PMF_RENDER_NONCE_REPLAY_CONFLICT';
    end if;
    select * into v_job from public.pcc_animation_jobs
     where job_id=v_job_id and render_result_receipt_id=v_receipt_id;
    if not found then raise exception 'PCC_PMF_RENDER_IDEMPOTENCY_STATE_INVALID'; end if;
    return to_jsonb(v_job);
  end if;

  select * into v_job from public.pcc_animation_jobs where job_id=v_job_id for update;
  if not found then raise exception 'PCC_ANIMATION_JOB_NOT_FOUND'; end if;

  if v_job.render_result_receipt_id is not null then
    if v_job.render_result_receipt_id is distinct from v_receipt_id
       or v_job.render_execution_id is distinct from (p_receipt->>'execution_id')::uuid
       or v_job.artifact_manifest->'pmf_render_receipt' is distinct from p_receipt then
      raise exception 'PCC_PMF_RENDER_RESULT_CONFLICT';
    end if;
    insert into public.pcc_animation_render_result_nonces(key_id,nonce,result_receipt_id,receipt)
    values (p_key_id,p_nonce,v_receipt_id,p_receipt);
    return to_jsonb(v_job);
  end if;

  if v_job.status not in ('SCRIPT_REVIEW_PASSED','READY_FOR_PRODUCTION','PRODUCING')
     or v_job.handoff_state <> 'HELD_PMF_ADMISSION_REQUIRED'
     or v_job.handoff_packet is null
     or v_job.handoff_receipt->'pmf_intake_receipt'->>'state' is distinct from 'HELD_PMF_ADMISSION_REQUIRED'
     or v_job.script_bundle->'binary_validation'->>'ok' is distinct from 'true'
     or v_job.review_receipt->>'state' is distinct from 'SCRIPT_REVIEW_PASSED'
     or jsonb_typeof(v_job.review_receipt->'receipts') is distinct from 'array'
     or jsonb_array_length(v_job.review_receipt->'receipts') < 1
     or v_job.boas_approved is distinct from true
     or v_job.knoas_approved is distinct from true
     or v_job.channel_policy_id is null
     or v_job.boas_revision is null or v_job.boas_psc_id is null
     or v_job.knoas_revision is null or v_job.knoas_psc_id is null
     or v_job.render_authorization_receipt_id is distinct from p_receipt->>'render_authorization_receipt_id' then
    raise exception 'PCC_PMF_RENDER_REQUEST_NOT_AUTHORIZED_FOR_RESULT';
  end if;

  insert into public.pcc_animation_render_result_nonces(key_id,nonce,result_receipt_id,receipt)
  values (p_key_id,p_nonce,v_receipt_id,p_receipt);

  update public.pcc_animation_jobs
     set status='QA',
         render_result_receipt_id=v_receipt_id,
         render_execution_id=(p_receipt->>'execution_id')::uuid,
         artifact_manifest=jsonb_build_object(
           'schema_version','PCC_PMF_PRIVATE_RENDER_RECEIPT_V1',
           'review_state','REVIEW_REQUIRED',
           'private',true,
           'pmf_render_receipt',p_receipt,
           'artifact',p_receipt->'artifact',
           'quality_approved',false,
           'distribution_performed',false
         ),
         updated_at=now()
   where job_id=v_job_id
   returning * into v_job;

  return to_jsonb(v_job);
end;
$function$;

revoke all on function public.pcc_animation_record_render_receipt_v1(text,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.pcc_animation_record_render_receipt_v1(text,uuid,jsonb)
  to service_role;

commit;
