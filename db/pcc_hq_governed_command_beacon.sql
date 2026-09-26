-- First bounded PCC Corporate command vertical slice.
-- Chad may mutate only the singleton Corporate Command Beacon through the
-- authenticated machine subject and exact allowlisted operations below.

begin;

create table if not exists pcc_hq.command_authorizations (
  actor_id text not null references pcc_hq.source_identity_registry(actor_id),
  auth_subject uuid not null references auth.users(id),
  capability text not null check (capability = 'PCC_CORPORATE_COMMAND_BEACON'),
  authority_psc_id text not null references corporate_psc.psc_a_records(record_id),
  state text not null check (state in ('ACTIVE','REVOKED')),
  created_at timestamptz not null default now(),
  primary key (actor_id,auth_subject,capability)
);

create table if not exists pcc_hq.command_beacon (
  beacon_id text primary key check (beacon_id = 'CORPORATE_HQ'),
  beacon_state text not null check (beacon_state in ('STANDBY','ACTIVE')),
  message text not null check (length(btrim(message)) between 1 and 240),
  version bigint not null default 1 check (version > 0),
  updated_by_action uuid references pcc_hq.actions(action_id),
  updated_at timestamptz not null default now()
);

create table if not exists pcc_hq.command_beacon_history (
  mutation_id uuid primary key default gen_random_uuid(),
  action_id uuid not null unique references pcc_hq.actions(action_id),
  operation text not null check (operation in ('SET_ACTIVE','SET_STANDBY','ROLLBACK_LAST')),
  previous_state jsonb not null,
  resulting_state jsonb not null,
  rollback_of uuid references pcc_hq.command_beacon_history(mutation_id),
  rolled_back_at timestamptz,
  created_at timestamptz not null default now()
);

alter table pcc_hq.command_authorizations enable row level security;
alter table pcc_hq.command_authorizations force row level security;
alter table pcc_hq.command_beacon enable row level security;
alter table pcc_hq.command_beacon force row level security;
alter table pcc_hq.command_beacon_history enable row level security;
alter table pcc_hq.command_beacon_history force row level security;

revoke all on pcc_hq.command_authorizations,pcc_hq.command_beacon,pcc_hq.command_beacon_history
  from public,anon,authenticated;

insert into pcc_hq.command_beacon(beacon_id,beacon_state,message)
values ('CORPORATE_HQ','STANDBY','Corporate HQ command beacon standing by.')
on conflict (beacon_id) do nothing;

insert into pcc_hq.command_authorizations(actor_id,auth_subject,capability,authority_psc_id,state)
select s.actor_id,s.auth_subject,'PCC_CORPORATE_COMMAND_BEACON',
  'PSC-A-CORPORATE-PCC-CHAD-MASON-GOVERNED-COMMAND-EXECUTION-REQUIREMENT-2026-09-26-001','ACTIVE'
from pcc_hq.source_identity_registry s
where s.actor_id='corporate-coo-chad-g-pennington'
on conflict (actor_id,auth_subject,capability) do update
set authority_psc_id=excluded.authority_psc_id,state='ACTIVE';

revoke all on function public.pcc_corporate_command_beacon(text,text) from public,anon,authenticated;
drop function if exists public.pcc_corporate_command_beacon(text,text);

