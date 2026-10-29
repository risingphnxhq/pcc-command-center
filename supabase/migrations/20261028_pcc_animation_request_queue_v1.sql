-- PCC narrative and animation intake queue v1
-- Apply only to RPE Corporate HQ Canon (ttkceizmjeckrorhkhfr), the PCC project.
-- PMF/PVE/PNG and the trial-scoped animation runtime live in a separate project.
-- This table stores intake only; every request remains held pending a secure bridge.
-- This is an intake/backlog boundary only. It does not dispatch to PMF or RunPod.
-- Every new request remains HELD_CONFIGURATION_REQUIRED until channel, BOAS/KNOAS,
-- PMF admission, QA, and compute controls are wired and verified.

create table if not exists pcc_hq.animation_intake_requests (
  -- BOOK_MANUSCRIPT supports saga/book work; channel_key can be the owning IP/brand key.
  request_id uuid primary key default gen_random_uuid(),
  request_type text not null check (request_type in ('BOOK_MANUSCRIPT','ANIMATION','AD','REEL','MICRO_DRAMA','SERIES_EPISODE','CORPORATE_JINGLE','TV_COMMERCIAL','SOCIAL_MEDIA_CAMPAIGN')),
  production_intent text check (
    (request_type in ('AD','REEL') and production_intent is not null and production_intent in ('MARKETING','NARRATIVE')) or
    (request_type not in ('AD','REEL') and production_intent is null)
  ),
  channel_key text not null check (channel_key ~ '^[a-z0-9][a-z0-9._-]{1,79}$'),
  title text not null check (length(trim(title)) between 1 and 160),
  series_or_campaign text check (series_or_campaign is null or length(trim(series_or_campaign)) between 1 and 160),
  objective text check (objective is null or length(trim(objective)) between 1 and 1000),
  creative_brief text not null check (length(trim(creative_brief)) between 1 and 12000),
  status text not null default 'HELD_CONFIGURATION_REQUIRED'
    check (status in ('HELD_CONFIGURATION_REQUIRED','CANCELLED')),
  requested_by uuid not null,
  provenance jsonb not null default '{}'::jsonb
    check (jsonb_typeof(provenance) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create index if not exists pcc_animation_requests_owner_created_idx
  on pcc_hq.animation_intake_requests (requested_by, created_at desc);

alter table pcc_hq.animation_intake_requests enable row level security;
revoke all on pcc_hq.animation_intake_requests from public, anon, authenticated;
grant select, insert, update on pcc_hq.animation_intake_requests to service_role;

create or replace function public.pcc_animation_queue_v1(
  p_auth_subject uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = 'pcc_hq','public','pg_temp'
as $function$
declare
  v_action text := upper(coalesce(p_action,''));
  v_type text := upper(nullif(trim(coalesce(p_payload->>'request_type','')),''));
  v_channel text := lower(nullif(trim(coalesce(p_payload->>'channel_key','')),''));
  v_intent text := upper(nullif(trim(coalesce(p_payload->>'production_intent','')),''));
  v_title text := nullif(trim(coalesce(p_payload->>'title','')),'');
  v_series text := nullif(trim(coalesce(p_payload->>'series_or_campaign','')),'');
  v_objective text := nullif(trim(coalesce(p_payload->>'objective','')),'');
  v_brief text := nullif(trim(coalesce(p_payload->>'creative_brief','')),'');
  v_id uuid;
  v_row record;
  v_requests jsonb;
  v_pmf record;
  v_lock record;
begin
  if p_auth_subject is null then
    return jsonb_build_object('status','DENIED','error','AUTHENTICATED_SUBJECT_REQUIRED');
  end if;

  if v_action = 'READINESS' then
    -- PCC and PMF/PVE/PNG are in separate Supabase projects. Do not query the
    -- PMF project's private schemas from PCC or imply cross-project readiness.
    return jsonb_build_object(
      'status','OK',
      'execution_lock',jsonb_build_object('readback','UNVERIFIED'),
      'pmf_registry',jsonb_build_object('version','0.3.0','admission','NOT_ADMITTED','certification','NOT_CERTIFIED'),
      'channel_profiles','NOT_CONNECTED',
      'scriptwriter_runtime','NOT_CONNECTED',
      'runpod_worker','NOT_CONNECTED',
      'qa_enforcement','NOT_INTEGRATED',
      'pcc_queue','PCC_QUEUE_API_DEPLOYMENT_PENDING',
      'pmf_animation_runtime','EXISTS_TRIAL_SCOPED_IN_SEPARATE_PROJECT',
      'voice_and_png_tables','EXIST_IN_SEPARATE_PMF_PROJECT',
      'cross_project_bridge','NOT_CONNECTED',
      'request_execution','HELD'
    );
  end if;

  if v_action = 'CREATE' then
    if v_type not in ('BOOK_MANUSCRIPT','ANIMATION','AD','REEL','MICRO_DRAMA','SERIES_EPISODE','CORPORATE_JINGLE','TV_COMMERCIAL','SOCIAL_MEDIA_CAMPAIGN') or
       (v_type in ('AD','REEL') and (v_intent is null or v_intent not in ('MARKETING','NARRATIVE'))) or
       (v_type not in ('AD','REEL') and v_intent is not null) or v_channel is null or
       v_channel !~ '^[a-z0-9][a-z0-9._-]{1,79}$' or
       v_title is null or length(v_title) > 160 or
       (v_series is not null and length(v_series) > 160) or
       (v_objective is not null and length(v_objective) > 1000) or
       v_brief is null or length(v_brief) > 12000 then
      return jsonb_build_object('status','INVALID','error','ANIMATION_REQUEST_FIELDS_INVALID');
    end if;

    insert into pcc_hq.animation_intake_requests
      (request_type,production_intent,channel_key,title,series_or_campaign,objective,creative_brief,requested_by,provenance)
    values
      (v_type,v_intent,v_channel,v_title,v_series,v_objective,v_brief,p_auth_subject,
       jsonb_build_object(
         'intake','PCC',
         'boas_knoas_binding','PENDING',
         'scriptwriter','NOT_DISPATCHED',
         'pmf_runtime','NOT_ADMITTED',
         'render_worker','NOT_CONNECTED',
         'qa','NOT_RUN',
         'distribution','NOT_AUTHORIZED',
         'execution_lock',jsonb_build_object(
           'lock_id','PMF-ANIMATION-EXECUTION-LOCK-001',
           'psc_id','PMF-FOUNDER-PSC-ANIMATION-EXECUTION-LOCK-2026-10-23-001',
           'revision',1,
           'sha256','877d6469335ba45261c2c6cef24162e5093d84a0bdf9292813587bcf649a495c'
         )
       ))
    returning request_id,status,created_at into v_row;

    return jsonb_build_object(
      'status','CREATED',
      'request',jsonb_build_object(
        'request_id',v_row.request_id,
        'request_type',v_type,
        'production_intent',v_intent,
        'channel_key',v_channel,
        'title',v_title,
        'state',v_row.status,
        'created_at',v_row.created_at,
        'next_action','CONFIGURE_CHANNEL_BOAS_KNOAS_AND_ADMIT_PMF'
      )
    );
  elsif v_action = 'LIST' then
    select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb)
      into v_requests
    from (
      select request_id,request_type,production_intent,channel_key,title,series_or_campaign,objective,status,created_at,updated_at
      from pcc_hq.animation_intake_requests
      where requested_by=p_auth_subject
      order by created_at desc
      limit 50
    ) q;
    return jsonb_build_object('status','OK','requests',v_requests);
  elsif v_action = 'READ' or v_action = 'CANCEL' then
    begin
      v_id := nullif(trim(coalesce(p_payload->>'request_id','')),'')::uuid;
    exception when invalid_text_representation then
      return jsonb_build_object('status','INVALID','error','ANIMATION_REQUEST_ID_INVALID');
    end;
    if v_id is null then
      return jsonb_build_object('status','INVALID','error','ANIMATION_REQUEST_ID_REQUIRED');
    end if;

    if v_action = 'CANCEL' then
      update pcc_hq.animation_intake_requests
      set status='CANCELLED',cancelled_at=now(),updated_at=now()
      where request_id=v_id and requested_by=p_auth_subject
        and status='HELD_CONFIGURATION_REQUIRED'
      returning request_id,status into v_row;
      if not found then
        return jsonb_build_object('status','NOT_FOUND_OR_NOT_CANCELLABLE');
      end if;
      return jsonb_build_object('status','CANCELLED','request_id',v_row.request_id);
    end if;

    select request_id,request_type,production_intent,channel_key,title,series_or_campaign,objective,creative_brief,status,
           provenance,created_at,updated_at
      into v_row
    from pcc_hq.animation_intake_requests
    where request_id=v_id and requested_by=p_auth_subject;
    if not found then return jsonb_build_object('status','NOT_FOUND'); end if;
    return jsonb_build_object('status','OK','request',to_jsonb(v_row));
  end if;

  return jsonb_build_object('status','DENIED','error','ANIMATION_QUEUE_ACTION_NOT_PERMITTED');
end;
$function$;

revoke execute on function public.pcc_animation_queue_v1(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.pcc_animation_queue_v1(uuid,text,jsonb) to service_role;

comment on table pcc_hq.animation_intake_requests is
'PCC-authenticated animation intake queue. Requests remain held until channel-specific BOAS/KNOAS, PMF admission, QA and approved compute execution are implemented. No RunPod dispatch is performed.';
