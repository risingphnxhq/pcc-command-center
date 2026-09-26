-- Host meeting creation is withheld until this exact command capability is
-- separately authorized in pcc_hq.command_authorizations.
create or replace function public.pcc_virtual_war_room_meeting_draft(
  p_host_auth_subject uuid, p_mission_ref text, p_title text,
  p_starts_at timestamptz, p_ends_at timestamptz
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_office_id text;
  v_authority_psc_id text;
  v_meeting_id uuid;
begin
  if p_host_auth_subject is null or p_mission_ref is null or p_title is null
     or p_starts_at is null or p_ends_at is null
     or length(p_title) not between 1 and 200
     or p_starts_at <= now() or p_starts_at > now() + interval '30 days'
     or p_ends_at <= p_starts_at or p_ends_at > p_starts_at + interval '24 hours' then
    raise exception 'INVALID_MEETING_REQUEST' using errcode='22023';
  end if;
  select m.office_id, ca.authority_psc_id into v_office_id, v_authority_psc_id
  from pcc_hq.mission_registry m
  join pcc_hq.office_registry o on o.office_id=m.office_id and o.authority_domain='CORPORATE'
  join pcc_hq.command_authorizations ca
    on ca.auth_subject=p_host_auth_subject and ca.actor_id='corporate-coo-chad-g-pennington'
   and ca.capability='PCC_VIRTUAL_WAR_ROOM_MEETING_HOST' and ca.state='ACTIVE'
  join pcc_hq.source_identity_registry s
    on s.auth_subject=ca.auth_subject and s.actor_id=ca.actor_id and s.authority_domain='CORPORATE'
  join corporate_psc.actor_registry ar on ar.actor_id=ca.actor_id and ar.active
  join corporate_psc.psc_a_records p on p.record_id=ca.authority_psc_id and p.status='AUTHORITATIVE'
  where m.mission_id=p_mission_ref and m.state='ACTIVE';
  if v_authority_psc_id is null then
    raise exception 'MEETING_HOST_AUTHORITY_REQUIRED' using errcode='42501';
  end if;
  insert into pcc_hq.virtual_war_room_meetings
    (mission_ref,host_office_id,title,state,starts_at,ends_at,authority_psc_id)
  values (p_mission_ref,v_office_id,p_title,'DRAFT',p_starts_at,p_ends_at,v_authority_psc_id)
  returning meeting_id into v_meeting_id;
  return v_meeting_id;
end;
$$;
revoke all on function public.pcc_virtual_war_room_meeting_draft(uuid,text,text,timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.pcc_virtual_war_room_meeting_draft(uuid,text,text,timestamptz,timestamptz)
  to service_role;
