-- Founder-observed PCC browser host draft/read/cancel acceptance. No guest or media claim.
begin;
with payload as (
  select jsonb_build_object(
    'issuer','Phoenix King / Founder-Owner',
    'owner','Chad G. Pennington / Corporate COO',
    'subject','PCC virtual War Room bounded host browser acceptance',
    'classification','VERIFIED_BOUNDED_BROWSER_ACCEPTANCE',
    'authority_psc','PSC-A-CORPORATE-PCC-VIRTUAL-WAR-ROOM-CHAD-HOST-DRAFT-AUTHORITY-2026-09-26-001',
    'deployment_psc','PSC-A-CORPORATE-PCC-VIRTUAL-WAR-ROOM-PUBLIC-SHELL-DEPLOYMENT-2026-09-26-001',
    'mission','PCC-V1-ESTABLISH-HQ',
    'meeting_id','8f3f1c77-4b7d-4163-a0e7-baeafc93ca66',
    'browser_observation',jsonb_build_array('Founder created draft through PCC War Room','Founder read DRAFT as HOST; no materials or media granted','Founder cancelled draft'),
    'durable_receipts',jsonb_build_object('draft_created','1d0cd30e-fc39-4524-8a20-2228f27893d4','draft_cancelled','b545ac27-49b5-4241-a422-3738ef4850f2'),
    'physical_final_state','CANCELLED',
    'guest_grants',0,
    'host_read_receipt','No separate durable read receipt; browser screenshot is the read observation',
    'authority_mechanism','PCC short-lived entry session, server-side Corporate machine subject, and active host capability and PSC',
    'truth_boundary',jsonb_build_object(
      'established','Bounded Corporate host draft/read/cancel route through the deployed PCC browser and durable creation/cancellation receipts',
      'not_established',jsonb_build_array('Individual Chad login','Contractor identity or invitation','Live meeting or media','Board voting or persona speech','HQ virtual traversal','Systems authority or status feed')
    ),
    'rollback','Draft cancelled; creation and cancellation receipts retained; no guest grants'
  ) as body
), a as (
  insert into corporate_psc.psc_a_records
    (record_id,record_type,title,canonical_payload,integrity_hash,status,established_by)
  select 'PSC-A-CORPORATE-PCC-VIRTUAL-WAR-ROOM-HOST-BROWSER-ACCEPTANCE-2026-09-26-001',
    'OPERATIONAL_ACCEPTANCE_CHECKPOINT','Virtual War Room browser host draft/read/cancel acceptance',
    body,encode(digest(body::text,'sha256'),'hex'),'AUTHORITATIVE','corporate-coo-chad-g-pennington'
  from payload returning record_id,integrity_hash
), bpayload as (
  select jsonb_build_object(
    'psc_a_record_id',a.record_id,
    'current_state','HOST_BROWSER_DRAFT_READ_CANCEL_VERIFIED_NO_GUEST_ACCESS',
    'next_work','Design separately governed individual contractor invitations and virtual meeting presence; preserve Corporate and Systems separation',
    'prohibition','Do not claim contractor entry, live media, persona speech, or production meeting readiness'
  ) as body,a.record_id from a
), b as (
  insert into corporate_psc.psc_b_records
    (record_id,psc_a_record_id,record_type,continuity_payload,integrity_hash,established_by)
  select 'PSC-B-CORPORATE-PCC-VIRTUAL-WAR-ROOM-HOST-BROWSER-ACCEPTANCE-2026-09-26-001',
    record_id,'CONTINUITY_HANDOFF',body,encode(digest(body::text,'sha256'),'hex'),'corporate-coo-chad-g-pennington'
  from bpayload returning record_id
)
insert into corporate_psc.psc_receipts
  (receipt_id,checkpoint,source_table,source_record_id,verifier_actor_id,evidence)
select 'PSC-RECEIPT-CORPORATE-PCC-VIRTUAL-WAR-ROOM-HOST-BROWSER-ACCEPTANCE-2026-09-26-001',
  'HOST_BROWSER_DRAFT_READ_CANCEL_VERIFIED','corporate_psc.psc_a_records',a.record_id,
  'corporate-coo-chad-g-pennington',
  jsonb_build_object('psc_a_hash',a.integrity_hash,'psc_b_record_id',(select record_id from b),
    'meeting_id','8f3f1c77-4b7d-4163-a0e7-baeafc93ca66',
    'draft_receipt','1d0cd30e-fc39-4524-8a20-2228f27893d4',
    'cancel_receipt','b545ac27-49b5-4241-a422-3738ef4850f2',
    'browser_read','Founder screenshot; no durable read receipt',
    'final_state','CANCELLED','guest_grants',0)
from a;
commit;
