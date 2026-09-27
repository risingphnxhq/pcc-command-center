begin;
with payload as (
  select jsonb_build_object(
    'subject','Corporate Board and War Room voice resolver isolation',
    'authority','Phoenix King proceed directive; Corporate Voice Bank PSC',
    'governing_psc','PSC-A-CORPORATE-PCC-AI-STAFF-VOICE-BANK-CASTING-PURPOSE-2026-09-25-001',
    'implementation',jsonb_build_array('corporate_voice.surface_voice_bindings is separate from the existing office identity',
      'resolver requires exact candidate digest, APPROVE record and approved candidate state',
      'PCC Voice Bank v7 routes Board and War Room reads through surface resolver',
      'service_role only RPC, PCC session required at Edge'),
    'deployment',jsonb_build_object('edge_version',7,'edge_sha256','f2fed711bbca0becd929db06eb30177b34da577f26774e998569b8254891d067',
      'source_commit','ebea7a569393aa0abd41b5885967bc5a05f45986',
      'schema_commit','f1bc1c57dc2315ecb7f476cbbce5186cdf3d5a10'),
    'readback',jsonb_build_object('bindings',0,'office_pilot','Chad OpenAI ash active',
      'unbound_war_room','VOICE_IDENTITY_NOT_ACTIVE','anon_rpc_execute',false),
    'not_established',jsonb_build_array('approved ElevenLabs candidates','room bindings','room audio consumer',
      'audible Board or War Room test','NACE every-page speech','spoken command execution'),
    'next','Provider-stage exact Founder roster under PCC session; exact digest Founder approval per surface; build governed ElevenLabs room renderer and session receipts.'
  ) body
), a as (
  insert into corporate_psc.psc_a_records
    (record_id,record_type,title,canonical_payload,integrity_hash,status,established_by)
  select 'PSC-A-CORPORATE-PCC-SURFACE-VOICE-RESOLVER-2026-09-27-001',
    'CORPORATE_BUILD_CHECKPOINT','Surface voice resolver isolated from office pilot',body,
    encode(digest(body::text,'sha256'),'hex'),'AUTHORITATIVE','corporate-coo-chad-g-pennington'
  from payload returning record_id,integrity_hash
), bp as (
  select a.record_id,a.integrity_hash,jsonb_build_object('psc_a_record_id',a.record_id,
    'state','ROOM_RESOLVER_DEPLOYED_EMPTY_FAIL_CLOSED','next','Founder candidate staging and approval; room audio consumer') body from a
), b as (
  insert into corporate_psc.psc_b_records
    (record_id,psc_a_record_id,record_type,continuity_payload,integrity_hash,established_by)
  select 'PSC-B-CORPORATE-PCC-SURFACE-VOICE-RESOLVER-2026-09-27-001',record_id,'CONTINUITY_HANDOFF',
    body,encode(digest(body::text,'sha256'),'hex'),'corporate-coo-chad-g-pennington'
  from bp returning record_id
)
insert into corporate_psc.psc_receipts
  (receipt_id,checkpoint,source_table,source_record_id,verifier_actor_id,evidence)
select 'PSC-RECEIPT-CORPORATE-PCC-SURFACE-VOICE-RESOLVER-2026-09-27-001',
  'ROOM_RESOLVER_FAIL_CLOSED_OFFICE_PILOT_INTACT','corporate_psc.psc_a_records',bp.record_id,
  'corporate-coo-chad-g-pennington',jsonb_build_object('psc_a_hash',bp.integrity_hash,
    'psc_b_record_id',(select record_id from b),'bindings',0,'office_identity_changed',false)
from bp;
commit;
