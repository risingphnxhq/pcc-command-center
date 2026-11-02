-- PCC GPT creative workspace intake v1: additive, private, and held for triage.
create table if not exists public.pcc_workspace_intake_v1 (
  intake_id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id text not null,
  runtime_lane text not null check (runtime_lane in ('PRIME_MASON_ACCOUNT','NEW_MASON_ACCOUNT')),
  auth_subject uuid not null,
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  content_kind text not null check (content_kind in ('BOOK','AD','REEL','SHORT','EPISODE','SERIES','IMAGE','VIDEO','AUDIO','DOCUMENT','CONCEPT','OTHER')),
  title text not null check (length(title) between 1 and 500),
  body_text text not null default '',
  content_document jsonb not null default '{}'::jsonb check (jsonb_typeof(content_document)='object'),
  target_system text,
  target_channel text,
  source_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(source_metadata)='object'),
  asset_manifest jsonb not null default '[]'::jsonb check (jsonb_typeof(asset_manifest)='array'),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'PENDING_PCC_TRIAGE' check (status in ('AWAITING_ASSET_UPLOAD','PENDING_PCC_TRIAGE','REJECTED','ROUTED')),
  review_state text not null default 'UNREVIEWED' check (review_state in ('UNREVIEWED','ACCEPTED','NEEDS_CHANGES','DECLINED')),
  approved_for_execution boolean not null default false,
  routed_at timestamptz,
  receipt jsonb not null default '{}'::jsonb check (jsonb_typeof(receipt)='object'),
  unique(auth_subject,runtime_lane,idempotency_key)
);
create table if not exists public.pcc_workspace_intake_assets_v1 (
  asset_id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.pcc_workspace_intake_v1(intake_id),
  created_at timestamptz not null default now(),
  bucket_id text not null default 'pcc-workspace-intake' check (bucket_id='pcc-workspace-intake'),
  object_path text not null unique,
  file_name text not null,
  mime_type text not null,
  expected_size_bytes bigint not null check (expected_size_bytes between 1 and 20971520),
  expected_sha256 text not null check (expected_sha256 ~ '^[a-f0-9]{64}$'),
  asset_role text,
  status text not null default 'UPLOAD_PENDING' check (status in ('UPLOAD_PENDING','VERIFIED','REJECTED')),
  verified_size_bytes bigint,
  verified_sha256 text,
  rejection_code text,
  unique(intake_id,file_name,expected_sha256)
);
alter table public.pcc_workspace_intake_v1 enable row level security;
alter table public.pcc_workspace_intake_assets_v1 enable row level security;
revoke all on public.pcc_workspace_intake_v1,public.pcc_workspace_intake_assets_v1 from anon,authenticated;
grant select,insert,update on public.pcc_workspace_intake_v1,public.pcc_workspace_intake_assets_v1 to service_role;
revoke delete on public.pcc_workspace_intake_v1,public.pcc_workspace_intake_assets_v1 from service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('pcc-workspace-intake','pcc-workspace-intake',false,52428800,
array['image/png','image/jpeg','image/webp','image/gif','audio/mpeg','audio/wav','audio/mp4','audio/ogg','audio/webm','video/mp4','video/webm','application/pdf','text/plain','application/json','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do update set name=excluded.name,public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
comment on table public.pcc_workspace_intake_v1 is 'GPT and PCC creative submissions with immutable source lineage; held for PCC triage, never implicitly approved, executed, rendered, or published.';
comment on table public.pcc_workspace_intake_assets_v1 is 'Private workspace-intake objects. Hash/size verification is required before parent intake is triage-ready.';
