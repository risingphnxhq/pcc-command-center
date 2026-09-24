-- Applied to Corporate project ttkceizmjeckrorhkhfr on 2026-09-24.
-- Fails closed until a separately verified ACTIVE Chad actor-auth binding exists.
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
    join corporate_psc.actor_registry ar on ar.actor_id = b.actor_id
    join corporate_psc.psc_a_records p on p.record_id = b.authority_psc
    where b.auth_subject = subject_id
      and b.actor_id = 'corporate-coo-chad-g-pennington'
      and b.binding_state = 'ACTIVE'
      and ar.active
      and p.status = 'AUTHORITATIVE'
  ) then
    raise exception 'PCC Corporate office binding required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'office_id', o.office_id,
    'as_of', now(),
    'missions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'mission_id', m.mission_id,
        'name', m.mission_name,
        'state', m.state,
        'workstreams', coalesce((
          select jsonb_agg(jsonb_build_object(
            'workstream_code', w.workstream_code,
            'title', w.title,
            'state', w.state,
            'priority', w.priority,
            'action_count', (select count(*) from pcc_hq.actions a
              where a.mission_id = m.mission_id and a.workstream_id = w.workstream_id),
            'receipt_count', (select count(*) from pcc_hq.action_receipts r
              join pcc_hq.actions a on a.action_id = r.action_id
              where a.mission_id = m.mission_id and a.workstream_id = w.workstream_id)
          ) order by w.workstream_code)
          from pcc_hq.mission_workstream_links l
          join pcc_hq.workstreams w on w.workstream_id = l.workstream_id
          where l.mission_id = m.mission_id
            and w.owner_office_id = o.office_id
        ), '[]'::jsonb)
      ) order by m.mission_id)
      from pcc_hq.mission_registry m
      where m.office_id = o.office_id
    ), '[]'::jsonb)
  ) into snapshot
  from pcc_hq.office_registry o
  where o.office_id = 'CHAD_G_PENNINGTON'
    and o.authority_domain = 'CORPORATE'
    and o.state = 'ACTIVE';

  if snapshot is null then
    raise exception 'Corporate office unavailable' using errcode = '42501';
  end if;
  return snapshot;
end;
$function$

revoke all on function pcc_hq.corporate_command_snapshot() from public,anon;
grant usage on schema pcc_hq to authenticated;
grant execute on function pcc_hq.corporate_command_snapshot() to authenticated;
