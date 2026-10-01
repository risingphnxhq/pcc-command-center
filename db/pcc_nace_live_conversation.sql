-- NACE is a PCC system intelligence, not a Corporate office or worker principal.
create table if not exists corporate_voice.nace_threads (
  thread_id uuid primary key default gen_random_uuid(),
  session_digest text not null check (length(session_digest)=64),
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists corporate_voice.nace_turns (
  turn_id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references corporate_voice.nace_threads(thread_id),
  speaker text not null check (speaker in ('SYSTEM_ENTRY','FOUNDER','NACE')),
  body text not null check (length(body) between 1 and 4000),
  source_class text not null default 'PCC_LIVE_CONVERSATION',
  created_at timestamptz not null default now(),
  turn_digest text not null
);
create index if not exists nace_turns_thread_time_idx on corporate_voice.nace_turns(thread_id,created_at);
alter table corporate_voice.nace_threads enable row level security;
alter table corporate_voice.nace_turns enable row level security;
revoke all on corporate_voice.nace_threads,corporate_voice.nace_turns from public,anon,authenticated;
grant select,insert,update on corporate_voice.nace_threads to service_role;
grant select,insert on corporate_voice.nace_turns to service_role;

create or replace function public.pcc_nace_thread_open(p_session_digest text)
returns uuid language plpgsql security definer set search_path=pg_catalog,corporate_voice as $$
declare v_id uuid;
begin
  if p_session_digest !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_SESSION_BINDING'; end if;
  insert into corporate_voice.nace_threads(session_digest) values(p_session_digest) returning thread_id into v_id;
  return v_id;
end; $$;

create or replace function public.pcc_nace_thread_history(p_thread_id uuid,p_session_digest text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,corporate_voice as $$
declare v_history jsonb;
begin
  if not exists(select 1 from corporate_voice.nace_threads where thread_id=p_thread_id and session_digest=p_session_digest)
    then raise exception 'THREAD_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('speaker',speaker,'body',body) order by created_at,turn_id),'[]'::jsonb)
    into v_history from (select turn_id,speaker,body,created_at from corporate_voice.nace_turns
      where thread_id=p_thread_id order by created_at desc,turn_id desc limit 12) recent;
  return v_history;
end; $$;

create or replace function public.pcc_nace_turn_pair_record(
  p_thread_id uuid,p_session_digest text,p_input_speaker text,p_input_body text,p_reply text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,corporate_voice,extensions as $$
declare v_input uuid;v_reply uuid;v_digest text;
begin
  if not exists(select 1 from corporate_voice.nace_threads where thread_id=p_thread_id and session_digest=p_session_digest)
    then raise exception 'THREAD_NOT_FOUND'; end if;
  if p_input_speaker not in ('SYSTEM_ENTRY','FOUNDER') or length(p_input_body) not between 1 and 4000
     or length(p_reply) not between 1 and 4000 then raise exception 'INVALID_TURN'; end if;
  v_input:=gen_random_uuid();v_reply:=gen_random_uuid();
  insert into corporate_voice.nace_turns(turn_id,thread_id,speaker,body,turn_digest)
    values(v_input,p_thread_id,p_input_speaker,p_input_body,
      encode(digest(v_input::text||p_thread_id::text||p_input_body,'sha256'),'hex'));
  v_digest:=encode(digest(v_reply::text||p_thread_id::text||p_reply,'sha256'),'hex');
  insert into corporate_voice.nace_turns(turn_id,thread_id,speaker,body,turn_digest)
    values(v_reply,p_thread_id,'NACE',p_reply,v_digest);
  update corporate_voice.nace_threads set updated_at=now() where thread_id=p_thread_id;
  return jsonb_build_object('thread_id',p_thread_id,'turn_id',v_reply,'receipt_digest',v_digest);
end; $$;

create or replace function public.pcc_nace_speech_turn(p_thread_id uuid,p_session_digest text,p_turn_id uuid)
returns text language plpgsql security definer set search_path=pg_catalog,corporate_voice as $$
declare v_text text;
begin
  select t.body into v_text from corporate_voice.nace_turns t
    join corporate_voice.nace_threads h on h.thread_id=t.thread_id
    where t.turn_id=p_turn_id and t.thread_id=p_thread_id and t.speaker='NACE' and h.session_digest=p_session_digest;
  if not found then raise exception 'NACE_TURN_NOT_FOUND'; end if;
  return v_text;
end; $$;

revoke all on function public.pcc_nace_thread_open(text) from public,anon,authenticated;
revoke all on function public.pcc_nace_thread_history(uuid,text) from public,anon,authenticated;
revoke all on function public.pcc_nace_turn_pair_record(uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function public.pcc_nace_speech_turn(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.pcc_nace_thread_open(text) to service_role;
grant execute on function public.pcc_nace_thread_history(uuid,text) to service_role;
grant execute on function public.pcc_nace_turn_pair_record(uuid,text,text,text,text) to service_role;
grant execute on function public.pcc_nace_speech_turn(uuid,text,uuid) to service_role;

-- Read only the six V1 office conversation records. A transcript is not a decision receipt.
create or replace function public.pcc_nace_recent_office_conversations()
returns jsonb language sql security definer set search_path=pg_catalog,corporate_voice as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'office_id',office_id,'session_receipt_id',session_receipt_id,
    'session_state',session_state,'speaker',speaker,'transcript',transcript,'recorded_at',recorded_at)
    order by recorded_at),'[]'::jsonb)
  from (select t.office_id,t.session_receipt_id,r.session_state,t.speaker,
      left(t.transcript,2000) transcript,t.recorded_at
    from corporate_voice.office_conversation_turns t
    join corporate_voice.office_session_receipts r on r.session_receipt_id=t.session_receipt_id
    where t.office_id in ('ALEXIS_VALE','MICHAEL_CARRINGTON','CHAD_G_PENNINGTON',
      'OLIVER_GRANT','PEGGY_WILSON','SYLVIA_SOMERS')
    order by t.recorded_at desc limit 24) recent;
$$;
revoke all on function public.pcc_nace_recent_office_conversations() from public,anon,authenticated;
grant execute on function public.pcc_nace_recent_office_conversations() to service_role;

-- Bounded Corporate Canon retrieval for NACE. No Systems project or cross-project read.
create or replace function public.pcc_nace_corporate_psc_search(p_terms text[])
returns jsonb language sql security definer set search_path=pg_catalog,corporate_psc as $$
  select coalesce(jsonb_agg(jsonb_build_object('record_id',record_id,'title',title,
    'status',status,'established_at',established_at,'excerpt',excerpt) order by score desc,established_at desc),'[]'::jsonb)
  from (select a.record_id,a.title,a.status,a.established_at,
      left(a.canonical_payload::text,3500) excerpt,
      (select count(*) from unnest(p_terms) term where length(term) between 4 and 40
        and (a.title ilike '%'||term||'%' or a.canonical_payload::text ilike '%'||term||'%')) score
    from corporate_psc.psc_a_records a
    where a.status in ('AUTHORITATIVE','CONTROLLING','CURRENT')
    order by score desc,a.established_at desc limit 8) found
  where score>0;
$$;
revoke all on function public.pcc_nace_corporate_psc_search(text[]) from public,anon,authenticated;
grant execute on function public.pcc_nace_corporate_psc_search(text[]) to service_role;
