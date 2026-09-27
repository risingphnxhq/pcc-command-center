-- Apply with the Corporate migration process before enabling the ElevenLabs office renderer.
-- This RPC is service-role only. The browser never receives the receipt row.
create or replace function public.pcc_voice_office_session_validate(
  p_session_receipt_id uuid, p_persona_id text, p_provider_voice_ref text
)
returns jsonb
language sql stable security definer
set search_path = pg_catalog, corporate_voice
as $function$
  select jsonb_build_object(
    'persona_id', r.persona_id,
    'provider', r.provider,
    'provider_voice_ref', r.provider_voice_ref,
    'surface', r.surface,
    'session_state', r.session_state,
    'opened_at', r.opened_at
  )
  from corporate_voice.office_session_receipts r
  where r.session_receipt_id = p_session_receipt_id
    and r.persona_id = p_persona_id
    and r.provider = 'elevenlabs'
    and r.provider_voice_ref = p_provider_voice_ref
    and r.surface = 'PCC_OFFICE_PILOT'
    and r.session_state in ('PROVIDER_ACCEPTED', 'AUDIO_STARTED')
    and r.opened_at > now() - interval '10 minutes'
$function$;
revoke all on function public.pcc_voice_office_session_validate(uuid,text,text) from public, anon, authenticated;
grant execute on function public.pcc_voice_office_session_validate(uuid,text,text) to service_role;
