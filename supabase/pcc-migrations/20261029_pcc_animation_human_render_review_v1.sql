-- Durable PCC human review receipt for private PMF render artifacts.
-- A review decision never releases or publishes the artifact.
begin;

alter table public.pcc_animation_jobs
  add column if not exists render_review_preview_receipt jsonb,
  add column if not exists render_review_state text,
  add column if not exists render_review_receipt jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='pcc_animation_jobs_render_review_state_check'
      and conrelid='public.pcc_animation_jobs'::regclass
  ) then
    alter table public.pcc_animation_jobs
      add constraint pcc_animation_jobs_render_review_state_check
      check (render_review_state is null or render_review_state in ('APPROVED','REVISION_REQUIRED'));
  end if;
end
$$;

create or replace function public.pcc_animation_record_render_preview_v1(
  p_subject uuid,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','pg_temp'
as $function$
declare
  v_job public.pcc_animation_jobs%rowtype;
  v_job_id uuid;
  v_execution_id uuid;
  v_receipt_id text;
  v_sha text;
  v_expires timestamptz;
  v_preview jsonb;
begin
  if p_subject is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'PCC_RENDER_PREVIEW_ARGUMENT_INVALID';
  end if;
  begin
    v_job_id := (p_payload->>'job_id')::uuid;
    v_execution_id := (p_payload->>'execution_id')::uuid;
    v_expires := (p_payload->>'expires_at')::timestamptz;
  exception when others then
    raise exception 'PCC_RENDER_PREVIEW_ARGUMENT_INVALID';
  end;
  v_receipt_id := p_payload->>'result_receipt_id';
  v_sha := lower(p_payload->>'artifact_sha256');
  if v_job_id is null or v_execution_id is null
     or coalesce(v_receipt_id,'') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'
     or coalesce(v_sha,'') !~ '^[a-f0-9]{64}$'
     or v_expires is null or v_expires <= now() or v_expires > now()+interval '120 seconds' then
    raise exception 'PCC_RENDER_PREVIEW_ARGUMENT_INVALID';
  end if;
  select * into v_job from public.pcc_animation_jobs where job_id=v_job_id for update;
  if not found or v_job.status <> 'QA'
     or v_job.render_execution_id is distinct from v_execution_id
     or v_job.render_result_receipt_id is distinct from v_receipt_id
     or v_job.artifact_manifest->>'private' is distinct from 'true'
     or v_job.artifact_manifest->>'review_state' is distinct from 'REVIEW_REQUIRED'
     or v_job.artifact_manifest->'artifact'->>'sha256' is distinct from v_sha
     or v_job.render_review_state is not null then
    raise exception 'PCC_RENDER_PREVIEW_NOT_REVIEWABLE';
  end if;
  v_preview := jsonb_build_object(
    'schema_version','PCC_RENDER_REVIEW_PREVIEW_V1',
    'reviewer_subject',p_subject,
    'execution_id',v_execution_id,
    'result_receipt_id',v_receipt_id,
    'artifact_sha256',v_sha,
    'issued_at',now(),
    'expires_at',v_expires,
    'distribution_performed',false
  );
  update public.pcc_animation_jobs
     set render_review_preview_receipt=v_preview,updated_at=now()
   where job_id=v_job_id returning * into v_job;
  return v_preview;
end;
$function$;

create or replace function public.pcc_animation_record_render_decision_v1(
  p_subject uuid,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','pg_temp'
as $function$
declare
  v_job public.pcc_animation_jobs%rowtype;
  v_job_id uuid;
  v_decision text;
  v_notes text;
  v_quality boolean;
  v_receipt jsonb;
begin
  if p_subject is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'PCC_RENDER_REVIEW_ARGUMENT_INVALID';
  end if;
  begin v_job_id := (p_payload->>'job_id')::uuid;
  exception when others then raise exception 'PCC_RENDER_REVIEW_ARGUMENT_INVALID'; end;
  v_decision := p_payload->>'decision';
  v_notes := trim(coalesce(p_payload->>'notes',''));
  if v_decision is null or v_decision not in ('APPROVE','REQUEST_REVISION') or length(v_notes) not between 1 and 2000 then
    raise exception 'PCC_RENDER_REVIEW_ARGUMENT_INVALID';
  end if;
  v_quality := v_decision='APPROVE';
  select * into v_job from public.pcc_animation_jobs where job_id=v_job_id for update;
  if not found then raise exception 'PCC_ANIMATION_JOB_NOT_FOUND'; end if;
  if v_job.render_review_receipt is not null then
    if v_job.render_review_receipt->>'reviewer_subject'=p_subject::text
       and v_job.render_review_receipt->>'decision'=v_decision
       and v_job.render_review_receipt->>'notes'=v_notes then
      return v_job.render_review_receipt;
    end if;
    raise exception 'PCC_RENDER_REVIEW_ALREADY_RECORDED';
  end if;
  if v_job.status <> 'QA' or v_job.render_result_receipt_id is null
     or v_job.artifact_manifest->>'private' is distinct from 'true'
     or v_job.artifact_manifest->'pmf_render_receipt'->>'quality_approved' is distinct from 'false'
     or v_job.artifact_manifest->'pmf_render_receipt'->>'distribution_performed' is distinct from 'false'
     or v_job.render_review_preview_receipt->>'reviewer_subject' is distinct from p_subject::text
     or v_job.render_review_preview_receipt->>'execution_id' is distinct from v_job.render_execution_id::text
     or v_job.render_review_preview_receipt->>'result_receipt_id' is distinct from v_job.render_result_receipt_id
     or v_job.render_review_preview_receipt->>'artifact_sha256' is distinct from v_job.artifact_manifest->'artifact'->>'sha256'
     or nullif(v_job.render_review_preview_receipt->>'issued_at','')::timestamptz < now()-interval '30 minutes'
     or v_job.render_review_state is not null then
    raise exception 'PCC_RENDER_REVIEW_PREVIEW_REQUIRED';
  end if;
  v_receipt := jsonb_build_object(
    'schema_version','PCC_RENDER_HUMAN_REVIEW_V1',
    'reviewer_subject',p_subject,
    'decision',v_decision,
    'notes',v_notes,
    'result_receipt_id',v_job.render_result_receipt_id,
    'execution_id',v_job.render_execution_id,
    'artifact_sha256',v_job.artifact_manifest->'artifact'->>'sha256',
    'quality_approved',v_quality,
    'distribution_performed',false,
    'reviewed_at',now()
  );
  update public.pcc_animation_jobs
     set render_review_state=case when v_quality then 'APPROVED' else 'REVISION_REQUIRED' end,
         render_review_receipt=v_receipt,
         artifact_manifest=artifact_manifest || jsonb_build_object(
           'review_state',case when v_quality then 'REVIEWED_APPROVED' else 'REVISION_REQUIRED' end,
           'quality_approved',v_quality,
           'distribution_performed',false,
           'render_review_receipt',v_receipt
         ),
         updated_at=now()
   where job_id=v_job_id returning * into v_job;
  return v_receipt;
end;
$function$;

revoke all on function public.pcc_animation_record_render_preview_v1(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.pcc_animation_record_render_decision_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.pcc_animation_record_render_preview_v1(uuid,jsonb) to service_role;
grant execute on function public.pcc_animation_record_render_decision_v1(uuid,jsonb) to service_role;

commit;
