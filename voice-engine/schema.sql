create table if not exists voice_engine_records (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'ACTIVE',
  meta jsonb not null default '{}'::jsonb
);