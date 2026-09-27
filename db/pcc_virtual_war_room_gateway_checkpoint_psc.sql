-- Corporate checkpoint: gateway route correction, negative access evidence only.
begin;
with payload as (
  select jsonb_build_object(
    'subject','PCC War Room host path through existing Corporate command gateway',
    'classification','BOUNDED_IMPLEMENTATION_CHECKPOINT',
    'authority_dependency','PSC-A-CORPORATE-PCC-VIRTUAL-WAR-ROOM-CHAD-HOST-DRAFT-AUTHORITY-2026-09-26-001',
    'database_dependency','PSC-A-CORPORATE-PCC-VIRTUAL-WAR-ROOM-HOST-DRAFT-ACCEPTANCE-2026-09-26-001',
    'gateway_function','pcc-entry-gateway v24',
    'gateway_source_commit','7c7e7af764e4352df48504c8d109eefe8992c3d4',
    'war_room_panel_source_commit','539ab9ddf61bca991f107d50368f25c3f88f73af',
    'gateway_routes',jsonb_build_array('POST /war-room-draft','POST /war-room-cancel-draft','GET /war-room-meeting'),
    'binding','Validated PCC command session; server resolves exact Corporate machine subject; service-only RPC checks active Chad host capability and authority PSC',
    'negative_http_evidence',jsonb_build_object('draft_without_session',401,'cancel_without_session',401,'read_without_session',401),
    'limits',jsonb_build_array('No positive gateway browser host acceptance','No guest grants or live meeting','No Board Room or Systems authority','War Room panel remains in unmerged PR')
  ) as body
), a as (
  insert into corporate_psc.psc_a_records
    (record_id,record_type,title,canonical_payload,integrity_hash,status,established_by)
  select 'PSC-A-CORPORATE-PCC-VIRTUAL-WAR-ROOM-GATEWAY-HOST-ROUTE-CHECKPOINT-2026-09-26-001',
    'IMPLEMENTATION_CHECKPOINT','War Room host gateway bounded route correction',
    body,encode(digest(body::text,'sha256'),'hex'),'AUTHORITATIVE','corporate-coo-chad-g-pennington'
  from payload returning record_id,integrity_hash
), bpayload as (
  select jsonb_build_object(
    'psc_a_record_id',a.record_id,
    'current_state','GATEWAY_V24_DEPLOYED_NEGATIVE_ACCESS_VERIFIED',
    'next_work','Merge and deploy War Room panel, then perform positive PCC entry draft/read/cancel browser test and capture receipts',
    'boundary','Contractor identity and access remain separate; no active meeting or media'
  ) as body,a.record_id from a
), b as (
  insert into corporate_psc.psc_b_records
    (record_id,psc_a_record_id,record_type,continuity_payload,integrity_hash,established_by)
  select 'PSC-B-CORPORATE-PCC-VIRTUAL-WAR-ROOM-GATEWAY-HOST-ROUTE-CHECKPOINT-2026-09-26-001',
    record_id,'CONTINUITY_HANDOFF',body,encode(digest(body::text,'sha256'),'hex'),'corporate-coo-chad-g-pennington'
  from bpayload returning record_id
)
insert into corporate_psc.psc_receipts
  (receipt_id,checkpoint,source_table,source_record_id,verifier_actor_id,evidence)
select 'PSC-RECEIPT-CORPORATE-PCC-VIRTUAL-WAR-ROOM-GATEWAY-HOST-ROUTE-CHECKPOINT-2026-09-26-001',
  'GATEWAY_HOST_ROUTE_NEGATIVE_ACCESS_VERIFIED','corporate_psc.psc_a_records',a.record_id,
  'corporate-coo-chad-g-pennington',
  jsonb_build_object('psc_a_hash',a.integrity_hash,'psc_b_record_id',(select record_id from b),
    'gateway_version',24,'positive_browser_test',false,'guest_grants',0)
from a;
commit;
