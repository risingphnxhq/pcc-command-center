begin;

create or replace function public.pcc_register_peggy_worker(
  p_commander_subject uuid,
  p_worker_subject uuid
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,pcc_hq,corporate_psc,auth
as $$
declare
  v_actor text := 'corporate-peggy-wilson-worker';
  v_assignment text := 'G1-PEGGY-SUPPORT';
  v_authority text := 'PSC-A-CORPORATE-PCC-PEGGY-EXECUTIVE-SUPPORT-WORKER-AUTHORIZATION-2026-09-26-001';
begin
  if not exists (
    select 1 from pcc_hq.command_authorizations a
    join pcc_hq.source_identity_registry s
      on s.actor_id=a.actor_id and s.auth_subject=a.auth_subject
    where a.actor_id='corporate-coo-chad-g-pennington'
      and a.auth_subject=p_commander_subject
      and a.capability='PCC_CORPORATE_TASK_QUEUE' and a.state='ACTIVE'
  ) then raise exception using errcode='42501',message='COMMAND_AUTHORITY_REQUIRED'; end if;
  if not exists (select 1 from corporate_psc.psc_a_records
    where record_id=v_authority and status='AUTHORITATIVE')
  then raise exception using errcode='42501',message='PEGGY_CANON_AUTHORITY_REQUIRED'; end if;
  if not exists (
    select 1 from auth.users u where u.id=p_worker_subject
      and u.email='peggy.wilson.worker@rpe.internal'
      and u.email_confirmed_at is not null
      and u.raw_app_meta_data->>'rpe_actor_id'=v_actor
      and u.raw_app_meta_data->>'rpe_office_id'='PEGGY_WILSON'
      and u.raw_app_meta_data->>'rpe_identity_class'='CORPORATE_SERVICE_WORKER'
      and u.raw_app_meta_data->>'rpe_authority_domain'='CORPORATE'
  ) then raise exception using errcode='42501',message='PEGGY_PRINCIPAL_MISMATCH'; end if;
  if not exists (
    select 1 from pcc_hq.workforce_assignments w
    join pcc_hq.office_registry o on o.office_id=w.office_id
    where w.assignment_id=v_assignment and w.office_id='PEGGY_WILSON'
      and w.lifecycle_state='REGISTERED' and w.runtime_state in ('NOT_BOUND','BOUND')
      and w.jurisdiction='CORPORATE_SUPPORT'
      and o.authority_domain='CORPORATE' and o.state='ACTIVE'
  ) then raise exception using errcode='42501',message='PEGGY_ASSIGNMENT_NOT_ELIGIBLE'; end if;
  if exists (select 1 from pcc_hq.corporate_worker_routes
    where assignment_id=v_assignment and (actor_id<>v_actor or worker_subject<>p_worker_subject))
  then raise exception using errcode='42501',message='PEGGY_ROUTE_CONFLICT'; end if;

  insert into corporate_psc.actor_registry
    (actor_id,display_name,role_title,authority_scope,active)
  values (v_actor,'Peggy Wilson','Corporate Executive Support Service Worker',
    'Bounded Corporate executive administration, records, follow-ups and meeting preparation; no Systems authority',true)
  on conflict (actor_id) do nothing;
  if not exists (select 1 from corporate_psc.actor_registry
    where actor_id=v_actor and active and display_name='Peggy Wilson')
  then raise exception using errcode='42501',message='PEGGY_ACTOR_CONFLICT'; end if;

  insert into corporate_psc.actor_auth_bindings
    (auth_subject,actor_id,binding_state,authority_psc)
  values (p_worker_subject,v_actor,'ACTIVE',v_authority)
  on conflict (auth_subject) do nothing;
  if not exists (select 1 from corporate_psc.actor_auth_bindings
    where auth_subject=p_worker_subject and actor_id=v_actor
      and binding_state='ACTIVE' and authority_psc=v_authority)
  then raise exception using errcode='42501',message='PEGGY_AUTH_BINDING_CONFLICT'; end if;

  update pcc_hq.workforce_assignments
    set runtime_state='BOUND',updated_at=now()
    where assignment_id=v_assignment;
  insert into pcc_hq.corporate_worker_routes
    (assignment_id,office_id,actor_id,worker_subject,route_state,authority_psc)
  values (v_assignment,'PEGGY_WILSON',v_actor,p_worker_subject,'ACTIVE',v_authority)
  on conflict (assignment_id) do nothing;
  return jsonb_build_object('ok',true,'assignment_id',v_assignment,
    'office_id','PEGGY_WILSON','actor_id',v_actor,'runtime_state','BOUND',
    'authority_domain','CORPORATE');
end $$;

revoke all on function public.pcc_register_peggy_worker(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pcc_register_peggy_worker(uuid,uuid) to service_role;

commit;
