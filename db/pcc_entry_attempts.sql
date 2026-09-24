-- Rate limit index gate attempts without recording IP addresses or passphrases.
create table if not exists pcc_hq.entry_attempts(
  fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
  window_id bigint not null,
  attempts int not null default 0,
  updated_at timestamptz not null default now(),
  primary key(fingerprint,window_id)
);
alter table pcc_hq.entry_attempts enable row level security;
alter table pcc_hq.entry_attempts force row level security;
revoke all on pcc_hq.entry_attempts from public,anon,authenticated;
create or replace function public.pcc_entry_attempt_allowed(p_fingerprint text)
returns boolean language plpgsql volatile security definer set search_path to ''
as $function$
declare current_count int;
begin
  if p_fingerprint !~ '^[a-f0-9]{64}$' then return false; end if;
  insert into pcc_hq.entry_attempts(fingerprint,window_id,attempts)
  values(p_fingerprint,floor(extract(epoch from now()) / 900)::bigint,1)
  on conflict(fingerprint,window_id) do update
  set attempts=pcc_hq.entry_attempts.attempts+1,updated_at=now()
  returning attempts into current_count;
  return current_count <= 5;
end;
$function$;
revoke all on function public.pcc_entry_attempt_allowed(text) from public,anon,authenticated;
grant execute on function public.pcc_entry_attempt_allowed(text) to service_role;
