create table if not exists corporate_voice.office_voice_approvals (
  approval_id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references corporate_voice.voice_candidates(candidate_id),
  candidate_digest text not null check (candidate_digest ~ '^[0-9a-f]{64}$'),
  approver_actor_id text not null check (approver_actor_id='PHOENIX_KING'),
  authority_evidence text not null check (authority_evidence='PCC_GATE_REAUTH_BOUND_TO_CANDIDATE_DIGEST'),
  governing_psc_id text not null,
  approved_at timestamptz not null default now(),
  unique(candidate_id,candidate_digest)
);
alter table corporate_voice.office_voice_approvals enable row level security;
revoke all on corporate_voice.office_voice_approvals from public, anon, authenticated;
CREATE OR REPLACE FUNCTION public.pcc_voice_bank_approve_office_candidate(p_candidate_id uuid, p_candidate_digest text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'corporate_voice', 'extensions'
AS $function$
declare v_candidate corporate_voice.voice_candidates;
        v_result jsonb;
begin
 select * into v_candidate from corporate_voice.voice_candidates
 where candidate_id=p_candidate_id and candidate_digest=p_candidate_digest for update;
 if not found or v_candidate.provider<>'elevenlabs' or v_candidate.persona_id='NACE'
    or v_candidate.state<>'APPROVED'
    or v_candidate.lineage->>'source_roster'<>'docs/corporate-elevenlabs-voice-roster-2026-09-26.json'
    then raise exception 'OFFICE_CANDIDATE_NOT_ELIGIBLE'; end if;
 if not exists(select 1 from corporate_voice.voice_approvals a
   where a.candidate_id=p_candidate_id and a.candidate_digest=p_candidate_digest
     and a.decision='APPROVE' and a.approver_actor_id='PHOENIX_KING'
     and a.authority_evidence='PCC_GATE_REAUTH_BOUND_TO_CANDIDATE_DIGEST')
   then raise exception 'FOUNDER_ROOM_APPROVAL_MISSING'; end if;
 if (select count(distinct b.surface) from corporate_voice.surface_voice_bindings b
   where b.candidate_id=p_candidate_id and b.candidate_digest=p_candidate_digest
     and b.state='ACTIVE' and b.surface in ('PCC_BOARD_ROOM','PCC_WAR_ROOM'))<>2
   then raise exception 'ROOM_BINDINGS_MISSING'; end if;
 insert into corporate_voice.office_voice_approvals
 (candidate_id,candidate_digest,approver_actor_id,authority_evidence,governing_psc_id)
 values(p_candidate_id,p_candidate_digest,'PHOENIX_KING',
 'PCC_GATE_REAUTH_BOUND_TO_CANDIDATE_DIGEST',
 'PSC-A-CORPORATE-PCC-AI-STAFF-VOICE-BANK-CASTING-PURPOSE-2026-09-25-001')
 on conflict (candidate_id,candidate_digest) do nothing;
 v_result:=public.pcc_voice_bank_decide_and_activate(
   p_candidate_id,p_candidate_digest,'APPROVE','PHOENIX_KING',
   'PCC_GATE_REAUTH_BOUND_TO_CANDIDATE_DIGEST',
   jsonb_build_object('candidate_kind','REFERENCE_VOICE','production_limit','PCC_OFFICE_PILOT'),
   array['PCC_OFFICE_PILOT']::text[],
   'PSC-A-CORPORATE-PCC-AI-STAFF-VOICE-BANK-CASTING-PURPOSE-2026-09-25-001');
 return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pcc_voice_bank_decide_and_activate(p_candidate_id uuid, p_candidate_digest text, p_decision text, p_approver_actor_id text, p_authority_evidence text, p_conditions jsonb, p_allowed_surfaces text[], p_governing_psc_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'corporate_voice', 'extensions'
AS $function$
declare
  v_candidate corporate_voice.voice_candidates;
  v_previous uuid;
  v_approval uuid;
  v_event_digest text;
begin
  select * into v_candidate
  from corporate_voice.voice_candidates
  where candidate_id=p_candidate_id and candidate_digest=p_candidate_digest
  for update;

  if not found then raise exception 'CANDIDATE_DIGEST_MISMATCH'; end if;
  if v_candidate.state not in ('PROPOSED','APPROVED') then raise exception 'INVALID_CANDIDATE_STATE'; end if;
  if p_decision not in ('APPROVE','REJECT') then raise exception 'INVALID_DECISION'; end if;
  if p_decision='APPROVE' and exists (
    select 1 from corporate_voice.voice_approvals a
    where a.candidate_id=v_candidate.candidate_id
      and a.candidate_digest=v_candidate.candidate_digest
      and a.decision='APPROVE'
      and a.conditions->>'excludes'='PCC_OFFICE_PILOT'
  ) and not exists (
    select 1 from corporate_voice.office_voice_approvals o
    where o.candidate_id=v_candidate.candidate_id
      and o.candidate_digest=v_candidate.candidate_digest
      and o.approver_actor_id='PHOENIX_KING'
      and o.authority_evidence='PCC_GATE_REAUTH_BOUND_TO_CANDIDATE_DIGEST'
  ) then raise exception 'OFFICE_APPROVAL_REQUIRED'; end if;

  if p_decision='APPROVE' then
    select approval_id into v_approval
    from corporate_voice.office_voice_approvals
    where candidate_id=v_candidate.candidate_id
      and candidate_digest=v_candidate.candidate_digest;
  else
    select approval_id into v_approval
    from corporate_voice.voice_approvals
    where candidate_id=v_candidate.candidate_id
      and candidate_digest=v_candidate.candidate_digest
      and decision=p_decision;
  end if;
  if v_approval is null then
    insert into corporate_voice.voice_approvals(
      candidate_id,candidate_digest,decision,approver_actor_id,authority_evidence,conditions
    ) values (
      v_candidate.candidate_id,v_candidate.candidate_digest,p_decision,p_approver_actor_id,
      p_authority_evidence,coalesce(p_conditions,'{}'::jsonb)
    )
    returning approval_id into v_approval;
  end if;

  if p_decision='REJECT' then
    update corporate_voice.voice_candidates set state='REJECTED',updated_at=now()
    where candidate_id=v_candidate.candidate_id;
    v_event_digest := encode(extensions.digest(
      'CANDIDATE_REJECTED|' || v_candidate.candidate_id::text || '|' || v_approval::text,
      'sha256'
    ),'hex');
    insert into corporate_voice.voice_events(event_type,persona_id,candidate_id,actor_id,evidence,event_digest)
    values ('CANDIDATE_REJECTED',v_candidate.persona_id,v_candidate.candidate_id,p_approver_actor_id,
      jsonb_build_object('approval_id',v_approval,'candidate_digest',v_candidate.candidate_digest),v_event_digest);
    return jsonb_build_object('candidate_id',v_candidate.candidate_id,'state','REJECTED','approval_id',v_approval);
  end if;

  select active_candidate_id into v_previous
  from corporate_voice.voice_identities
  where persona_id=v_candidate.persona_id;

  update corporate_voice.voice_candidates
  set state='SUPERSEDED',updated_at=now()
  where persona_id=v_candidate.persona_id and state='ACTIVE' and candidate_id<>v_candidate.candidate_id;

  update corporate_voice.voice_candidates
  set state='ACTIVE',updated_at=now()
  where candidate_id=v_candidate.candidate_id;

  insert into corporate_voice.voice_identities(
    persona_id,persona_name,active_candidate_id,active_candidate_digest,activation_state,
    allowed_surfaces,activated_by,previous_candidate_id,rollback_state,governing_psc_id
  ) values (
    v_candidate.persona_id,v_candidate.persona_name,v_candidate.candidate_id,v_candidate.candidate_digest,'ACTIVE',
    coalesce(p_allowed_surfaces,array['PCC_OFFICE']::text[]),p_approver_actor_id,v_previous,
    jsonb_build_object('previous_candidate_id',v_previous),p_governing_psc_id
  )
  on conflict (persona_id) do update set
    persona_name=excluded.persona_name,
    previous_candidate_id=corporate_voice.voice_identities.active_candidate_id,
    active_candidate_id=excluded.active_candidate_id,
    active_candidate_digest=excluded.active_candidate_digest,
    activation_state='ACTIVE',
    allowed_surfaces=excluded.allowed_surfaces,
    activated_by=excluded.activated_by,
    activated_at=now(),
    rollback_state=jsonb_build_object('previous_candidate_id',corporate_voice.voice_identities.active_candidate_id),
    governing_psc_id=excluded.governing_psc_id;

  v_event_digest := encode(extensions.digest(
    'IDENTITY_ACTIVATED|' || v_candidate.persona_id || '|' || v_candidate.candidate_id::text ||
    '|' || v_approval::text || '|' || v_candidate.candidate_digest,
    'sha256'
  ),'hex');

  insert into corporate_voice.voice_events(event_type,persona_id,candidate_id,actor_id,evidence,event_digest)
  values ('IDENTITY_ACTIVATED',v_candidate.persona_id,v_candidate.candidate_id,p_approver_actor_id,
    jsonb_build_object('approval_id',v_approval,'candidate_digest',v_candidate.candidate_digest,
      'allowed_surfaces',coalesce(p_allowed_surfaces,array['PCC_OFFICE']::text[]),
      'previous_candidate_id',v_previous),v_event_digest);

  return jsonb_build_object(
    'candidate_id',v_candidate.candidate_id,
    'candidate_digest',v_candidate.candidate_digest,
    'state','ACTIVE',
    'approval_id',v_approval,
    'previous_candidate_id',v_previous,
    'allowed_surfaces',coalesce(p_allowed_surfaces,array['PCC_OFFICE']::text[])
  );
end;
$function$
;
revoke all on function public.pcc_voice_bank_approve_office_candidate(uuid,text) from public,anon,authenticated;
grant execute on function public.pcc_voice_bank_approve_office_candidate(uuid,text) to service_role;
