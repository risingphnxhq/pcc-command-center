-- Corporate office worker binding contract. Review and apply only after the
-- office-specific authorization rows have been established in Corporate Canon.
-- This does not create Auth users, pass Gate-2, or activate an office.
begin;

create table if not exists pcc_hq.corporate_worker_binding_authorizations (
  assignment_id text primary key references pcc_hq.workforce_assignments(assignment_id),
  office_id text not null references pcc_hq.office_registry(office_id),
  actor_id text not null unique,
  authority_psc_id text not null references corporate_psc.psc_a_records(record_id),
  authority_scope text not null check (length(authority_scope) between 20 and 2000),
  state text not null check (state in ('AUTHORIZED','HELD')) default 'HELD',
  authorized_at timestamptz not null default now()
);
alter table pcc_hq.corporate_worker_binding_authorizations enable row level security;
revoke all on pcc_hq.corporate_worker_binding_authorizations from public, anon, authenticated;

create or replace function public.pcc_bind_authorized_corporate_worker(
  p_commander_subject uuid, p_worker_subject uuid, p_assignment_id text
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,pcc_hq,corporate_psc,auth
as $$
declare v pcc_hq.corporate_worker_binding_authorizations%rowtype;
        v_name text; v_role text;
begin
  if p_commander_subject is null or p_worker_subject is null then
    raise exception using errcode='42501',message='AUTH_REQUIRED';
  end if;
  if not exists (
    select 1 from pcc_hq.command_authorizations a
    join pcc_hq.source_identity_registry s
      on s.actor_id=a.actor_id and s.auth_subject=a.auth_subject
    where a.actor_id='corporate-coo-chad-g-pennington'
      and a.auth_subject=p_commander_subject
      and a.capability='PCC_CORPORATE_TASK_QUEUE' and a.state='ACTIVE'
  ) then raise exception using errcode='42501',message='COMMAND_AUTHORITY_REQUIRED'; end if;
  select * into v from pcc_hq.corporate_worker_binding_authorizations
    where assignment_id=p_assignment_id and state='AUTHORIZED' for update;
  if not found then raise exception using errcode='42501',message='OFFICE_AUTHORIZATION_REQUIRED'; end if;
  if not exists (select 1 from corporate_psc.psc_a_records
    where record_id=v.authority_psc_id and status='AUTHORITATIVE') then
    raise exception using errcode='42501',message='CURRENT_CANON_REQUIRED';
  end if;
  select o.display_name,o.role_title into v_name,v_role
    from pcc_hq.workforce_assignments w
    join pcc_hq.office_registry o on o.office_id=w.office_id
    where w.assignment_id=v.assignment_id and w.office_id=v.office_id
      and w.lifecycle_state='REGISTERED' and w.runtime_state in ('NOT_BOUND','BOUND')
      and w.jurisdiction like 'CORPORATE%'
      and o.authority_domain='CORPORATE' and o.state='ACTIVE';
  if not found then raise exception using errcode='42501',message='ASSIGNMENT_NOT_ELIGIBLE'; end if;
  if not exists (select 1 from auth.users u where u.id=p_worker_subject
    and u.email_confirmed_at is not null
    and u.raw_app_meta_data->>'rpe_actor_id'=v.actor_id
    and u.raw_app_meta_data->>'rpe_office_id'=v.office_id
    and u.raw_app_meta_data->>'rpe_identity_class'='CORPORATE_SERVICE_WORKER'
    and u.raw_app_meta_data->>'rpe_authority_domain'='CORPORATE') then
    raise exception using errcode='42501',message='WORKER_AUTH_PRINCIPAL_REQUIRED';
  end if;
  if exists (select 1 from corporate_psc.actor_registry ar
    where ar.actor_id=v.actor_id and
      (ar.display_name<>v_name or ar.authority_scope<>v.authority_scope or not ar.active))
    or exists (select 1 from corporate_psc.actor_auth_bindings b
      where (b.auth_subject=p_worker_subject or b.actor_id=v.actor_id)
      and (b.auth_subject<>p_worker_subject or b.actor_id<>v.actor_id
        or b.binding_state<>'ACTIVE' or b.authority_psc<>v.authority_psc_id))
    or exists (select 1 from pcc_hq.corporate_worker_routes r
      where (r.assignment_id=v.assignment_id or r.actor_id=v.actor_id
        or r.worker_subject=p_worker_subject)
      and (r.assignment_id<>v.assignment_id or r.office_id<>v.office_id
        or r.actor_id<>v.actor_id or r.worker_subject<>p_worker_subject
        or r.authority_psc<>v.authority_psc_id)) then
    raise exception using errcode='42501',message='EXISTING_BINDING_CONFLICT';
  end if;
  insert into corporate_psc.actor_registry
    (actor_id,display_name,role_title,authority_scope,active)
    values (v.actor_id,v_name,v_role,v.authority_scope,true)
    on conflict (actor_id) do nothing;
  insert into corporate_psc.actor_auth_bindings
    (auth_subject,actor_id,binding_state,authority_psc)
    values (p_worker_subject,v.actor_id,'ACTIVE',v.authority_psc_id)
    on conflict (auth_subject) do nothing;
  insert into pcc_hq.corporate_worker_routes
    (assignment_id,office_id,actor_id,worker_subject,route_state,authority_psc)
    values (v.assignment_id,v.office_id,v.actor_id,p_worker_subject,'ACTIVE',v.authority_psc_id)
    on conflict (assignment_id) do nothing;
  update pcc_hq.workforce_assignments set runtime_state='BOUND',updated_at=now()
    where assignment_id=v.assignment_id;
  -- Reuse the existing resolver for the full binding and metadata readback.
  perform public.pcc_resolve_corporate_worker(v.assignment_id);
  return jsonb_build_object('ok',true,'assignment_id',v.assignment_id,
    'office_id',v.office_id,'actor_id',v.actor_id,'runtime_state','BOUND',
    'gate2_activation','PENDING_VERIFICATION');
end $$;
revoke all on function public.pcc_bind_authorized_corporate_worker(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.pcc_bind_authorized_corporate_worker(uuid,uuid,text)
  to service_role;
commit;
