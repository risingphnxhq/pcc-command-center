CREATE OR REPLACE FUNCTION public.pcc_voice_bank_pending_office_candidates()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'corporate_voice'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'persona_id', c.persona_id,
    'candidate_id', c.candidate_id,
    'candidate_digest', c.candidate_digest,
    'state', c.state
  ) order by c.persona_id), '[]'::jsonb)
  from corporate_voice.voice_candidates c
  where c.provider = 'elevenlabs'
    and c.state = 'APPROVED'
    and c.persona_id <> 'NACE'
    and c.lineage->>'source_roster' = 'docs/corporate-elevenlabs-voice-roster-2026-09-26.json'
    and c.lineage->>'governing_psc_id' = 'PSC-A-CORPORATE-PCC-AI-STAFF-VOICE-BANK-CASTING-PURPOSE-2026-09-25-001'
    and exists (select 1 from corporate_voice.voice_approvals a
      where a.candidate_id=c.candidate_id and a.candidate_digest=c.candidate_digest and a.decision='APPROVE')
    and exists (select 1 from corporate_voice.surface_voice_bindings b
      where b.candidate_id=c.candidate_id and b.candidate_digest=c.candidate_digest and b.surface='PCC_BOARD_ROOM' and b.state='ACTIVE')
    and exists (select 1 from corporate_voice.surface_voice_bindings b
      where b.candidate_id=c.candidate_id and b.candidate_digest=c.candidate_digest and b.surface='PCC_WAR_ROOM' and b.state='ACTIVE');
$function$
;
revoke all on function public.pcc_voice_bank_pending_office_candidates() from public, anon, authenticated;
grant execute on function public.pcc_voice_bank_pending_office_candidates() to service_role;
