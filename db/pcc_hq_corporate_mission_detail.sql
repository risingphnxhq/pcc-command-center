-- Corporate mission detail. Requires the existing bound PCC command snapshot authority gate.
CREATE OR REPLACE FUNCTION pcc_hq.corporate_mission_detail(p_mission_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  perform pcc_hq.corporate_command_snapshot();
  select jsonb_build_object(
    'as_of', now(),
    'jurisdiction', 'CORPORATE',
    'state_class', 'REGISTERED_NOT_RUNTIME_CERTIFIED',
    'mission_id', m.mission_id,
    'office_id', m.office_id,
    'mission_name', m.mission_name,
    'registered_state', m.state,
    'governing_psc_id', m.governing_psc_id,
    'source_present', exists(select 1 from corporate_psc.psc_a_records p where p.record_id=m.governing_psc_id and p.status='AUTHORITATIVE'),
    'workstreams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'workstream_id',w.workstream_id,
        'workstream_code',w.workstream_code,
        'title',w.title,
        'registered_state',w.state,
        'link_evidence_psc_id',l.evidence_psc_id,
        'actions',coalesce((
          select jsonb_agg(jsonb_build_object(
            'action_id',a.action_id,'title',a.title,'registered_state',a.state,
            'authority_id',a.authority_id,
            'evidence_count',(select count(*) from pcc_hq.action_evidence e where e.action_id=a.action_id),
            'verified_receipt_count',(select count(*) from pcc_hq.action_receipts r where r.action_id=a.action_id and r.verification_result='PASS')
          ) order by a.created_at) from pcc_hq.actions a where a.mission_id=m.mission_id and a.workstream_id=w.workstream_id
        ),'[]'::jsonb)
      ) order by w.created_at)
      from pcc_hq.mission_workstream_links l
      join pcc_hq.workstreams w on w.workstream_id=l.workstream_id
      where l.mission_id=m.mission_id and w.owner_office_id=m.office_id
    ),'[]'::jsonb),
    'direct_action_count',(select count(*) from pcc_hq.actions a where a.mission_id=m.mission_id and a.workstream_id is null)
  ) into result from pcc_hq.mission_registry m
  join pcc_hq.office_registry o on o.office_id=m.office_id and o.authority_domain='CORPORATE'
  where m.mission_id=p_mission_id;
  if result is null then raise exception 'Corporate mission unavailable' using errcode='22023'; end if;
  return result;
end;
$function$

revoke all on function pcc_hq.corporate_mission_detail(text) from public, anon;
grant execute on function pcc_hq.corporate_mission_detail(text) to authenticated;
