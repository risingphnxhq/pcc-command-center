-- Only the service role may ask for a meeting view after the Edge Function
-- validates an individual Supabase Auth user. No material references leave here.
create or replace function public.pcc_virtual_war_room_room_view(
  p_auth_subject uuid, p_meeting_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_meeting pcc_hq.virtual_war_room_meetings%rowtype;
  v_role text;
begin
  if p_auth_subject is null or p_meeting_id is null then return null; end if;
  select m.* into v_meeting
  from pcc_hq.virtual_war_room_meetings m
  where m.meeting_id = p_meeting_id and m.state in ('DRAFT','ACTIVE');
  if not found then return null; end if;

  if exists (
    select 1 from pcc_hq.command_authorizations ca
    join pcc_hq.source_identity_registry s
      on s.auth_subject=ca.auth_subject and s.actor_id=ca.actor_id
     and s.authority_domain='CORPORATE'
    join corporate_psc.actor_registry ar on ar.actor_id=ca.actor_id and ar.active
    join corporate_psc.psc_a_records p
      on p.record_id=ca.authority_psc_id and p.status='AUTHORITATIVE'
    where ca.auth_subject=p_auth_subject
      and ca.actor_id='corporate-coo-chad-g-pennington'
      and ca.capability='PCC_VIRTUAL_WAR_ROOM_MEETING_HOST'
      and ca.state='ACTIVE'
      and ca.authority_psc_id=v_meeting.authority_psc_id
  ) then
    v_role := 'HOST';
  elsif v_meeting.state='ACTIVE'
    and public.pcc_virtual_war_room_guest_check(p_auth_subject,p_meeting_id) then
    v_role := 'GUEST';
  else
    return null;
  end if;

  return pg_catalog.jsonb_build_object(
    'room','WAR_ROOM', 'meeting_id',v_meeting.meeting_id,
    'mission_ref',v_meeting.mission_ref, 'title',v_meeting.title,
    'state',v_meeting.state, 'starts_at',v_meeting.starts_at,
    'ends_at',v_meeting.ends_at, 'role',v_role
  );
end;
$$;
revoke all on function public.pcc_virtual_war_room_room_view(uuid,uuid) from public, anon, authenticated;
grant execute on function public.pcc_virtual_war_room_room_view(uuid,uuid) to service_role;
