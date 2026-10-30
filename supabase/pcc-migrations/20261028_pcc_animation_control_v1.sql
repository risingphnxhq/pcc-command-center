-- PCC Animation Control V1
-- PCC-only schema. Kept outside supabase/migrations because that directory
-- currently deploys to the Systems/PMF Supabase project.

begin;

create table if not exists public.pcc_animation_jobs (
  job_id uuid primary key default gen_random_uuid(),
  requester_subject uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  channel_key text not null check (channel_key ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$'),
  output_type text not null check (output_type in ('EPISODE','SERIES_EPISODE','ANIMATION','AD','REEL','MICRO_DRAMA','NOVEL','BOOK_MANUSCRIPT','BOOK_CHAPTER','BOOK_SCENE','CORPORATE_MARKETING','CORPORATE_JINGLE','TV_SPOT','TV_COMMERCIAL','SOCIAL_MEDIA_CAMPAIGN','OTHER')),
  production_intent text check (production_intent is null or production_intent in ('MARKETING','NARRATIVE')),
  channel_policy_id uuid,
  channel_policy_revision text check (channel_policy_revision is null or length(trim(channel_policy_revision)) between 1 and 160),
  channel_policy_approval_psc_id text check (channel_policy_approval_psc_id is null or length(trim(channel_policy_approval_psc_id)) between 3 and 160),
  title text not null check (length(trim(title)) between 1 and 200),
  idea text not null check (length(trim(idea)) between 1 and 12000),
  boas_id text check (boas_id is null or length(trim(boas_id)) between 1 and 160),
  boas_revision text check (boas_revision is null or length(trim(boas_revision)) between 1 and 160),
  boas_psc_id text check (boas_psc_id is null or length(trim(boas_psc_id)) between 3 and 160),
  boas_approved boolean not null default false,
  knoas_id text check (knoas_id is null or length(trim(knoas_id)) between 1 and 160),
  knoas_revision text check (knoas_revision is null or length(trim(knoas_revision)) between 1 and 160),
  knoas_psc_id text check (knoas_psc_id is null or length(trim(knoas_psc_id)) between 3 and 160),
  knoas_approved boolean not null default false,
  request_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(request_payload) = 'object'),
  status text not null default 'WAITING_FOR_SYSTEM_REGISTRATION' check (status in ('WAITING_FOR_SYSTEM_REGISTRATION','QUEUED','SCRIPTING','REVIEW','SCRIPT_REVIEW_PASSED','READY_FOR_PRODUCTION','PRODUCING','QA','COMPLETE','FAILED','CANCELLED')),
  routing_state text not null default 'PENDING_PCC_REGISTRATION' check (routing_state in ('PENDING_PCC_REGISTRATION','READY','BLOCKED')),
  script_bundle jsonb,
  review_receipt jsonb,
  pmf_job_ref text,
  pve_job_ref text,
  png_job_ref text,
  render_job_ref text,
  artifact_manifest jsonb,
  handoff_state text not null default 'NOT_STAGED' check (handoff_state in ('NOT_STAGED','HELD_PMF_ADMISSION_REQUIRED')),
  handoff_packet jsonb,
  handoff_receipt jsonb,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requester_subject, idempotency_key)
);

-- Keep the PCC-only migration safe to re-run on its target project.
alter table public.pcc_animation_jobs
  add column if not exists production_intent text,
  add column if not exists channel_policy_id uuid,
  add column if not exists channel_policy_revision text,
  add column if not exists channel_policy_approval_psc_id text,
  add column if not exists boas_revision text,
  add column if not exists boas_approved boolean not null default false,
  add column if not exists knoas_revision text,
  add column if not exists knoas_psc_id text,
  add column if not exists knoas_approved boolean not null default false,
  add column if not exists boas_psc_id text,
  add column if not exists handoff_state text not null default 'NOT_STAGED',
  add column if not exists handoff_packet jsonb,
  add column if not exists handoff_receipt jsonb;

-- Reassert the complete PSC-approved output format set on existing and new PCC tables.
alter table public.pcc_animation_jobs drop constraint if exists pcc_animation_jobs_output_type_check;
alter table public.pcc_animation_jobs add constraint pcc_animation_jobs_output_type_check
  check (output_type in ('EPISODE','SERIES_EPISODE','ANIMATION','AD','REEL','MICRO_DRAMA','NOVEL','BOOK_MANUSCRIPT','BOOK_CHAPTER','BOOK_SCENE','CORPORATE_MARKETING','CORPORATE_JINGLE','TV_SPOT','TV_COMMERCIAL','SOCIAL_MEDIA_CAMPAIGN','OTHER'));

