-- Founder reauthentication is enforced by the Edge route before this service-role-only RPC.
create or replace function public.pcc_voice_bank_approve_room_surfaces(
  p_candidate_id uuid,p_candidate_digest text,p_governing_psc_id text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,corporate_voice,extensions as $body$
declare v_candidate corporate_voice.voice_candidates;
        v_approval uuid;
        v_surface text;
        v_current corporate_voice.surface_voice_bindings;
        v_binding uuid;
        v_bindings jsonb := '[]'::jsonb;
        v_digest text;
begin
  select * into v_candidate from corporate_voice.voice_candidates
    where candidate_id=p_candidate_id and candidate_digest=p_candidate_digest for update;
  if not found then raise exception 'CANDIDATE_DIGEST_MISMATCH'; end if;
  if v_candidate.provider <> 'elevenlabs' or v_candidate.state not in ('PROPOSED','APPROVED') then
    raise exception 'CANDIDATE_NOT_ELIGIBLE'; end if;
  if v_candidate.lineage->>'source_roster' <> 'docs/corporate-elevenlabs-voice-roster-2026-09-26.json'
    or v_candidate.lineage->>'governing_psc_id' <> 'PSC-A-CORPORATE-PCC-AI-STAFF-VOICE-BANK-CASTING-PURPOSE-2026-09-25-001'
    then raise exception 'LINEAGE_NOT_AUTHORIZED'; end if;
  if p_governing_psc_id <> 'PSC-A-CORPORATE-PCC-AI-STAFF-VOICE-BANK-CASTING-PURPOSE-2026-09-25-001'
    then raise exception 'PSC_NOT_AUTHORIZED'; end if;
  select approval_id into v_approval from corporate_voice.voice_approvals
    where candidate_id=p_candidate_id and candidate_digest=p_candidate_digest and decision='APPROVE';
  if v_approval is null then
    insert into corporate_voice.voice_approvals
      (candidate_id,candidate_digest,decision,approver_actor_id,authority_evidence,conditions)
    values (p_candidate_id,p_candidate_digest,'APPROVE','PHOENIX_KING',
      'PCC_GATE_REAUTH_BOUND_TO_CANDIDATE_DIGEST',
      jsonb_build_object('surfaces',jsonb_build_array('PCC_BOARD_ROOM','PCC_WAR_ROOM'),
        'excludes','PCC_OFFICE_PILOT','provider','elevenlabs')) returning approval_id into v_approval;
  end if;
  update corporate_voice.voice_candidates set state='APPROVED',updated_at=now()
    where candidate_id=p_candidate_id and state='PROPOSED';
  foreach v_surface in array array['PCC_BOARD_ROOM','PCC_WAR_ROOM'] loop
    select * into v_current from corporate_voice.surface_voice_bindings
      where persona_id=v_candidate.persona_id and surface=v_surface for update;
    if found then
      if v_current.state <> 'ACTIVE' or v_current.candidate_id <> p_candidate_id
        or v_current.candidate_digest <> p_candidate_digest then
        raise exception 'BINDING_EXISTS_REQUIRES_GOVERNED_ROLLBACK'; end if;
      v_binding := v_current.binding_id;
    else
      insert into corporate_voice.surface_voice_bindings
        (persona_id,surface,candidate_id,candidate_digest,approval_id,state,activated_by,governing_psc_id)
      values (v_candidate.persona_id,v_surface,p_candidate_id,p_candidate_digest,
        v_approval,'ACTIVE','PHOENIX_KING',p_governing_psc_id)
      returning binding_id into v_binding;
      v_digest := encode(extensions.digest(
        'ROOM_BINDING|'||v_binding::text||'|'||p_candidate_digest||'|'||v_approval::text,'sha256'),'hex');
      insert into corporate_voice.voice_events(event_type,persona_id,candidate_id,actor_id,evidence,event_digest)
      values ('IDENTITY_ACTIVATED',v_candidate.persona_id,p_candidate_id,'PHOENIX_KING',
        jsonb_build_object('binding_id',v_binding,'surface',v_surface,'approval_id',v_approval,
          'candidate_digest',p_candidate_digest),v_digest);
    end if;
    v_bindings := v_bindings || jsonb_build_array(jsonb_build_object('binding_id',v_binding,'surface',v_surface));
  end loop;
  return jsonb_build_object('candidate_id',p_candidate_id,'candidate_digest',p_candidate_digest,
    'persona_id',v_candidate.persona_id,'approval_id',v_approval,'bindings',v_bindings,
    'office_identity_unchanged',true);
end;
$body$;
revoke all on function public.pcc_voice_bank_approve_room_surfaces(uuid,text,text) from public,anon,authenticated;
grant execute on function public.pcc_voice_bank_approve_room_surfaces(uuid,text,text) to service_role;
