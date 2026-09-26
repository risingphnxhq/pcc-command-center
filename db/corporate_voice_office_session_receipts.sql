create table if not exists corporate_voice.office_session_receipts (
  session_receipt_id uuid primary key default gen_random_uuid(),
  persona_id text not null,
  voice_identity_id uuid not null references corporate_voice.voice_identities(voice_identity_id),
  candidate_id uuid not null references corporate_voice.voice_candidates(candidate_id),
  surface text not null,
  office_id text not null,
  provider text not null,
  provider_voice_ref text not null,
  provider_model text not null,
  session_state text not null check (session_state in ('PROVIDER_ACCEPTED','AUDIO_STARTED','ENDED','FAILED')),
  opened_by text not null,
  opened_at timestamptz not null default now(),
  first_audio_ms integer,
  client_evidence jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  receipt_digest text not null
);

alter table corporate_voice.office_session_receipts enable row level security;
create index if not exists office_session_receipts_voice_identity_idx on corporate_voice.office_session_receipts(voice_identity_id);
create index if not exists office_session_receipts_candidate_idx on corporate_voice.office_session_receipts(candidate_id);
create index if not exists office_session_receipts_persona_time_idx on corporate_voice.office_session_receipts(persona_id,opened_at desc);
revoke all on corporate_voice.office_session_receipts from public, anon, authenticated;
grant select, insert, update on corporate_voice.office_session_receipts to service_role;

create or replace function public.pcc_voice_office_session_open(
  p_persona_id text,
  p_surface text,
  p_office_id text,
  p_opened_by text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, corporate_voice, extensions
as $$
declare
  v_identity corporate_voice.voice_identities%rowtype;
  v_candidate corporate_voice.voice_candidates%rowtype;
  v_id uuid := gen_random_uuid();
  v_opened timestamptz := now();
  v_digest text;
begin
  select * into strict v_identity
  from corporate_voice.voice_identities
  where persona_id = p_persona_id and activation_state = 'ACTIVE';

  if not (p_surface = any(v_identity.allowed_surfaces)) then
    raise exception 'SURFACE_NOT_AUTHORIZED';
  end if;

  if p_office_id <> p_persona_id then
    raise exception 'OFFICE_PERSONA_MISMATCH';
  end if;

  select * into strict v_candidate
  from corporate_voice.voice_candidates
  where candidate_id = v_identity.active_candidate_id
    and candidate_digest = v_identity.active_candidate_digest
    and state = 'ACTIVE';

  v_digest := encode(digest(concat_ws('|',v_id::text,p_persona_id,p_surface,p_office_id,
    v_candidate.candidate_id::text,v_candidate.candidate_digest,v_opened::text),'sha256'),'hex');

  insert into corporate_voice.office_session_receipts(
    session_receipt_id,persona_id,voice_identity_id,candidate_id,surface,office_id,
    provider,provider_voice_ref,provider_model,session_state,opened_by,opened_at,receipt_digest
  ) values (
    v_id,p_persona_id,v_identity.voice_identity_id,v_candidate.candidate_id,p_surface,p_office_id,
    v_candidate.provider,v_candidate.provider_voice_ref,v_candidate.provider_model,
    'PROVIDER_ACCEPTED',p_opened_by,v_opened,v_digest
  );

  return jsonb_build_object(
    'session_receipt_id',v_id,
    'receipt_digest',v_digest,
    'voice_identity_id',v_identity.voice_identity_id,
    'candidate_id',v_candidate.candidate_id,
    'candidate_digest',v_candidate.candidate_digest,
    'provider',v_candidate.provider,
    'provider_voice_ref',v_candidate.provider_voice_ref,
    'provider_model',v_candidate.provider_model,
    'surface',p_surface,
    'office_id',p_office_id,
    'session_state','PROVIDER_ACCEPTED',
    'opened_at',v_opened
  );
exception
  when no_data_found then raise exception 'VOICE_IDENTITY_NOT_ACTIVE';
end;
$$;

create or replace function public.pcc_voice_office_session_update(
  p_session_receipt_id uuid,
  p_session_state text,
  p_first_audio_ms integer,
  p_client_evidence jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, corporate_voice, extensions
as $$
declare
  v_row corporate_voice.office_session_receipts%rowtype;
begin
  if p_session_state not in ('AUDIO_STARTED','ENDED','FAILED') then
    raise exception 'INVALID_SESSION_STATE';
  end if;
  if p_first_audio_ms is not null and (p_first_audio_ms < 0 or p_first_audio_ms > 120000) then
    raise exception 'INVALID_FIRST_AUDIO_MS';
  end if;

  update corporate_voice.office_session_receipts
  set session_state = p_session_state,
      first_audio_ms = coalesce(p_first_audio_ms,first_audio_ms),
      client_evidence = coalesce(p_client_evidence,'{}'::jsonb),
      completed_at = case when p_session_state in ('ENDED','FAILED') then now() else completed_at end
  where session_receipt_id = p_session_receipt_id
  returning * into strict v_row;

  return jsonb_build_object(
    'session_receipt_id',v_row.session_receipt_id,
    'session_state',v_row.session_state,
    'first_audio_ms',v_row.first_audio_ms,
    'completed_at',v_row.completed_at,
    'receipt_digest',v_row.receipt_digest
  );
exception
  when no_data_found then raise exception 'SESSION_RECEIPT_NOT_FOUND';
end;
$$;

revoke all on function public.pcc_voice_office_session_open(text,text,text,text) from public, anon, authenticated;
revoke all on function public.pcc_voice_office_session_update(uuid,text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.pcc_voice_office_session_open(text,text,text,text) to service_role;
grant execute on function public.pcc_voice_office_session_update(uuid,text,integer,jsonb) to service_role;