create or replace function public.pcc_corporate_command_beacon(
  p_auth_subject uuid,
  p_operation text,
  p_message text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog,public,pcc_hq,corporate_psc,extensions
as $$
declare
  v_subject uuid := p_auth_subject;
  v_operation text := upper(btrim(coalesce(p_operation,'')));
  v_message text;
  v_action_id uuid;
  v_evidence_id uuid;
  v_receipt_id uuid;
  v_mutation_id uuid;
  v_rollback_target pcc_hq.command_beacon_history%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_digest text;
begin
  if v_subject is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if v_operation not in ('SET_ACTIVE','SET_STANDBY','ROLLBACK_LAST') then
    raise exception using errcode='22023',message='OPERATION_NOT_ALLOWED';
  end if;
  if not exists (
    select 1 from pcc_hq.command_authorizations a
    join pcc_hq.source_identity_registry s on s.actor_id=a.actor_id and s.auth_subject=a.auth_subject
    where a.actor_id='corporate-coo-chad-g-pennington'
      and a.auth_subject=v_subject
      and a.capability='PCC_CORPORATE_COMMAND_BEACON'
      and a.state='ACTIVE'
  ) then raise exception using errcode='42501',message='COMMAND_AUTHORITY_REQUIRED'; end if;

  select to_jsonb(b) into v_before from pcc_hq.command_beacon b where beacon_id='CORPORATE_HQ' for update;
  if v_before is null then raise exception using errcode='P0001',message='BEACON_UNAVAILABLE'; end if;

  if v_operation='ROLLBACK_LAST' then
    select * into v_rollback_target
    from pcc_hq.command_beacon_history
    where operation in ('SET_ACTIVE','SET_STANDBY') and rolled_back_at is null
    order by created_at desc limit 1 for update;
    if v_rollback_target.mutation_id is null then
      raise exception using errcode='P0001',message='NO_REVERSIBLE_CHANGE';
    end if;
    v_message := v_rollback_target.previous_state->>'message';
  else
    v_message := left(btrim(coalesce(p_message,'')),240);
    if length(v_message)=0 then raise exception using errcode='22023',message='MESSAGE_REQUIRED'; end if;
  end if;

  insert into pcc_hq.actions(mission_id,workstream_id,owner_office_id,authority_id,title,state)
  values ('PCC-V1-ESTABLISH-HQ','3536fd2e-0b9c-4d83-aff1-c3868636d732',
    'CHAD_G_PENNINGTON','AUTH-CHAD-CORPORATE-HQ','Corporate Command Beacon: '||v_operation,'EXECUTED')
  returning action_id into v_action_id;

  if v_operation='ROLLBACK_LAST' then
    update pcc_hq.command_beacon
    set beacon_state=v_rollback_target.previous_state->>'beacon_state',message=v_message,
        version=version+1,updated_by_action=v_action_id,updated_at=now()
    where beacon_id='CORPORATE_HQ';
    update pcc_hq.command_beacon_history set rolled_back_at=now()
    where mutation_id=v_rollback_target.mutation_id;
  else
    update pcc_hq.command_beacon
    set beacon_state=case when v_operation='SET_ACTIVE' then 'ACTIVE' else 'STANDBY' end,
        message=v_message,version=version+1,updated_by_action=v_action_id,updated_at=now()
    where beacon_id='CORPORATE_HQ';
  end if;

  select to_jsonb(b) into v_after from pcc_hq.command_beacon b where beacon_id='CORPORATE_HQ';
  v_digest := encode(extensions.digest(convert_to(v_after::text,'UTF8'),'sha256'),'hex');

  insert into pcc_hq.command_beacon_history(action_id,operation,previous_state,resulting_state,rollback_of)
  values (v_action_id,v_operation,v_before,v_after,
    case when v_operation='ROLLBACK_LAST' then v_rollback_target.mutation_id else null end)
  returning mutation_id into v_mutation_id;

  insert into pcc_hq.action_evidence(action_id,evidence_kind,source_ref,digest_sha256,recorded_by_office_id)
  values (v_action_id,'DATABASE_POSTCONDITION','pcc_hq.command_beacon/CORPORATE_HQ',v_digest,'CHAD_G_PENNINGTON')
  returning evidence_id into v_evidence_id;

  update pcc_hq.actions set state='VERIFIED',updated_at=now() where action_id=v_action_id;
  insert into pcc_hq.action_receipts(action_id,evidence_id,verifier_office_id,verification_result,verification_note,canon_psc_id)
  values (v_action_id,v_evidence_id,'CHAD_G_PENNINGTON','PASS',
    'Atomic database postcondition verified for bounded reversible beacon mutation; independent material-output verification not claimed.',
    'PSC-A-CORPORATE-PCC-CHAD-MASON-GOVERNED-COMMAND-EXECUTION-REQUIREMENT-2026-09-26-001')
  returning receipt_id into v_receipt_id;

  return jsonb_build_object(
    'ok',true,'operation',v_operation,'action_id',v_action_id,'mutation_id',v_mutation_id,
    'evidence_id',v_evidence_id,'receipt_id',v_receipt_id,'beacon',v_after,
    'rollback_available',v_operation<>'ROLLBACK_LAST',
    'authority','AUTH-CHAD-CORPORATE-HQ','mission_id','PCC-V1-ESTABLISH-HQ',
    'workstream_id','3536fd2e-0b9c-4d83-aff1-c3868636d732'
  );
end;
$$;

revoke all on function public.pcc_corporate_command_beacon(uuid,text,text) from public,anon,authenticated;
grant execute on function public.pcc_corporate_command_beacon(uuid,text,text) to service_role;

commit;
