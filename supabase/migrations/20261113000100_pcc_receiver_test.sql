begin;
alter table pcc_institutional.signal_probe_subscriptions add column if not exists receiver_test_id uuid;
alter table pcc_institutional.signal_probe_subscriptions add column if not exists receiver_test_started_at timestamptz;
CREATE OR REPLACE FUNCTION public.pcc_prepare_receiver_test_v1(p_runtime_id uuid, p_proof_sha256 text, p_test_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare route_secret_id uuid; subscription_id text; cfg text;
begin
if auth.role() is distinct from 'service_role' then raise insufficient_privilege; end if;
if p_proof_sha256 is null or p_proof_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_ROUTE_PROOF'; end if;
perform pg_advisory_xact_lock(hashtextextended('pcc_signal_probe_subscriptions',0));
update pcc_institutional.signal_probe_subscriptions s
set receiver_test_id=p_test_id,receiver_test_started_at=clock_timestamp(),route_proof_sha256=p_proof_sha256,route_proof_runtime_id=p_runtime_id,route_proof_expires_at=least(s.expires_at,now()+interval '5 minutes')
where s.verified_runtime_id=p_runtime_id and s.expires_at>now() and (s.route_proof_expires_at is null or s.route_proof_expires_at<=now())
and exists(select 1 from pcc_workforce.stream_registry w join pcc_institutional.runtime_instances r on r.runtime_id::text=w.metadata->>'initial_runtime_id' and r.actor_id=w.metadata->>'persona_actor_id' and r.mission_id=w.mission_id
where w.stream_id='PCC-WF-PCC-COMMUNICATIONS-000001' and w.status='ACTIVE' and r.runtime_id=p_runtime_id and r.lifecycle='ACTIVE')
returning s.secret_id,s.id into route_secret_id,subscription_id;
if not found then raise exception 'ACTIVE_UNVERIFIED_ROUTE_REQUIRED'; end if;
select decrypted_secret into strict cfg from vault.decrypted_secrets where id=route_secret_id;
return jsonb_build_object('config',cfg::jsonb,'subscription_id',subscription_id);
end $function$
;
create or replace function public.pcc_receiver_test_status_v1(p_runtime_id uuid,p_test_id uuid)
returns jsonb language sql set search_path='' as $$
 select jsonb_build_object('runtime_id',verified_runtime_id,'started_at',receiver_test_started_at,
 'verified_at',case when route_verified_at>=receiver_test_started_at then route_verified_at end,
 'status',case when route_verified_at>=receiver_test_started_at then 'VERIFIED'
 when least(expires_at,receiver_test_started_at+interval '5 minutes')<=now() then 'UNCONFIRMED'
 else 'WAITING' end)
 from pcc_institutional.signal_probe_subscriptions
 where auth.role()='service_role' and verified_runtime_id=p_runtime_id and receiver_test_id=p_test_id
$$;
revoke all on function public.pcc_prepare_receiver_test_v1(uuid,text,uuid), public.pcc_receiver_test_status_v1(uuid,uuid) from public, anon, authenticated;
grant execute on function public.pcc_prepare_receiver_test_v1(uuid,text,uuid), public.pcc_receiver_test_status_v1(uuid,uuid) to service_role;
commit;
