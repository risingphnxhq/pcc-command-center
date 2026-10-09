-- PCC Gate 2 / DRAFT ONLY / NOT APPLIED
-- Additive server-side acceptance challenge ledger; not an ACK and not a second PSC-D state.
-- Apply only after PSC reconciliation, independent review and explicit migration authorization.
create table if not exists pcc_institutional.successor_acceptance_challenges (
  challenge_id uuid primary key default gen_random_uuid(),
  auth_subject uuid not null,
  actor_id text not null,
  system_stream_id text not null,
  boas_root_id text not null,
  build_control_id text not null,
  gate_code text not null,
  foreman_psc_id text not null,
  context_digest text not null,
  psc_d_state_version bigint not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  verification_receipt_id bigint,
  constraint successor_acceptance_challenge_expiry check (expires_at > issued_at),
  constraint successor_acceptance_challenge_once check (consumed_at is null or verification_receipt_id is not null)
);
create index if not exists successor_acceptance_actor_pending_idx
  on pcc_institutional.successor_acceptance_challenges(actor_id, expires_at)
  where consumed_at is null;
alter table pcc_institutional.successor_acceptance_challenges enable row level security;
revoke all on pcc_institutional.successor_acceptance_challenges from anon, authenticated;
-- No client policies. All issuance/consumption must occur via reviewed server-side
-- SECURITY DEFINER RPC or authenticated Edge Function with explicit actor binding.
-- Receipt references must be verified against actual deployed receipt schema before application.
