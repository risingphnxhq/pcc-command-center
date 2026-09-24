-- Applied to Corporate project on 2026-09-24.
-- Authenticated Corporate actor binding required. Registered state is not runtime certification.
CREATE OR REPLACE FUNCTION pcc_hq.corporate_command_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 subject_id uuid := auth.uid();
 snapshot jsonb;
begin
 if subject_id is null or not exists (
   select 1 from corporate_psc.actor_auth_bindings b
   join corporate_psc.actor_registry ar on ar.actor_id=b.actor_id
   join corporate_psc.psc_a_records p on p.record_id=b.authority_psc
   where b.auth_subject=subject_id
     and b.actor_id='corporate-coo-chad-g-pennington'
     and b.binding_state='ACTIVE'
     and ar.active
     and p.status='AUTHORITATIVE'
 ) then
   raise exception 'PCC Corporate office binding required' using errcode='42501';
 end if;
 select jsonb_build_object(
   'as_of',now(),
   'jurisdiction','CORPORATE',
   'state_class','REGISTERED_NOT_RUNTIME_CERTIFIED',
   'source','PCC_REGISTRIES_WITH_CORPORATE_PSC_REFERENCES',
   'office_count',(select count(*) from pcc_hq.office_registry where authority_domain='CORPORATE'),
   'unlinked_workstream_count',(select count(*) from pcc_hq.workstreams w
       where not exists(select 1 from pcc_hq.mission_workstream_links l where l.workstream_id=w.workstream_id)),
   'offices',coalesce((
      select jsonb_agg(jsonb_build_object(
         'office_id',o.office_id,
         'display_name',o.display_name,
         'role_title',o.role_title,
         'registered_state',o.state,
         'governing_psc_id',o.governing_psc_id,
         'source_present',exists(select 1 from corporate_psc.psc_a_records p where p.record_id=o.governing_psc_id),
         'mission_count',(select count(*) from pcc_hq.mission_registry m where m.office_id=o.office_id),
         'workstream_count',(select count(*) from pcc_hq.workstreams w where w.owner_office_id=o.office_id),
         'workstreams',coalesce((
            select jsonb_agg(jsonb_build_object(
              'workstream_code',w.workstream_code,
              'title',w.title,
              'registered_state',w.state,
              'priority',w.priority,
              'governing_psc_ids',to_jsonb(w.governing_psc_ids),
              'linked_mission_id',(select l.mission_id from pcc_hq.mission_workstream_links l where l.workstream_id=w.workstream_id)
            ) order by w.workstream_code)
            from pcc_hq.workstreams w where w.owner_office_id=o.office_id
         ),'[]'::jsonb),
         'missions',coalesce((
            select jsonb_agg(jsonb_build_object(
               'mission_id',m.mission_id,'name',m.mission_name,
               'registered_state',m.state,'governing_psc_id',m.governing_psc_id,
               'linked_workstreams',coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'workstream_code',w.workstream_code,
                    'title',w.title,
                    'registered_state',w.state,
                    'priority',w.priority,
                    'source_psc_id',l.evidence_psc_id,
                    'action_count',(select count(*) from pcc_hq.actions a where a.workstream_id=w.workstream_id),
                    'receipt_count',(select count(*) from pcc_hq.action_receipts r join pcc_hq.actions a on a.action_id=r.action_id where a.workstream_id=w.workstream_id)
                  ) order by w.workstream_code)
                  from pcc_hq.mission_workstream_links l
                  join pcc_hq.workstreams w on w.workstream_id=l.workstream_id
                  where l.mission_id=m.mission_id and w.owner_office_id=o.office_id
               ),'[]'::jsonb)
            ) order by m.mission_id)
            from pcc_hq.mission_registry m where m.office_id=o.office_id
         ),'[]'::jsonb)
      ) order by o.office_id)
      from pcc_hq.office_registry o where o.authority_domain='CORPORATE'
   ),'[]'::jsonb)
 ) into snapshot;
 return snapshot;
end;
$function$


revoke all on function pcc_hq.corporate_command_snapshot() from public,anon;
grant usage on schema pcc_hq to authenticated;
grant execute on function pcc_hq.corporate_command_snapshot() to authenticated;
