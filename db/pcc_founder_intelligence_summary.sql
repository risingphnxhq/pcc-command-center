-- Corporate-only, read-only aggregate for the Founder's intelligence view.
-- The public RPC is executable by service_role only; the entry gateway validates
-- the PCC session and Corporate machine subject before calling it.
begin;

create or replace function public.pcc_founder_intelligence_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
with office as (
  select o.office_id, o.display_name, o.role_title,
    (select count(*) from pcc_hq.mission_registry m where m.office_id=o.office_id) missions,
    (select count(*) from pcc_hq.workstreams w where w.owner_office_id=o.office_id) workstreams,
    (select count(*) from pcc_hq.actions a where a.owner_office_id=o.office_id) actions,
    (select count(distinct a.action_id) from pcc_hq.actions a join pcc_hq.action_receipts r on r.action_id=a.action_id
      where a.owner_office_id=o.office_id and a.state='VERIFIED' and r.verification_result='PASS') verified_actions,
    (select count(*) from pcc_hq.actions a where a.owner_office_id=o.office_id and not (a.state='VERIFIED' and exists
      (select 1 from pcc_hq.action_receipts r where r.action_id=a.action_id and r.verification_result='PASS'))) unverified_actions,
    (select max(r.verified_at) from pcc_hq.actions a join pcc_hq.action_receipts r on r.action_id=a.action_id
      where a.owner_office_id=o.office_id and r.verification_result='PASS') last_verified_at
  from pcc_hq.office_registry o
  where o.office_id not in ('NACE','PHOENIX_KING')
), meetings as (
  select coalesce(jsonb_agg(jsonb_build_object('title',title,'host_office_id',host_office_id,
    'starts_at',starts_at,'ends_at',ends_at,'state',state) order by starts_at),'[]'::jsonb) items
  from (select title,host_office_id,starts_at,ends_at,state from pcc_hq.virtual_war_room_meetings
    where starts_at >= now() and state not in ('CANCELLED') order by starts_at limit 12) upcoming
), tasks as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'task_id',t.task_id,'title',t.title,'office_id',w.office_id,'task_state',t.state,
    'impact_tier',d.impact_tier,'readiness_percentage',d.readiness_percentage,
    'disposition',d.disposition,'dependency_state',d.dependency_state,
    'blockers',coalesce(to_jsonb(d.blockers),'[]'::jsonb),
    'verification_receipt_id',d.verification_receipt_id,
    'decision_timestamp',d.decision_timestamp,'next_gate',d.next_gate)
    order by t.updated_at desc),'[]'::jsonb) items
  from pcc_hq.corporate_task_queue t
  left join pcc_hq.workforce_assignments w on w.assignment_id=t.assignment_id
  left join lateral (select * from pcc_hq.corporate_task_rls_decisions r
    where r.task_id=t.task_id order by r.decision_timestamp desc,r.assessed_at desc limit 1) d on true
)
select jsonb_build_object(
  'as_of',now(), 'source','CORPORATE_PCC_REGISTRIES_AND_ACTION_RECEIPTS',
  'scope','registered workload and verified PCC actions; not a company-wide performance score',
  'offices',coalesce((select jsonb_agg(to_jsonb(office) order by display_name) from office),'[]'::jsonb),
  'meetings',(select items from meetings),
  'corporate_tasks',(select items from tasks),
  'enterprise_rls',jsonb_build_object(
    'state','UNASSESSED','tier',null,'readiness_percentage',null,'scoring_basis',null,
    'color',null,'accountable_leader',null,'measurement_owner',null,'independent_verifier',null,
    'evidence_refs','[]'::jsonb,'dependency_state',null,'blockers','[]'::jsonb,
    'isolated_work','[]'::jsonb,'correction_action',null,'required_authorization',null,
    'receipt_id',null,'decision_timestamp',null,'next_gate',null,'green_exception_authorization',null,
    'doctrine_refs',jsonb_build_array('RPE-SYS-WORKFORCE-TEST-READINESS-CHARTER-002',
      'RPE-ENTERPRISE-PSC-EFBP-TQL-TQM-RLS-OPERATING-DOCTRINE-2026-09-19-015')),
  'financial_standing',jsonb_build_object('state','FEED_UNAVAILABLE'),
  'systems_health',jsonb_build_object('state','FEED_UNAVAILABLE','authority','MASON_CSE'),
  'error_reports',jsonb_build_object('state','FEED_UNAVAILABLE')
)
$function$;

revoke all on function public.pcc_founder_intelligence_summary() from public, anon, authenticated;
grant execute on function public.pcc_founder_intelligence_summary() to service_role;
commit;
