begin;
with payload as (
 select jsonb_build_object(
  'subject','Founder room voice binding approval path',
  'authority','Phoenix King proceed directive and Corporate Voice Bank controlling PSC',
  'governing_psc',jsonb_build_array(
   'PSC-A-CORPORATE-PCC-AI-STAFF-VOICE-BANK-CASTING-PURPOSE-2026-09-25-001',
   'PSC-A-CORPORATE-PCC-SURFACE-VOICE-RESOLVER-2026-09-27-001'),
  'deployed',jsonb_build_object('edge','pcc-voice-bank v8 ACTIVE',
   'edge_sha256','426d017de9b532f9292d36c7649b2361f9d257a2073e8817548f68df1702a9cc',
   'edge_commit','32f9d8f9633be22f839a5c6df654bf15a69d9d53',
   'page_commit','1359e5acaa3f25a6ce850b7f826bf0133bac3ccf',
   'approval_sql_commit','1452b97d2e354e7dddae7fbf5944d86a8196668a'),
  'approval_contract',jsonb_build_array('Provider lookup and exact candidate staging under PCC session',
   'Founder passphrase reauthentication bound to candidate ID and digest',
   'service-role-only atomic approval and Board/War Room binding',
   'existing office identity never superseded by room approval',
   'conflicting rebinding fails pending governed rollback'),
  'physical_readback',jsonb_build_object('room_bindings',0,'elevenlabs_candidate_approvals',0,
   'anonymous_approval_rpc',false,'office_chad_voice','OpenAI ash'),
  'not_established',jsonb_build_array('Founder PCC browser staging and reauth',
   'provider verification for each ID','any approved room binding',
   'audio or conversation in rooms','NACE every-page vocal session',
   'spoken command execution'),
  'next','Founder PCC browser stage and approve exact candidates; build governed room speech and session receipts before vocal acceptance.'
 ) body
),a as (
 insert into corporate_psc.psc_a_records
  (record_id,record_type,title,canonical_payload,integrity_hash,status,established_by)
 select 'PSC-A-CORPORATE-PCC-ROOM-VOICE-APPROVAL-PATH-2026-09-27-001',
  'CORPORATE_BUILD_CHECKPOINT','Founder-bound room voice approval path built',body,
  encode(digest(body::text,'sha256'),'hex'),'AUTHORITATIVE','corporate-coo-chad-g-pennington'
 from payload returning record_id,integrity_hash
),bp as (
 select a.record_id,a.integrity_hash,jsonb_build_object('psc_a_record_id',a.record_id,
  'state','APPROVAL_PATH_DEPLOYED_NO_CANDIDATES_APPROVED',
  'next','Founder provider-bound staging and approval; governed audio consumer') body from a
),b as (
 insert into corporate_psc.psc_b_records
  (record_id,psc_a_record_id,record_type,continuity_payload,integrity_hash,established_by)
 select 'PSC-B-CORPORATE-PCC-ROOM-VOICE-APPROVAL-PATH-2026-09-27-001',record_id,
  'CONTINUITY_HANDOFF',body,encode(digest(body::text,'sha256'),'hex'),
  'corporate-coo-chad-g-pennington' from bp returning record_id
)
insert into corporate_psc.psc_receipts
 (receipt_id,checkpoint,source_table,source_record_id,verifier_actor_id,evidence)
select 'PSC-RECEIPT-CORPORATE-PCC-ROOM-VOICE-APPROVAL-PATH-2026-09-27-001',
 'ROOM_VOICE_APPROVAL_PATH_NO_LIVE_BINDINGS','corporate_psc.psc_a_records',bp.record_id,
 'corporate-coo-chad-g-pennington',jsonb_build_object('psc_a_hash',bp.integrity_hash,
  'psc_b_record_id',(select record_id from b),'room_bindings',0,'office_identity_changed',false)
from bp;
commit;
