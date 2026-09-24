-- Applied to Corporate project ttkceizmjeckrorhkhfr, 2026-09-24.
-- PCC V1 lifecycle storage; API roles have no grants and no RLS policies.
begin;
create table if not exists pcc_hq.actions (
  action_id uuid primary key default gen_random_uuid(),
  mission_id text not null,
  workstream_id uuid not null,
  owner_office_id text not null references pcc_hq.office_registry(office_id),
  authority_id text references pcc_hq.authority_registry(authority_id),
  title text not null check (length(btrim(title)) > 0),
  state text not null default 'PLANNED'
    check (state in ('PLANNED','HOLD','AUTHORIZED','EXECUTED','VERIFIED','CANCELLED')),
  constraint actions_authority_required_for_progress
    check (state not in ('AUTHORIZED','EXECUTED','VERIFIED') or authority_id is not null),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (mission_id,workstream_id)
    references pcc_hq.mission_workstream_links(mission_id,workstream_id),
  unique (action_id,mission_id,workstream_id)
);
create index if not exists actions_mission_workstream_idx
  on pcc_hq.actions (mission_id,workstream_id,state);
create table if not exists pcc_hq.action_evidence (
  evidence_id uuid primary key default gen_random_uuid(),
  action_id uuid not null references pcc_hq.actions(action_id),
  evidence_kind text not null check (length(btrim(evidence_kind)) > 0),
  source_ref text not null check (length(btrim(source_ref)) > 0),
  digest_sha256 text check (digest_sha256 is null or digest_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_by_office_id text not null references pcc_hq.office_registry(office_id),
  recorded_at timestamptz not null default now(),
  unique (action_id,evidence_id)
);
create table if not exists pcc_hq.action_receipts (
  receipt_id uuid primary key default gen_random_uuid(),
  action_id uuid not null unique references pcc_hq.actions(action_id),
  evidence_id uuid not null,
  verifier_office_id text not null references pcc_hq.office_registry(office_id),
  verification_result text not null check (verification_result in ('PASS','FAIL')),
  verification_note text not null check (length(btrim(verification_note)) > 0),
  verified_at timestamptz not null default now(),
  canon_psc_id text references corporate_psc.psc_a_records(record_id),
  foreign key (action_id,evidence_id)
    references pcc_hq.action_evidence(action_id,evidence_id)
);
alter table pcc_hq.actions enable row level security;
alter table pcc_hq.action_evidence enable row level security;
alter table pcc_hq.action_receipts enable row level security;
revoke all on pcc_hq.actions,pcc_hq.action_evidence,pcc_hq.action_receipts
  from public,anon,authenticated;
commit;
