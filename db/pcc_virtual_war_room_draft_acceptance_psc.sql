begin;
with payload as (
  select jsonb_build_object(
    'issuer','Phoenix King / Founder-Owner',
    'owner','Chad G. Pennington / Corporate COO',
    'subject','Virtual War Room bounded host draft database acceptance',
    'classification','VERIFIED_BOUNDED_ACCEPTANCE',
    'authority_psc','PSC-A-CORPORATE-PCC-VIRTUAL-WAR-ROOM-CHAD-HOST-DRAFT-AUTHORITY-2026-09-26-001',
    'mission','PCC-V1-ESTABLISH-HQ',
    'meeting_id','902ad8b7-873d-44ad-8b90-b138dc839f38',
    'verified_lifecycle',jsonb_build_array('DRAFT_CREATED','DRAFT_CANCELLED'),
    'draft_receipt_id','1dff6665-46c9-43ae-b479-f76c589a58d1',
    'cancel_receipt_id','66238321-6d66-44f2-9e0b-4c42963694f0',
    'final_state','CANCELLED',
    'guest_grants',0,
    'truth_boundary',jsonb_build_object(
      'established','Database host-authority check, draft creation, durable receipts, and cancellation',
      'not_established',jsonb_build_array('Authenticated browser host session','Contractor invitation','Protected static page','Live meeting media','Board voices','Systems status feed')
    ),
    'rollback','Draft cancelled; receipts retained'
  ) as body
), a as (
  insert into corporate_psc.psc_a_records
    (record_id,record_type,title,canonical_payload,integrity_hash,status,established_by)
  select 'PSC-A-CORPORATE-PCC-VIRTUAL-WAR-ROOM-HOST-DRAFT-ACCEPTANCE-2026-09-26-001',
    'OPERATIONAL_ACCEPTANCE_CHECKPOINT','Virtual War Room draft creation and cancellation acceptance',
    body,encode(digest(body::text,'sha256'),'hex'),'AUTHORITATIVE','corporate-coo-chad-g-pennington'
  from payload returning record_id,integrity_hash
), bpayload as (
  select jsonb_build_object(
    'psc_a_record_id',a.record_id,
    'current_state','DRAFT_ROUTE_DATABASE_VERIFIED_NO_GUEST_ACCESS',
    'next_work','Connect authenticated Corporate browser host session and protected content; separately govern guest invitations and media',
    'prohibition','Do not claim virtual contractor meeting readiness'
  ) as body,a.record_id from a
), b as (
  insert into corporate_psc.psc_b_records
    (record_id,psc_a_record_id,record_type,continuity_payload,integrity_hash,established_by)
  select 'PSC-B-CORPORATE-PCC-VIRTUAL-WAR-ROOM-HOST-DRAFT-ACCEPTANCE-2026-09-26-001',
    record_id,'CONTINUITY_HANDOFF',body,encode(digest(body::text,'sha256'),'hex'),'corporate-coo-chad-g-pennington'
  from bpayload returning record_id
)
insert into corporate_psc.psc_receipts
  (receipt_id,checkpoint,source_table,source_record_id,verifier_actor_id,evidence)
select 'PSC-RECEIPT-CORPORATE-PCC-VIRTUAL-WAR-ROOM-HOST-DRAFT-ACCEPTANCE-2026-09-26-001',
  'HOST_DRAFT_CREATE_CANCEL_DATABASE_VERIFIED','corporate_psc.psc_a_records',a.record_id,
  'corporate-coo-chad-g-pennington',
  jsonb_build_object('psc_a_hash',a.integrity_hash,'psc_b_record_id',(select record_id from b),
    'meeting_id','902ad8b7-873d-44ad-8b90-b138dc839f38',
    'draft_receipt','1dff6665-46c9-43ae-b479-f76c589a58d1',
    'cancel_receipt','66238321-6d66-44f2-9e0b-4c42963694f0',
    'final_state','CANCELLED','guest_grants',0)
from a;
commit;
