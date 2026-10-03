-- PCC governed System Stream registrar
-- Purpose: close the BOAS legacy-origin registration gap without assigning a BOAS root.
-- Authority: RPE-CSE-PSC-PHOENIX-OS-SYSTEM-BUILDING-PROTOCOL-V2-2026-10-02-001
-- Deployment state: SOURCE ARTIFACT ONLY until applied and physically read back.

create or replace function public.pcc_register_system_stream_v1(p_auth_subject uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pcc_institutional, pg_temp
as $$
declare
  v_actor_id text;
  v_stream text := nullif(trim(p_payload->>'system_stream_id'),'');
  v_code text := nullif(trim(p_payload->>'system_code'),'');
  v_name text := nullif(trim(p_payload->>'system_name'),'');
  v_class text := nullif(trim(p_payload->>'system_class'),'');
  v_canon text := nullif(trim(p_payload->>'canon_id'),'');
  v_concept text := nullif(trim(p_payload->>'concept_id'),'');
begin
  select actor_id into v_actor_id
  from pcc_institutional.auth_actor_bindings
  where auth_subject = p_auth_subject
    and status = 'ACTIVE'
    and (valid_until is null or valid_until > now())
  order by updated_at desc limit 1;

  if v_actor_id is distinct from 'RPE-MASON-HQ'
     or p_auth_subject <> 'ce00b026-246c-4167-a2c9-4f4d7e3c4a51'::uuid then
    return jsonb_build_object('status','DENIED','error','PRIME_CSE_AUTHORITY_REQUIRED');
  end if;

  if v_stream is null or v_code is null or v_name is null or v_class is null or v_canon is null then
    return jsonb_build_object('status','DENIED','error','SYSTEM_STREAM_REQUIRED_FIELDS_MISSING');
  end if;

  if exists (select 1 from public.origin_registry where system_stream_id=v_stream or system_code=v_code) then
    return jsonb_build_object('status','DENIED','error','SYSTEM_STREAM_ALREADY_REGISTERED');
  end if;

  if not exists (
    select 1 from public.phoenix_canon_records
    where psc_id=v_canon and canon_state not in ('SUPERSEDED','RETIRED')
  ) then
    return jsonb_build_object('status','DENIED','error','ORIGIN_CANON_NOT_CONTROLLING');
  end if;

  insert into public.origin_registry(
    origin_registry_id,system_stream_id,root_stream_id,concept_id,system_code,system_name,system_class,
    origin_source,origin_environment,origin_authority,created_through,foundational_builder,
    governance_owner,enterprise_owner,source_of_truth,origin_status,canon_id,canon_status,
    origin_notes,governance_notes,mutation_rule
  ) values (
    v_stream,v_stream,v_stream,v_concept,v_code,v_name,v_class,
    'OPENAI_RPE','RISING_PHOENIX_ENTERPRISES / PHOENIX_OS / OPENAI_BUILD_ENVIRONMENT',
    'RPE + PHOENIX OS + SUPER COMMAND',
    'OpenAI-assisted architecture, RPE-directed system design, Phoenix OS governance',
    'OpenAI + RPE','SUPER COMMAND','RPE','RPE Canon + Super Command + PCC Registry',
    'IDENTIFIED',v_canon,'CONTROLLING',
    'Legacy system stream registered through authenticated PCC BOAS reconciliation.',
    'BOAS root and version remain unassigned until separately reconciled and admitted.',
    'No mutation without Super Command authorization and PCC governed version binding'
  );

  return jsonb_build_object('status','REGISTERED','system_stream_id',v_stream,'system_code',v_code,'canon_id',v_canon,'boas_state','PENDING_ROOT_ASSIGNMENT');
end;
$$;

revoke all on function public.pcc_register_system_stream_v1(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.pcc_register_system_stream_v1(uuid,jsonb) to service_role;
