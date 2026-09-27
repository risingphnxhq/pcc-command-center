-- A room-specific identity lane. The existing PCC_OFFICE_PILOT identity remains untouched.
create table if not exists corporate_voice.surface_voice_bindings (
  binding_id uuid primary key default gen_random_uuid(),
  persona_id text not null,
  surface text not null check (surface in ('PCC_BOARD_ROOM','PCC_WAR_ROOM')),
  candidate_id uuid not null references corporate_voice.voice_candidates(candidate_id),
  candidate_digest text not null check (candidate_digest ~ '^[0-9a-f]{64}$'),
  approval_id uuid not null references corporate_voice.voice_approvals(approval_id),
  state text not null check (state in ('ACTIVE','REVOKED')),
  activated_by text not null,
  activated_at timestamptz not null default now(),
  revoked_at timestamptz,
  governing_psc_id text not null,
  unique (persona_id,surface)
);
alter table corporate_voice.surface_voice_bindings enable row level security;
revoke all on corporate_voice.surface_voice_bindings from public, anon, authenticated;
grant select, insert, update on corporate_voice.surface_voice_bindings to service_role;

create or replace function public.pcc_voice_bank_resolve_surface(p_persona_id text,p_surface text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,corporate_voice as $body$
declare v_binding corporate_voice.surface_voice_bindings;
        v_candidate corporate_voice.voice_candidates;
        v_approval corporate_voice.voice_approvals;
begin
  if p_surface not in ('PCC_BOARD_ROOM','PCC_WAR_ROOM') then
    raise exception 'SURFACE_NOT_AUTHORIZED';
  end if;
  select * into v_binding from corporate_voice.surface_voice_bindings
  where persona_id=p_persona_id and surface=p_surface and state='ACTIVE';
  if not found then raise exception 'VOICE_IDENTITY_NOT_ACTIVE'; end if;
  select * into v_candidate from corporate_voice.voice_candidates
  where candidate_id=v_binding.candidate_id and candidate_digest=v_binding.candidate_digest
    and state in ('APPROVED','ACTIVE');
  if not found then raise exception 'CANDIDATE_INTEGRITY_FAILURE'; end if;
  select * into v_approval from corporate_voice.voice_approvals
  where approval_id=v_binding.approval_id and candidate_id=v_candidate.candidate_id
    and candidate_digest=v_candidate.candidate_digest and decision='APPROVE';
  if not found then raise exception 'APPROVAL_INTEGRITY_FAILURE'; end if;
  return jsonb_build_object('persona_id',v_binding.persona_id,'surface',v_binding.surface,
    'binding_id',v_binding.binding_id,'candidate_id',v_candidate.candidate_id,
    'candidate_digest',v_candidate.candidate_digest,'provider',v_candidate.provider,
    'provider_voice_ref',v_candidate.provider_voice_ref,'provider_model',v_candidate.provider_model,
    'approval_id',v_approval.approval_id,'governing_psc_id',v_binding.governing_psc_id);
end;
$body$;
revoke all on function public.pcc_voice_bank_resolve_surface(text,text) from public, anon, authenticated;
grant execute on function public.pcc_voice_bank_resolve_surface(text,text) to service_role;