alter table public.pcc_animation_jobs enable row level security;
revoke all on table public.pcc_animation_jobs from public, anon, authenticated;
grant all on table public.pcc_animation_jobs to service_role;

create or replace function public.pcc_animation_job_control_v1(
  p_action text,
  p_subject uuid,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','public','auth','pg_temp'
as $function$
declare
  v_job public.pcc_animation_jobs%rowtype;
  v_action text := upper(coalesce(p_action,''));
  v_id uuid;
  v_can_review boolean := coalesce((p_payload->>'can_review')::boolean,false);
  v_can_stage boolean := coalesce((p_payload->>'can_stage')::boolean,false);
  v_intent text;
  v_packet jsonb;
begin
  if p_subject is null then
    raise exception 'PCC_ANIMATION_SUBJECT_REQUIRED';
  end if;

  if v_action = 'CREATE' then
    if jsonb_typeof(p_payload) is distinct from 'object'
       or length(trim(coalesce(p_payload->>'idempotency_key',''))) not between 8 and 128
       or trim(coalesce(p_payload->>'idempotency_key','')) !~ '^[A-Za-z0-9._:-]+$'
       or length(trim(coalesce(p_payload->>'channel_key',''))) not between 2 and 64
       or trim(coalesce(p_payload->>'channel_key','')) !~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$'
       or length(trim(coalesce(p_payload->>'title',''))) not between 1 and 200
       or length(trim(coalesce(p_payload->>'idea',''))) not between 1 and 12000
       or coalesce(p_payload->>'output_type','') not in ('EPISODE','SERIES_EPISODE','ANIMATION','AD','REEL','MICRO_DRAMA','NOVEL','BOOK_MANUSCRIPT','BOOK_CHAPTER','BOOK_SCENE','CORPORATE_MARKETING','CORPORATE_JINGLE','TV_SPOT','TV_COMMERCIAL','SOCIAL_MEDIA_CAMPAIGN','OTHER')
       or jsonb_typeof(coalesce(p_payload->'request_payload','{}'::jsonb)) is distinct from 'object' then
      raise exception 'PCC_ANIMATION_REQUEST_INVALID';
    end if;

    if p_payload->>'output_type' in ('AD','REEL')
       and coalesce(p_payload->>'production_intent','') not in ('MARKETING','NARRATIVE') then
      raise exception 'PCC_ANIMATION_PRODUCTION_INTENT_REQUIRED';
    end if;
    if p_payload->>'output_type' in ('CORPORATE_MARKETING','TV_SPOT','CORPORATE_JINGLE','TV_COMMERCIAL','SOCIAL_MEDIA_CAMPAIGN')
       and p_payload->>'production_intent' is not null
       and p_payload->>'production_intent' <> 'MARKETING' then
      raise exception 'PCC_ANIMATION_PRODUCTION_INTENT_CONFLICT';
    end if;
    if p_payload->>'output_type' in ('EPISODE','SERIES_EPISODE','ANIMATION','MICRO_DRAMA','NOVEL','BOOK_MANUSCRIPT','BOOK_CHAPTER','BOOK_SCENE')
       and p_payload->>'production_intent' is not null
       and p_payload->>'production_intent' <> 'NARRATIVE' then
      raise exception 'PCC_ANIMATION_PRODUCTION_INTENT_CONFLICT';
    end if;
    v_intent := case
      when p_payload->>'output_type' in ('AD','REEL') then p_payload->>'production_intent'
      when p_payload->>'output_type' in ('CORPORATE_MARKETING','TV_SPOT','CORPORATE_JINGLE','TV_COMMERCIAL','SOCIAL_MEDIA_CAMPAIGN') then 'MARKETING'
      when p_payload->>'output_type' in ('EPISODE','SERIES_EPISODE','ANIMATION','MICRO_DRAMA','NOVEL','BOOK_MANUSCRIPT','BOOK_CHAPTER','BOOK_SCENE') then 'NARRATIVE'
      else null
    end;

    insert into public.pcc_animation_jobs (
      requester_subject,idempotency_key,channel_key,output_type,production_intent,title,idea,
      boas_id,knoas_id,request_payload
    ) values (
      p_subject,
      trim(p_payload->>'idempotency_key'),
      trim(p_payload->>'channel_key'),
      p_payload->>'output_type',
      v_intent,
      trim(p_payload->>'title'),
      trim(p_payload->>'idea'),
      nullif(trim(p_payload->>'boas_id'),''),
      nullif(trim(p_payload->>'knoas_id'),''),
      coalesce(p_payload->'request_payload','{}'::jsonb)
    )
    on conflict (requester_subject,idempotency_key) do nothing;

    select * into v_job
    from public.pcc_animation_jobs
    where requester_subject=p_subject
      and idempotency_key=trim(p_payload->>'idempotency_key');

    if not found then
      raise exception 'PCC_ANIMATION_CREATE_FAILED';
    end if;

    if v_job.channel_key is distinct from trim(p_payload->>'channel_key')
       or v_job.output_type is distinct from p_payload->>'output_type'
       or v_job.production_intent is distinct from v_intent
       or v_job.title is distinct from trim(p_payload->>'title')
       or v_job.idea is distinct from trim(p_payload->>'idea')
       or v_job.request_payload is distinct from coalesce(p_payload->'request_payload','{}'::jsonb) then
      raise exception 'PCC_ANIMATION_IDEMPOTENCY_CONFLICT';
    end if;

    return to_jsonb(v_job);
  elsif v_action = 'CLAIM_SCRIPT' then
    begin
      v_id := (p_payload->>'job_id')::uuid;
    exception when others then
      raise exception 'PCC_ANIMATION_JOB_ID_INVALID';
    end;

    update public.pcc_animation_jobs
       set status='SCRIPTING',
           failure_code=null,
           updated_at=now()
     where job_id=v_id
       and (requester_subject=p_subject or v_can_review)
       and script_bundle is null
       and status in ('WAITING_FOR_SYSTEM_REGISTRATION','QUEUED','REVIEW')
     returning * into v_job;

    if not found then
      raise exception 'PCC_ANIMATION_SCRIPT_ALREADY_CLAIMED_OR_UNAVAILABLE';
    end if;

    return to_jsonb(v_job);
  elsif v_action = 'FAIL_SCRIPT' then
    begin
      v_id := (p_payload->>'job_id')::uuid;
    exception when others then
      raise exception 'PCC_ANIMATION_JOB_ID_INVALID';
    end;

    if jsonb_typeof(p_payload->'review_receipt') is distinct from 'object'
       or length(trim(coalesce(p_payload->>'failure_code',''))) not between 1 and 120 then
      raise exception 'PCC_ANIMATION_SCRIPT_FAILURE_INVALID';
    end if;

    update public.pcc_animation_jobs
       set status='REVIEW',
           failure_code=trim(p_payload->>'failure_code'),
           review_receipt=p_payload->'review_receipt',
           updated_at=now()
     where job_id=v_id
       and (requester_subject=p_subject or v_can_review)
       and script_bundle is null
       and status='SCRIPTING'
     returning * into v_job;

    if not found then
      raise exception 'PCC_ANIMATION_SCRIPT_NOT_CLAIMED';
    end if;

    return to_jsonb(v_job);
  elsif v_action = 'SAVE_SCRIPT' then
    begin
      v_id := (p_payload->>'job_id')::uuid;
    exception when others then
      raise exception 'PCC_ANIMATION_JOB_ID_INVALID';
    end;

    if jsonb_typeof(p_payload->'script_bundle') is distinct from 'object'
       or jsonb_typeof(p_payload->'review_receipt') is distinct from 'object'
       or coalesce(p_payload->>'channel_policy_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
       or p_payload->>'boas_approved' is distinct from 'true'
       or length(trim(coalesce(p_payload->>'boas_psc_id',''))) not between 3 and 160
       or length(trim(coalesce(p_payload->>'knoas_revision',''))) not between 1 and 160
       or p_payload->>'knoas_approved' is distinct from 'true'
       or length(trim(coalesce(p_payload->>'knoas_psc_id',''))) not between 3 and 160
       or coalesce(p_payload->>'status','') not in ('SCRIPT_REVIEW_PASSED','REVIEW') then
      raise exception 'PCC_ANIMATION_SCRIPT_RESULT_INVALID';
    end if;

    update public.pcc_animation_jobs
       set channel_policy_id=(p_payload->>'channel_policy_id')::uuid,
           channel_policy_revision=trim(p_payload->>'channel_policy_revision'),
           channel_policy_approval_psc_id=trim(p_payload->>'channel_policy_approval_psc_id'),
           boas_id=trim(p_payload->>'boas_id'),
           boas_revision=trim(p_payload->>'boas_revision'),
           boas_psc_id=trim(p_payload->>'boas_psc_id'),
           boas_approved=(p_payload->>'boas_approved')::boolean,
           knoas_id=trim(p_payload->>'knoas_id'),
           knoas_revision=trim(p_payload->>'knoas_revision'),
           knoas_psc_id=trim(p_payload->>'knoas_psc_id'),
           knoas_approved=(p_payload->>'knoas_approved')::boolean,
           script_bundle=p_payload->'script_bundle',
           review_receipt=p_payload->'review_receipt',
           status=p_payload->>'status',
           updated_at=now()
     where job_id=v_id
       and (requester_subject=p_subject or v_can_review)
       and script_bundle is null
       and status='SCRIPTING'
     returning * into v_job;

    if not found then
      raise exception 'PCC_ANIMATION_JOB_NOT_FOUND_OR_ALREADY_SCRIPTED';
    end if;

    return to_jsonb(v_job);
  elsif v_action = 'STAGE_HANDOFF' then
    begin
      v_id := (p_payload->>'job_id')::uuid;
    exception when others then
      raise exception 'PCC_ANIMATION_JOB_ID_INVALID';
    end;
    if not v_can_stage then
      raise exception 'PCC_ANIMATION_HANDOFF_ROLE_REQUIRED';
    end if;

    select * into v_job from public.pcc_animation_jobs where job_id=v_id;
    if not found or (v_job.requester_subject <> p_subject and not v_can_review) then
      raise exception 'PCC_ANIMATION_JOB_NOT_FOUND';
    end if;
    if v_job.handoff_packet is not null then
      return to_jsonb(v_job);
    end if;
    if v_job.status <> 'SCRIPT_REVIEW_PASSED'
       or v_job.script_bundle is null
       or v_job.script_bundle->'binary_validation'->>'ok' is distinct from 'true'
       or v_job.review_receipt->>'state' is distinct from 'SCRIPT_REVIEW_PASSED'
       or jsonb_typeof(v_job.review_receipt->'receipts') is distinct from 'array'
       or v_job.boas_approved is distinct from true
       or v_job.knoas_approved is distinct from true
       or v_job.channel_policy_id is null
       or v_job.channel_policy_revision is null
       or v_job.channel_policy_approval_psc_id is null
       or v_job.boas_revision is null
       or v_job.boas_psc_id is null
       or v_job.knoas_revision is null
       or v_job.knoas_psc_id is null
       or v_job.script_bundle->'policy_source_verification'->>'status' is distinct from 'VERIFIED'
       or v_job.script_bundle->'policy_source_verification'->>'channel_key' is distinct from v_job.channel_key
       or v_job.script_bundle->'policy_source_verification'->>'output_type' is distinct from v_job.output_type
       or v_job.script_bundle->'policy_source_verification'->>'production_intent' is distinct from v_job.production_intent
       or v_job.script_bundle->'policy_source_verification'->>'policy_id' is distinct from v_job.channel_policy_id::text
       or v_job.script_bundle->'policy_source_verification'->>'policy_revision' is distinct from v_job.channel_policy_revision
       or v_job.script_bundle->'policy_source_verification'->>'approval_psc_id' is distinct from v_job.channel_policy_approval_psc_id
       or v_job.script_bundle->'policy_source_verification'->>'boas_id' is distinct from v_job.boas_id
       or v_job.script_bundle->'policy_source_verification'->>'boas_revision' is distinct from v_job.boas_revision
       or v_job.script_bundle->'policy_source_verification'->>'boas_psc_id' is distinct from v_job.boas_psc_id
       or v_job.script_bundle->'policy_source_verification'->>'knoas_id' is distinct from v_job.knoas_id
       or v_job.script_bundle->'policy_source_verification'->>'knoas_revision' is distinct from v_job.knoas_revision
       or v_job.script_bundle->'policy_source_verification'->>'knoas_psc_id' is distinct from v_job.knoas_psc_id
       or jsonb_typeof(v_job.script_bundle->'policy_source_verification'->'evidence_psc_ids') is distinct from 'array'
       or not (v_job.script_bundle->'policy_source_verification'->'evidence_psc_ids' ? v_job.channel_policy_approval_psc_id)
       or not (v_job.script_bundle->'policy_source_verification'->'evidence_psc_ids' ? v_job.boas_psc_id)
       or not (v_job.script_bundle->'policy_source_verification'->'evidence_psc_ids' ? v_job.knoas_psc_id) then
      raise exception 'PCC_ANIMATION_HANDOFF_SOURCE_NOT_APPROVED';
    end if;
    if v_job.output_type in ('AD','REEL') and v_job.production_intent is null then
      raise exception 'PCC_ANIMATION_PRODUCTION_INTENT_REQUIRED';
    end if;

    v_packet := jsonb_build_object(
      'contract_version','PCC_PMF_ANIMATION_HANDOFF_V1',
      'request',jsonb_build_object(
        'request_id',v_job.job_id,'channel_key',v_job.channel_key,'output_type',v_job.output_type,
        'production_intent',v_job.production_intent,'title',v_job.title,'idea',v_job.idea
      ),
      'production_context',jsonb_build_object(
        'series_context',coalesce(v_job.request_payload->>'series_context',''),
        'context_notes',coalesce(v_job.request_payload->>'context_notes',''),
        'desired_ending_or_action',coalesce(v_job.request_payload->>'desired_ending_or_action','')
      ),
      'policy_source_verification',v_job.script_bundle->'policy_source_verification',
      'approved_policy',jsonb_build_object(
        'channel_policy_id',v_job.channel_policy_id,'channel_policy_revision',v_job.channel_policy_revision,
        'channel_policy_approval_psc_id',v_job.channel_policy_approval_psc_id,
        'boas_id',v_job.boas_id,'boas_revision',v_job.boas_revision,'boas_psc_id',v_job.boas_psc_id,
        'knoas_id',v_job.knoas_id,'knoas_revision',v_job.knoas_revision,'knoas_psc_id',v_job.knoas_psc_id
      ),
      'writer_master_and_segments',v_job.script_bundle,
      'reviewer_receipt',v_job.review_receipt,
      'existing_system_refs',jsonb_build_object(
        'pmf_job_ref',v_job.pmf_job_ref,'pve_job_ref',v_job.pve_job_ref,
        'png_job_ref',v_job.png_job_ref,'render_job_ref',v_job.render_job_ref
      ),
      'admission_snapshot',jsonb_build_object(
        'pmf_admission','NOT_ADMITTED','pmf_certification','NOT_CERTIFIED','render_dispatch','DISABLED'
      ),
      'state','HELD_PMF_ADMISSION_REQUIRED'
    );

    update public.pcc_animation_jobs
       set handoff_state='HELD_PMF_ADMISSION_REQUIRED',
           routing_state='BLOCKED',
           handoff_packet=v_packet,
           handoff_receipt=jsonb_build_object(
             'state','HELD_PMF_ADMISSION_REQUIRED',
             'reason','PMF production admission and certification are not passed',
             'render_dispatch','DISABLED',
             'source','PSC PMF 0.3.0 acceptance lock 2026-10-27'
           ),
           updated_at=now()
     where job_id=v_id
     returning * into v_job;

    return to_jsonb(v_job);
  elsif v_action = 'LIST' then
    return coalesce((
      select jsonb_agg(to_jsonb(j) order by j.created_at desc)
      from (
        select *
        from public.pcc_animation_jobs
        where v_can_review or requester_subject=p_subject
        order by created_at desc
        limit 50
      ) j
    ), '[]'::jsonb);
  elsif v_action = 'READ' then
    begin
      v_id := (p_payload->>'job_id')::uuid;
    exception when others then
      raise exception 'PCC_ANIMATION_JOB_ID_INVALID';
    end;

    select * into v_job
    from public.pcc_animation_jobs
    where job_id=v_id;

    if not found or (v_job.requester_subject <> p_subject and not v_can_review) then
      raise exception 'PCC_ANIMATION_JOB_NOT_FOUND';
    end if;

    return to_jsonb(v_job);
  else
    raise exception 'PCC_ANIMATION_ACTION_NOT_ALLOWED';
  end if;
end;
$function$;

revoke all on function public.pcc_animation_job_control_v1(text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.pcc_animation_job_control_v1(text,uuid,jsonb) to service_role;

commit;
