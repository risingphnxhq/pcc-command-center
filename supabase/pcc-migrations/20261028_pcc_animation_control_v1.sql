-- PCC Animation Control V1
-- PCC-only schema. Kept outside supabase/migrations because that directory
-- currently deploys to the Systems/PMF Supabase project.

begin;

create table if not exists public.pcc_animation_jobs (
  job_id uuid primary key default gen_random_uuid(),
  requester_subject uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  channel_key text not null check (channel_key ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$'),
  output_type text not null check (output_type in ('EPISODE','AD','CORPORATE_MARKETING','TV_SPOT','REEL','MICRO_DRAMA','NOVEL','BOOK_CHAPTER','BOOK_SCENE','OTHER')),
  title text not null check (length(trim(title)) between 1 and 200),
  idea text not null check (length(trim(idea)) between 1 and 12000),
  boas_id text check (boas_id is null or length(trim(boas_id)) between 1 and 160),
  knoas_id text check (knoas_id is null or length(trim(knoas_id)) between 1 and 160),
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
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requester_subject, idempotency_key)
);

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
       or coalesce(p_payload->>'output_type','') not in ('EPISODE','AD','CORPORATE_MARKETING','TV_SPOT','REEL','MICRO_DRAMA','NOVEL','BOOK_CHAPTER','BOOK_SCENE','OTHER')
       or jsonb_typeof(coalesce(p_payload->'request_payload','{}'::jsonb)) is distinct from 'object' then
      raise exception 'PCC_ANIMATION_REQUEST_INVALID';
    end if;

    insert into public.pcc_animation_jobs (
      requester_subject,idempotency_key,channel_key,output_type,title,idea,
      boas_id,knoas_id,request_payload
    ) values (
      p_subject,
      trim(p_payload->>'idempotency_key'),
      trim(p_payload->>'channel_key'),
      p_payload->>'output_type',
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
       or length(trim(coalesce(p_payload->>'boas_id',''))) not between 1 and 160
       or length(trim(coalesce(p_payload->>'knoas_id',''))) not between 1 and 160
       or coalesce(p_payload->>'status','') not in ('SCRIPT_REVIEW_PASSED','REVIEW') then
      raise exception 'PCC_ANIMATION_SCRIPT_RESULT_INVALID';
    end if;

    update public.pcc_animation_jobs
       set boas_id=trim(p_payload->>'boas_id'),
           knoas_id=trim(p_payload->>'knoas_id'),
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
