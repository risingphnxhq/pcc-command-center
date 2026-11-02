-- Per-GPT PCC intake credentials: independently revocable, time-limited, and restricted to the intake route.
create table if not exists public.pcc_workspace_ingest_keys_v1 (
  key_id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by_auth_subject uuid not null,
  actor_id text not null check (actor_id='RPE-MASON-HQ'),
  runtime_lane text not null check (runtime_lane in ('PRIME_MASON_ACCOUNT','NEW_MASON_ACCOUNT')),
  key_label text not null check (length(key_label) between 1 and 100),
  token_sha256 text not null unique check (token_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','REVOKED','EXPIRED')),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint pcc_workspace_ingest_key_expiry check (expires_at > created_at)
);
create index if not exists pcc_workspace_ingest_keys_owner_idx
on public.pcc_workspace_ingest_keys_v1(created_by_auth_subject,runtime_lane,status);
alter table public.pcc_workspace_ingest_keys_v1 enable row level security;
revoke all on public.pcc_workspace_ingest_keys_v1 from anon,authenticated;
grant select,insert,update on public.pcc_workspace_ingest_keys_v1 to service_role;
revoke delete on public.pcc_workspace_ingest_keys_v1 from service_role;
comment on table public.pcc_workspace_ingest_keys_v1 is 'Per-GPT bearer credentials for PCC creative intake only. Raw token is returned once and never persisted; keys expire and can be individually revoked.';
