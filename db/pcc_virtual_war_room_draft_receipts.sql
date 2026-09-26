create table if not exists pcc_hq.virtual_war_room_meeting_receipts (
  receipt_id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references pcc_hq.virtual_war_room_meetings(meeting_id),
  actor_id text not null,
  event_type text not null check (event_type in ('DRAFT_CREATED','DRAFT_CANCELLED')),
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  unique (meeting_id,event_type)
);
alter table pcc_hq.virtual_war_room_meeting_receipts enable row level security;
alter table pcc_hq.virtual_war_room_meeting_receipts force row level security;
revoke all on pcc_hq.virtual_war_room_meeting_receipts from public, anon, authenticated;

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
  insert into pcc_hq.virtual_war_room_meeting_receipts(meeting_id,actor_id,event_type,evidence)
  values (v_meeting_id,'corporate-coo-chad-g-pennington','DRAFT_CREATED',
    jsonb_build_object('mission_ref',p_mission_ref,'authority_psc_id',v_authority_psc_id,'guest_access','DENIED'));
  return v_meeting_id;
end;
$$;
revoke all on function public.pcc_virtual_war_room_meeting_draft(uuid,text,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.pcc_virtual_war_room_meeting_draft(uuid,text,text,timestamptz,timestamptz) to service_role;

create or replace function public.pcc_virtual_war_room_meeting_cancel_draft(
  p_host_auth_subject uuid, p_meeting_id uuid
) returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  v_meeting pcc_hq.virtual_war_room_meetings%rowtype;
begin
  select m.* into v_meeting from pcc_hq.virtual_war_room_meetings m
  join pcc_hq.command_authorizations ca
    on ca.auth_subject=p_host_auth_subject and ca.actor_id='corporate-coo-chad-g-pennington'
   and ca.capability='PCC_VIRTUAL_WAR_ROOM_MEETING_HOST' and ca.state='ACTIVE'
   and ca.authority_psc_id=m.authority_psc_id
  where m.meeting_id=p_meeting_id and m.state='DRAFT' for update of m;
  if not found then raise exception 'DRAFT_CANCEL_AUTHORITY_REQUIRED' using errcode='42501'; end if;
  if exists (select 1 from pcc_hq.virtual_war_room_guest_grants g where g.meeting_id=p_meeting_id) then
    raise exception 'GUEST_GRANT_EXISTS' using errcode='42501';
  end if;
  update pcc_hq.virtual_war_room_meetings set state='CANCELLED' where meeting_id=p_meeting_id;
  insert into pcc_hq.virtual_war_room_meeting_receipts(meeting_id,actor_id,event_type,evidence)
  values (p_meeting_id,'corporate-coo-chad-g-pennington','DRAFT_CANCELLED',
    jsonb_build_object('prior_state','DRAFT','guest_grants',0));
  return true;
end;
$$;
revoke all on function public.pcc_virtual_war_room_meeting_cancel_draft(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pcc_virtual_war_room_meeting_cancel_draft(uuid,uuid) to service_role;
