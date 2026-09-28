-- Reviewed deployment candidate. Corporate task readiness is distinct from
-- PostgreSQL row level security. No application role can insert a decision.
begin;

create table if not exists pcc_hq.corporate_task_rls_decisions (
  assessment_id uuid primary key default gen_random_uuid(),
  task_id uuid not null references pcc_hq.corporate_task_queue(task_id),
  impact_tier text not null check (impact_tier in ('RLS-1','RLS-2','RLS-3','RLS-4')),
  impact_scope text[] not null,
  readiness_percentage numeric(5,2) not null check (readiness_percentage between 0 and 100),
  scoring_basis text not null check (length(btrim(scoring_basis)) >= 10),
  disposition text not null check (disposition in ('GREEN','YELLOW','RED')),
  accountable_leader text not null,
  measurement_owner text not null,
  independent_verifier text not null,
  evidence_refs text[] not null,
  dependency_state text not null,
  blockers text[] not null default '{}',
  isolated_work text[] not null default '{}',
  correction_action text not null,
  required_authorization text not null,
  authorization_receipt_id text,
  verification_receipt_id text not null,
  decision_timestamp timestamptz not null,
  next_gate text not null,
  green_exception_authorization text,
  assessed_at timestamptz not null default now(),
  check (disposition <> 'GREEN' or readiness_percentage >= 99 or green_exception_authorization is not null),
  check (disposition <> 'GREEN' or cardinality(evidence_refs) > 0),
  check (impact_tier in ('RLS-3','RLS-4') or not (impact_scope && array['CROSS_SYSTEM','CROSS_OFFICE','PRODUCTION','SECURITY','INSTITUTIONAL_CONTINUITY']::text[])),
  check (impact_tier <> 'RLS-4' or authorization_receipt_id is not null)
);
create index if not exists corporate_task_rls_task_order on pcc_hq.corporate_task_rls_decisions(task_id,decision_timestamp desc,assessed_at desc);
alter table pcc_hq.corporate_task_rls_decisions enable row level security;
revoke all on pcc_hq.corporate_task_rls_decisions from public,anon,authenticated,service_role;

create or replace function pcc_hq.require_corporate_task_rls()
returns trigger language plpgsql set search_path = '' as $function$
declare d pcc_hq.corporate_task_rls_decisions%rowtype;
begin
  if new.state is not distinct from old.state or new.state in ('HOLD','CANCELLED') then return new; end if;
  if new.state not in ('CLAIMED','IN_PROGRESS','EVIDENCE_SUBMITTED','COMPLETED') then return new; end if;
  select * into d from pcc_hq.corporate_task_rls_decisions
  where task_id=new.task_id order by decision_timestamp desc,assessed_at desc limit 1;
  if d.assessment_id is null or d.disposition <> 'GREEN' or d.dependency_state <> 'CLEAR'
     or cardinality(d.blockers) <> 0 or d.decision_timestamp < old.updated_at then
    raise exception using errcode='P0001',message='CORPORATE_TASK_RLS_ADVANCEMENT_HELD';
  end if;
  return new;
end;
$function$;
revoke all on function pcc_hq.require_corporate_task_rls() from public,anon,authenticated,service_role;
drop trigger if exists corporate_task_rls_gate on pcc_hq.corporate_task_queue;
create trigger corporate_task_rls_gate before update of state on pcc_hq.corporate_task_queue
for each row execute function pcc_hq.require_corporate_task_rls();
commit;
