-- PCC-owned immutable BOAS/KNOAS channel policy registry.
-- Runs only on the PCC project. Policy rows are append-only; supersession and
-- revocation are represented explicitly, and only the authenticated Edge Function
-- service-role path may call the control RPC.

begin;

create table if not exists public.pcc_animation_channel_policies (
  policy_id uuid primary key default gen_random_uuid(),
  channel_key text not null check (channel_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  output_type text not null check (output_type in (
    'EPISODE','SERIES_EPISODE','ANIMATION','AD','REEL','MICRO_DRAMA','NOVEL',
    'BOOK_MANUSCRIPT','BOOK_CHAPTER','BOOK_SCENE','CORPORATE_MARKETING',
    'CORPORATE_JINGLE','TV_SPOT','TV_COMMERCIAL','SOCIAL_MEDIA_CAMPAIGN','OTHER'
  )),
  production_intent text not null check (production_intent in ('MARKETING','NARRATIVE')),
  policy_revision text not null check (length(trim(policy_revision)) between 1 and 160),
  approval_psc_id text not null check (length(trim(approval_psc_id)) between 3 and 160),
  boas_id text not null check (length(trim(boas_id)) between 3 and 160),
  boas_revision text not null check (length(trim(boas_revision)) between 1 and 160),
  boas_psc_id text not null check (length(trim(boas_psc_id)) between 3 and 160),
  knoas_id text not null check (length(trim(knoas_id)) between 3 and 160),
  knoas_revision text not null check (length(trim(knoas_revision)) between 1 and 160),
  knoas_psc_id text not null check (length(trim(knoas_psc_id)) between 3 and 160),
  channel_profile jsonb not null check (jsonb_typeof(channel_profile) = 'object'),
  output_spec jsonb not null check (jsonb_typeof(output_spec) = 'object'),
  supersedes_policy_id uuid references public.pcc_animation_channel_policies(policy_id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (channel_key, output_type, policy_revision),
  check (
    (output_type in ('EPISODE','SERIES_EPISODE','ANIMATION','MICRO_DRAMA','NOVEL','BOOK_MANUSCRIPT','BOOK_CHAPTER','BOOK_SCENE') and production_intent='NARRATIVE')
    or (output_type in ('CORPORATE_MARKETING','CORPORATE_JINGLE','TV_SPOT','TV_COMMERCIAL','SOCIAL_MEDIA_CAMPAIGN') and production_intent='MARKETING')
    or (output_type in ('AD','REEL','OTHER') and production_intent in ('MARKETING','NARRATIVE'))
  )
);

create table if not exists public.pcc_animation_channel_policy_revocations (
  policy_id uuid primary key references public.pcc_animation_channel_policies(policy_id) on delete restrict,
  revoked_by uuid not null references auth.users(id) on delete restrict,
  authority_psc_id text not null check (length(trim(authority_psc_id)) between 3 and 160),
  reason text not null check (length(trim(reason)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create or replace function public.pcc_deny_animation_policy_mutation_v1()
returns trigger
language plpgsql
set search_path = 'pg_catalog','public'
as $function$
begin
  raise exception 'PCC_ANIMATION_POLICY_RECORDS_ARE_APPEND_ONLY';
end;
$function$;

drop trigger if exists pcc_animation_channel_policies_append_only on public.pcc_animation_channel_policies;
create trigger pcc_animation_channel_policies_append_only
before update or delete on public.pcc_animation_channel_policies
for each row execute function public.pcc_deny_animation_policy_mutation_v1();

drop trigger if exists pcc_animation_channel_policy_revocations_append_only on public.pcc_animation_channel_policy_revocations;
create trigger pcc_animation_channel_policy_revocations_append_only
before update or delete on public.pcc_animation_channel_policy_revocations
for each row execute function public.pcc_deny_animation_policy_mutation_v1();

alter table public.pcc_animation_channel_policies enable row level security;
alter table public.pcc_animation_channel_policy_revocations enable row level security;
revoke all on table public.pcc_animation_channel_policies, public.pcc_animation_channel_policy_revocations from public, anon, authenticated;
grant all on table public.pcc_animation_channel_policies, public.pcc_animation_channel_policy_revocations to service_role;

create or replace function public.pcc_animation_channel_policy_control_v1(
  p_action text,
  p_subject uuid,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','public','auth','pg_temp'
as $function$
declare
  v_action text := upper(coalesce(p_action,''));
  v_channel text;
  v_output text;
  v_intent text;
  v_policy public.pcc_animation_channel_policies%rowtype;
  v_latest uuid;
  v_id uuid;
begin
  if p_subject is null then raise exception 'PCC_ANIMATION_SUBJECT_REQUIRED'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'PCC_ANIMATION_POLICY_PAYLOAD_INVALID'; end if;

  if v_action = 'REGISTER' then
    v_channel := trim(coalesce(p_payload->>'channel_key',''));
    v_output := upper(trim(coalesce(p_payload->>'output_type','')));
    v_intent := upper(trim(coalesce(p_payload->>'production_intent','')));
    if v_channel !~ '^[a-z][a-z0-9_]{1,63}$'
       or v_output not in ('EPISODE','SERIES_EPISODE','ANIMATION','AD','REEL','MICRO_DRAMA','NOVEL','BOOK_MANUSCRIPT','BOOK_CHAPTER','BOOK_SCENE','CORPORATE_MARKETING','CORPORATE_JINGLE','TV_SPOT','TV_COMMERCIAL','SOCIAL_MEDIA_CAMPAIGN','OTHER')
       or v_intent not in ('MARKETING','NARRATIVE')
       or length(trim(coalesce(p_payload->>'policy_revision',''))) not between 1 and 160
       or length(trim(coalesce(p_payload->>'approval_psc_id',''))) not between 3 and 160
       or length(trim(coalesce(p_payload->>'boas_id',''))) not between 3 and 160
       or length(trim(coalesce(p_payload->>'boas_revision',''))) not between 1 and 160
       or length(trim(coalesce(p_payload->>'boas_psc_id',''))) not between 3 and 160
       or length(trim(coalesce(p_payload->>'knoas_id',''))) not between 3 and 160
       or length(trim(coalesce(p_payload->>'knoas_revision',''))) not between 1 and 160
       or length(trim(coalesce(p_payload->>'knoas_psc_id',''))) not between 3 and 160
       or jsonb_typeof(p_payload->'channel_profile') is distinct from 'object'
       or jsonb_typeof(p_payload->'output_spec') is distinct from 'object'
       or octet_length((p_payload->'channel_profile')::text) > 40000
       or octet_length((p_payload->'output_spec')::text) > 40000 then
      raise exception 'PCC_ANIMATION_POLICY_REGISTRATION_INVALID';
    end if;
    if (v_output in ('EPISODE','SERIES_EPISODE','ANIMATION','MICRO_DRAMA','NOVEL','BOOK_MANUSCRIPT','BOOK_CHAPTER','BOOK_SCENE') and v_intent <> 'NARRATIVE')
       or (v_output in ('CORPORATE_MARKETING','CORPORATE_JINGLE','TV_SPOT','TV_COMMERCIAL','SOCIAL_MEDIA_CAMPAIGN') and v_intent <> 'MARKETING') then
      raise exception 'PCC_ANIMATION_POLICY_INTENT_CONFLICT';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_channel || ':' || v_output, 0));
    select policy_id into v_latest
      from public.pcc_animation_channel_policies p
     where p.channel_key=v_channel and p.output_type=v_output
       and not exists (
         select 1 from public.pcc_animation_channel_policies newer
         where newer.supersedes_policy_id=p.policy_id
       )
     order by created_at desc limit 1;
    if v_latest is null then
      if nullif(p_payload->>'supersedes_policy_id','') is not null then
        raise exception 'PCC_ANIMATION_POLICY_SUPERSESSION_CONFLICT';
      end if;
    elsif nullif(p_payload->>'supersedes_policy_id','') is distinct from v_latest::text then
      raise exception 'PCC_ANIMATION_POLICY_SUPERSESSION_REQUIRED';
    end if;

    insert into public.pcc_animation_channel_policies (
      channel_key,output_type,production_intent,policy_revision,approval_psc_id,
      boas_id,boas_revision,boas_psc_id,knoas_id,knoas_revision,knoas_psc_id,
      channel_profile,output_spec,supersedes_policy_id,created_by
    ) values (
      v_channel,v_output,v_intent,trim(p_payload->>'policy_revision'),trim(p_payload->>'approval_psc_id'),
      trim(p_payload->>'boas_id'),trim(p_payload->>'boas_revision'),trim(p_payload->>'boas_psc_id'),
      trim(p_payload->>'knoas_id'),trim(p_payload->>'knoas_revision'),trim(p_payload->>'knoas_psc_id'),
      p_payload->'channel_profile',p_payload->'output_spec',nullif(p_payload->>'supersedes_policy_id','')::uuid,p_subject
    ) returning * into v_policy;
    return to_jsonb(v_policy) || jsonb_build_object('approved',true,'revoked',false);

  elsif v_action = 'RESOLVE' then
    v_channel := trim(coalesce(p_payload->>'channel_key',''));
    v_output := upper(trim(coalesce(p_payload->>'output_type','')));
    v_intent := upper(trim(coalesce(p_payload->>'production_intent','')));
    if v_channel !~ '^[a-z][a-z0-9_]{1,63}$' or v_output = '' or v_intent not in ('MARKETING','NARRATIVE') then
      raise exception 'PCC_ANIMATION_POLICY_RESOLUTION_INVALID';
    end if;
    select p.* into v_policy
      from public.pcc_animation_channel_policies p
     where p.channel_key=v_channel and p.output_type=v_output and p.production_intent=v_intent
       and not exists (
         select 1 from public.pcc_animation_channel_policies newer
         where newer.supersedes_policy_id=p.policy_id
       )
     order by created_at desc limit 1;
    if not found then return jsonb_build_object('approved',false,'reason','REGISTERED_CHANNEL_POLICY_REQUIRED'); end if;
    if exists (select 1 from public.pcc_animation_channel_policy_revocations r where r.policy_id=v_policy.policy_id) then
      return jsonb_build_object('approved',false,'revoked',true,'reason','REGISTERED_CHANNEL_POLICY_REQUIRED');
    end if;
    return to_jsonb(v_policy) || jsonb_build_object('approved',true,'revoked',false);

  elsif v_action = 'REVOKE' then
    begin v_id := (p_payload->>'policy_id')::uuid;
    exception when others then raise exception 'PCC_ANIMATION_POLICY_ID_INVALID'; end;
    if length(trim(coalesce(p_payload->>'authority_psc_id',''))) not between 3 and 160
       or length(trim(coalesce(p_payload->>'reason',''))) not between 1 and 1000 then
      raise exception 'PCC_ANIMATION_POLICY_REVOCATION_INVALID';
    end if;
    insert into public.pcc_animation_channel_policy_revocations(policy_id,revoked_by,authority_psc_id,reason)
    values(v_id,p_subject,trim(p_payload->>'authority_psc_id'),trim(p_payload->>'reason'))
    on conflict(policy_id) do nothing;
    return jsonb_build_object('policy_id',v_id,'revoked',true);

  else
    raise exception 'PCC_ANIMATION_POLICY_ACTION_INVALID';
  end if;
end;
$function$;

revoke all on function public.pcc_animation_channel_policy_control_v1(text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.pcc_animation_channel_policy_control_v1(text,uuid,jsonb) to service_role;

commit;
