-- Atomically bind PCC animation jobs to the exact channel-policy snapshot
-- already verified by the signed PCC-to-PMF source resolver.
-- This closes revocation/supersession races at job creation, script claim/save,
-- and held PMF handoff staging. It does not enable rendering or publishing.

begin;

create or replace function public.pcc_animation_job_policy_guard_v1()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog','public','pg_temp'
as $function$
declare
  v_snapshot jsonb;
  v_policy public.pcc_animation_channel_policies%rowtype;
  v_expected jsonb;
  v_current boolean;
begin
  v_snapshot := new.request_payload->'approved_channel_policy_snapshot';
  if jsonb_typeof(v_snapshot) is distinct from 'object' then
    raise exception 'PCC_ANIMATION_POLICY_SNAPSHOT_REQUIRED';
  end if;

  if tg_op = 'INSERT' then
    begin
      select * into v_policy
        from public.pcc_animation_channel_policies p
       where p.policy_id = (v_snapshot->>'policy_id')::uuid;
    exception when others then
      raise exception 'PCC_ANIMATION_POLICY_SNAPSHOT_INVALID';
    end;
    if not found then
      raise exception 'PCC_ANIMATION_POLICY_SNAPSHOT_INVALID';
    end if;

    v_expected := jsonb_build_object(
      'channel_key',v_policy.channel_key,
      'output_type',v_policy.output_type,
      'production_intent',v_policy.production_intent,
      'policy_revision',v_policy.policy_revision,
      'approval_psc_id',v_policy.approval_psc_id,
      'boas_id',v_policy.boas_id,
      'boas_revision',v_policy.boas_revision,
      'boas_psc_id',v_policy.boas_psc_id,
      'knoas_id',v_policy.knoas_id,
      'knoas_revision',v_policy.knoas_revision,
      'knoas_psc_id',v_policy.knoas_psc_id,
      'policy_id',v_policy.policy_id,
      'channel_profile',v_policy.channel_profile,
      'output_spec',v_policy.output_spec
    );
    if v_snapshot <> v_expected
       or new.channel_key is distinct from v_policy.channel_key
       or new.output_type is distinct from v_policy.output_type
       or new.production_intent is distinct from v_policy.production_intent then
      raise exception 'PCC_ANIMATION_POLICY_SNAPSHOT_MISMATCH';
    end if;

    select not exists (
      select 1
        from public.pcc_animation_channel_policies newer
       where newer.supersedes_policy_id = v_policy.policy_id
    ) and not exists (
      select 1
        from public.pcc_animation_channel_policy_revocations revoked
       where revoked.policy_id = v_policy.policy_id
    ) into v_current;
    if not v_current then
      raise exception 'PCC_ANIMATION_POLICY_NOT_CURRENT';
    end if;

    new.channel_policy_id := v_policy.policy_id;
    new.channel_policy_revision := v_policy.policy_revision;
    new.channel_policy_approval_psc_id := v_policy.approval_psc_id;
    new.boas_id := v_policy.boas_id;
    new.boas_revision := v_policy.boas_revision;
    new.boas_psc_id := v_policy.boas_psc_id;
    new.knoas_id := v_policy.knoas_id;
    new.knoas_revision := v_policy.knoas_revision;
    new.knoas_psc_id := v_policy.knoas_psc_id;
  else
    if new.request_payload->'approved_channel_policy_snapshot'
       is distinct from old.request_payload->'approved_channel_policy_snapshot' then
      raise exception 'PCC_ANIMATION_POLICY_SNAPSHOT_IMMUTABLE';
    end if;
    if new.channel_policy_id is distinct from (v_snapshot->>'policy_id')::uuid
       or new.channel_policy_revision is distinct from v_snapshot->>'policy_revision'
       or new.channel_policy_approval_psc_id is distinct from v_snapshot->>'approval_psc_id'
       or new.channel_key is distinct from v_snapshot->>'channel_key'
       or new.output_type is distinct from v_snapshot->>'output_type'
       or new.production_intent is distinct from v_snapshot->>'production_intent'
       or new.boas_id is distinct from v_snapshot->>'boas_id'
       or new.boas_revision is distinct from v_snapshot->>'boas_revision'
       or new.boas_psc_id is distinct from v_snapshot->>'boas_psc_id'
       or new.knoas_id is distinct from v_snapshot->>'knoas_id'
       or new.knoas_revision is distinct from v_snapshot->>'knoas_revision'
       or new.knoas_psc_id is distinct from v_snapshot->>'knoas_psc_id' then
      raise exception 'PCC_ANIMATION_POLICY_SNAPSHOT_MISMATCH';
    end if;

    if (old.status is distinct from 'SCRIPTING' and new.status = 'SCRIPTING')
       or (old.script_bundle is null and new.script_bundle is not null)
       or (old.handoff_packet is null and new.handoff_packet is not null) then
      select * into v_policy
        from public.pcc_animation_channel_policies p
       where p.policy_id = (v_snapshot->>'policy_id')::uuid;
      if not found then
        raise exception 'PCC_ANIMATION_POLICY_SNAPSHOT_INVALID';
      end if;
      v_expected := jsonb_build_object(
        'channel_key',v_policy.channel_key,
        'output_type',v_policy.output_type,
        'production_intent',v_policy.production_intent,
        'policy_revision',v_policy.policy_revision,
        'approval_psc_id',v_policy.approval_psc_id,
        'boas_id',v_policy.boas_id,
        'boas_revision',v_policy.boas_revision,
        'boas_psc_id',v_policy.boas_psc_id,
        'knoas_id',v_policy.knoas_id,
        'knoas_revision',v_policy.knoas_revision,
        'knoas_psc_id',v_policy.knoas_psc_id,
        'policy_id',v_policy.policy_id,
        'channel_profile',v_policy.channel_profile,
        'output_spec',v_policy.output_spec
      );
      select v_snapshot = v_expected
        and not exists (
          select 1 from public.pcc_animation_channel_policies newer
           where newer.supersedes_policy_id = v_policy.policy_id
        )
        and not exists (
          select 1 from public.pcc_animation_channel_policy_revocations revoked
           where revoked.policy_id = v_policy.policy_id
        ) into v_current;
      if not v_current then
        raise exception 'PCC_ANIMATION_POLICY_NOT_CURRENT';
      end if;
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.pcc_animation_job_policy_guard_v1() from public, anon, authenticated;

drop trigger if exists pcc_animation_job_policy_guard_v1 on public.pcc_animation_jobs;
create trigger pcc_animation_job_policy_guard_v1
before insert or update on public.pcc_animation_jobs
for each row execute function public.pcc_animation_job_policy_guard_v1();

commit;
