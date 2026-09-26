-- Corporate virtual War Room guest access. No grants or meetings are seeded.
create table if not exists pcc_hq.virtual_war_room_meetings (
  meeting_id uuid primary key default gen_random_uuid(),
  mission_ref text not null check (length(mission_ref) between 1 and 160),
  host_office_id text not null check (length(host_office_id) between 1 and 128),
  title text not null check (length(title) between 1 and 200),
  state text not null default 'DRAFT' check (state in ('DRAFT','ACTIVE','CLOSED','CANCELLED')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  disclosure_scope jsonb not null default '{}'::jsonb,
  authority_psc_id text not null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at <= starts_at + interval '24 hours')
);

create table if not exists pcc_hq.virtual_war_room_guest_grants (
  grant_id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references pcc_hq.virtual_war_room_meetings(meeting_id),
  guest_auth_subject uuid not null references auth.users(id),
  sponsor_office_id text not null,
  state text not null default 'PENDING' check (state in ('PENDING','ACTIVE','REVOKED','EXPIRED')),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  permitted_material_refs text[] not null default '{}',
  approved_by_actor_id text,
  approval_receipt_id text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (valid_until > valid_from),
  check (valid_until <= valid_from + interval '24 hours'),
  check (state <> 'ACTIVE' or (approved_by_actor_id is not null and approval_receipt_id is not null)),
  check (state <> 'REVOKED' or revoked_at is not null),
  unique (meeting_id, guest_auth_subject)
);

create index if not exists virtual_war_room_guest_grants_subject_idx
  on pcc_hq.virtual_war_room_guest_grants(guest_auth_subject, meeting_id, state, valid_until);

alter table pcc_hq.virtual_war_room_meetings enable row level security;
alter table pcc_hq.virtual_war_room_meetings force row level security;
alter table pcc_hq.virtual_war_room_guest_grants enable row level security;
alter table pcc_hq.virtual_war_room_guest_grants force row level security;
revoke all on pcc_hq.virtual_war_room_meetings from public, anon, authenticated;
revoke all on pcc_hq.virtual_war_room_guest_grants from public, anon, authenticated;
create or replace function public.pcc_virtual_war_room_guest_check(
  p_guest_auth_subject uuid, p_meeting_id uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from pcc_hq.virtual_war_room_guest_grants g
    join pcc_hq.virtual_war_room_meetings m on m.meeting_id = g.meeting_id
    where g.guest_auth_subject = p_guest_auth_subject
      and g.meeting_id = p_meeting_id
      and g.state = 'ACTIVE' and g.revoked_at is null
      and g.approved_by_actor_id is not null and g.approval_receipt_id is not null
      and now() >= g.valid_from and now() < g.valid_until
      and m.state = 'ACTIVE' and now() >= m.starts_at and now() < m.ends_at
  );
$$;
revoke all on function public.pcc_virtual_war_room_guest_check(uuid,uuid) from public, anon, authenticated;
grant execute on function public.pcc_virtual_war_room_guest_check(uuid,uuid) to service_role;

-- Provisioning is withheld until a separate authenticated Corporate host/approval route
-- has its own receipt and rollback contract. No user-facing direct table access.
