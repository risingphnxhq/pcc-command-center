-- Founder direction in this stream: Proceed after the exact bounded host
-- capability was identified. This authorizes Chad to create DRAFT meetings
-- for active Corporate missions. No guest, media, activation, or Systems scope.
begin;
with payload as (
  select jsonb_build_object(
    'issuer','Phoenix King / Founder-Owner',
    'owner','Chad G. Pennington / Corporate COO',
    'subject','PCC virtual War Room bounded Corporate meeting drafts',
    'classification','CONTROLLING_FOUNDER_AUTHORIZATION',
    'founder_direction','Proceed with the separately named War Room host draft capability',
    'authorized_capability','PCC_VIRTUAL_WAR_ROOM_MEETING_HOST',
    'authorized_actor_id','corporate-coo-chad-g-pennington',
    'allowed_operation','Create DRAFT meeting for an ACTIVE Corporate mission, up to 24 hours and within 30 days',
    'authority_boundary','Corporate only; no Systems execution authority',
    'prohibitions',jsonb_build_array('No guest invitation or access','No meeting activation','No media credential','No Board Room or full HQ guest access','No bypass of receipts or PSC-C Systems bridge'),
    'dependencies',jsonb_build_array('PSC-A-CORPORATE-PCC-CHAD-MASON-GOVERNED-COMMAND-EXECUTION-REQUIREMENT-2026-09-26-001','PSC-A-CORPORATE-PCC-COMMAND-INFORMATION-ARCHITECTURE-V2-2026-09-23-001'),
    'observed_before_binding',jsonb_build_object('host_capabilities',0,'meetings',0,'guest_grants',0)
  ) as body
), a as (
  insert into corporate_psc.psc_a_records
    (record_id,record_type,title,canonical_payload,integrity_hash,status,established_by)
  select 'PSC-A-CORPORATE-PCC-VIRTUAL-WAR-ROOM-CHAD-HOST-DRAFT-AUTHORITY-2026-09-26-001',
    'BOUNDED_HOST_AUTHORIZATION','Founder bounded War Room meeting draft authority',
    body,encode(digest(body::text,'sha256'),'hex'),'AUTHORITATIVE','corporate-coo-chad-g-pennington'
  from payload returning record_id,integrity_hash
), bpayload as (
  select jsonb_build_object(
    'psc_a_record_id',a.record_id,
    'current_state','HOST_DRAFT_AUTHORIZED_GUEST_ACCESS_DENIED',
    'next_work','Verify one draft, then separately govern host approval, guest identity, protected content, media and revocation',
    'do_not_infer','This does not establish a contractor meeting or voice operation'
  ) as body,a.record_id from a
), b as (
  insert into corporate_psc.psc_b_records
    (record_id,psc_a_record_id,record_type,continuity_payload,integrity_hash,established_by)
  select 'PSC-B-CORPORATE-PCC-VIRTUAL-WAR-ROOM-CHAD-HOST-DRAFT-AUTHORITY-2026-09-26-001',
    record_id,'CONTINUITY_HANDOFF',body,encode(digest(body::text,'sha256'),'hex'),'corporate-coo-chad-g-pennington'
  from bpayload returning record_id
), receipt as (
  insert into corporate_psc.psc_receipts
    (receipt_id,checkpoint,source_table,source_record_id,verifier_actor_id,evidence)
  select 'PSC-RECEIPT-CORPORATE-PCC-VIRTUAL-WAR-ROOM-CHAD-HOST-DRAFT-AUTHORITY-2026-09-26-001',
    'FOUNDER_BOUNDED_HOST_DRAFT_AUTHORITY_RECORDED','corporate_psc.psc_a_records',a.record_id,
    'corporate-coo-chad-g-pennington',
    jsonb_build_object('psc_a_hash',a.integrity_hash,'psc_b_record_id',(select record_id from b),'capability','PCC_VIRTUAL_WAR_ROOM_MEETING_HOST','scope','DRAFT_ONLY_NO_GUEST')
  from a returning receipt_id
)
insert into pcc_hq.command_authorizations
  (actor_id,auth_subject,capability,authority_psc_id,state)
select s.actor_id,s.auth_subject,'PCC_VIRTUAL_WAR_ROOM_MEETING_HOST',a.record_id,'ACTIVE'
from pcc_hq.source_identity_registry s
cross join a cross join receipt
where s.actor_id='corporate-coo-chad-g-pennington'
  and s.authority_domain='CORPORATE'
  and exists (select 1 from corporate_psc.actor_registry ar where ar.actor_id=s.actor_id and ar.active);
commit;
