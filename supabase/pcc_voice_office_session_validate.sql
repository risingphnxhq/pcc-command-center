-- Apply with the Corporate migration process before enabling the ElevenLabs office renderer.
-- This RPC is service-role only. The browser never receives the receipt row.
create table if not exists corporate_voice.office_voice_render_budget (
  session_receipt_id uuid primary key references corporate_voice.office_session_receipts(session_receipt_id),
  turn_count integer not null default 0,
  total_characters integer not null default 0
);
revoke all on corporate_voice.office_voice_render_budget from public, anon, authenticated;

create or replace function public.pcc_voice_office_session_reserve_render(
  p_session_receipt_id uuid, p_persona_id text, p_provider_voice_ref text, p_characters integer
)
returns jsonb
language plpgsql volatile security definer
set search_path = pg_catalog, corporate_voice
as $function$
declare v_receipt corporate_voice.office_session_receipts%rowtype;
begin
  if p_characters < 1 or p_characters > 1800 then return null; end if;
  select * into v_receipt from corporate_voice.office_session_receipts r
    where r.session_receipt_id = p_session_receipt_id
      and r.persona_id = p_persona_id and r.provider = 'elevenlabs'
      and r.provider_voice_ref = p_provider_voice_ref and r.surface = 'PCC_OFFICE_PILOT'
      and r.session_state in ('PROVIDER_ACCEPTED', 'AUDIO_STARTED')
      and r.opened_at > now() - interval '10 minutes';
  if not found then return null; end if;
  insert into corporate_voice.office_voice_render_budget(session_receipt_id,turn_count,total_characters)
    values(p_session_receipt_id,1,p_characters)
    on conflict(session_receipt_id) do update
      set turn_count = corporate_voice.office_voice_render_budget.turn_count + 1,
          total_characters = corporate_voice.office_voice_render_budget.total_characters + p_characters
      where corporate_voice.office_voice_render_budget.turn_count < 40
        and corporate_voice.office_voice_render_budget.total_characters + p_characters <= 20000;
  if not found then return null; end if;
  return jsonb_build_object('persona_id',v_receipt.persona_id,'provider',v_receipt.provider,
    'provider_voice_ref',v_receipt.provider_voice_ref,'surface',v_receipt.surface,
    'session_state',v_receipt.session_state,'opened_at',v_receipt.opened_at);
end
$function$;
revoke all on function public.pcc_voice_office_session_reserve_render(uuid,text,text,integer) from public, anon, authenticated;
grant execute on function public.pcc_voice_office_session_reserve_render(uuid,text,text,integer) to service_role;
