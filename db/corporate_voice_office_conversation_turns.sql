-- Corporate-owned, client-observed V1 voice turns. These are meeting notes, not decisions or Canon.
create table if not exists corporate_voice.office_conversation_turns (
  turn_id uuid primary key default gen_random_uuid(),
  session_receipt_id uuid not null references corporate_voice.office_session_receipts(session_receipt_id),
  office_id text not null,
  provider_item_id text not null check (length(provider_item_id) between 1 and 128),
  speaker text not null check (speaker in ('FOUNDER','OFFICER')),
  transcript text not null check (length(transcript) between 1 and 10000),
  source text not null default 'REALTIME_CLIENT_EVENT',
  recorded_at timestamptz not null default now(),
  unique (session_receipt_id, provider_item_id, speaker)
);
create index if not exists office_conversation_turns_session_idx on corporate_voice.office_conversation_turns(session_receipt_id,recorded_at);
alter table corporate_voice.office_conversation_turns enable row level security;
revoke all on corporate_voice.office_conversation_turns from public, anon, authenticated;
grant select, insert, update on corporate_voice.office_conversation_turns to service_role;

create or replace function public.pcc_voice_office_turn_record(
  p_session_receipt_id uuid, p_provider_item_id text, p_speaker text, p_transcript text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, corporate_voice
as $$
declare v_session corporate_voice.office_session_receipts%rowtype;
begin
  select * into v_session from corporate_voice.office_session_receipts
  where session_receipt_id=p_session_receipt_id and surface='PCC_OFFICE_PILOT';
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if p_speaker not in ('FOUNDER','OFFICER') or length(p_provider_item_id) not between 1 and 128
     or length(trim(p_transcript)) not between 1 and 10000 then raise exception 'INVALID_TURN'; end if;
  insert into corporate_voice.office_conversation_turns
    (session_receipt_id,office_id,provider_item_id,speaker,transcript)
  values (p_session_receipt_id,v_session.office_id,p_provider_item_id,p_speaker,trim(p_transcript))
  on conflict (session_receipt_id,provider_item_id,speaker) do nothing;
  return jsonb_build_object('ok',true,'session_receipt_id',p_session_receipt_id,'provider_item_id',p_provider_item_id);
end;
$$;
revoke all on function public.pcc_voice_office_turn_record(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.pcc_voice_office_turn_record(uuid,text,text,text) to service_role;
