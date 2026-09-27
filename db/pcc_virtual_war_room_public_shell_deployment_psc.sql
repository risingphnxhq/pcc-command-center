-- Live public-shell verification after PR #12 merge. No meeting acceptance claim.
begin;
with payload as (
  select jsonb_build_object(
    'subject','PCC virtual War Room public shell deployment',
    'classification','DEPLOYMENT_OBSERVATION',
    'prior_checkpoint','PSC-A-CORPORATE-PCC-VIRTUAL-WAR-ROOM-GATEWAY-HOST-ROUTE-CHECKPOINT-2026-09-26-001',
    'repository','risingphnxhq/pcc-command-center',
    'merged_pr',12,
    'merge_commit','2c1d978fb95983ec6866456fa4a2c3abceac39ae',
    'observed_url','https://command.risingphoenixhq.com/war-room.html',
    'observed_page',jsonb_build_array('Board Room navigation','Corporate Meeting Draft form','unverified metrics shown as unavailable','unconnected Strategic Command Intake disabled','Jordan Systems status unavailable'),
    'gateway','pcc-entry-gateway v24; no-session draft/read/cancel each returned HTTP 401',
    'limitations',jsonb_build_array('No positive host browser draft/read/cancel test','No guest grants','No live meeting, media, or persona speech','No Systems authority'),
    'next_work','Enter PCC through its normal entry flow; perform and receipt bounded draft/read/cancel test'
  ) as body
), a as (
  insert into corporate_psc.psc_a_records
    (record_id,record_type,title,canonical_payload,integrity_hash,status,established_by)
  select 'PSC-A-CORPORATE-PCC-VIRTUAL-WAR-ROOM-PUBLIC-SHELL-DEPLOYMENT-2026-09-26-001',
    'DEPLOYMENT_OBSERVATION','Virtual War Room public shell live verification',
    body,encode(digest(body::text,'sha256'),'hex'),'AUTHORITATIVE','corporate-coo-chad-g-pennington'
  from payload returning record_id,integrity_hash
), bpayload as (
  select jsonb_build_object(
    'psc_a_record_id',a.record_id,
    'current_state','PUBLIC_SHELL_LIVE_HOST_ACCEPTANCE_PENDING',
    'next_work','Positive PCC command session test of draft/read/cancel; then separate guest and media authorization',
    'do_not_infer','Visible page or draft form does not prove contractor entry or live War Room operation'
  ) as body,a.record_id from a
), b as (
  insert into corporate_psc.psc_b_records
    (record_id,psc_a_record_id,record_type,continuity_payload,integrity_hash,established_by)
  select 'PSC-B-CORPORATE-PCC-VIRTUAL-WAR-ROOM-PUBLIC-SHELL-DEPLOYMENT-2026-09-26-001',
    record_id,'CONTINUITY_HANDOFF',body,encode(digest(body::text,'sha256'),'hex'),'corporate-coo-chad-g-pennington'
  from bpayload returning record_id
)
insert into corporate_psc.psc_receipts
  (receipt_id,checkpoint,source_table,source_record_id,verifier_actor_id,evidence)
select 'PSC-RECEIPT-CORPORATE-PCC-VIRTUAL-WAR-ROOM-PUBLIC-SHELL-DEPLOYMENT-2026-09-26-001',
  'PUBLIC_SHELL_LIVE_VERIFIED_HOST_ACCEPTANCE_PENDING','corporate_psc.psc_a_records',a.record_id,
  'corporate-coo-chad-g-pennington',
  jsonb_build_object('psc_a_hash',a.integrity_hash,'psc_b_record_id',(select record_id from b),
    'merge_commit','2c1d978fb95983ec6866456fa4a2c3abceac39ae','positive_host_acceptance',false)
from a;
commit;
