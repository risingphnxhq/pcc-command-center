-- Install the bounded PCC registered-state read authorization surface.
-- Private subject assignments and authority receipts are provisioned only in Corporate Canon.
create table if not exists pcc_hq.read_authorizations (
  actor_id text not null,
  auth_subject uuid not null,
  scope text not null check (scope = 'PCC_CORPORATE_REGISTERED_STATE_READ'),
  authority_psc_id text not null references corporate_psc.psc_a_records(record_id),
  state text not null check (state in ('ACTIVE','REVOKED')),
  created_at timestamptz not null default now(),
  primary key (actor_id, auth_subject, scope),
  foreign key (actor_id) references pcc_hq.source_identity_registry(actor_id),
  foreign key (auth_subject) references auth.users(id)
);
alter table pcc_hq.read_authorizations enable row level security;
alter table pcc_hq.read_authorizations force row level security;
revoke all on pcc_hq.read_authorizations from public, anon, authenticated;
