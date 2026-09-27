begin;
with payload as (
 select jsonb_build_object(
  'subject','NACE system voice presents upon verified PCC entry',
  'authority','Phoenix King directive: NACE is the vocal system presence of Phoenix Command Center',
  'governing_psc',jsonb_build_array(
   'PSC-A-CORPORATE-PCC-NACE-EXISTING-VOICE-WORKER-INTEGRATION-2026-09-24-001',
   'PSC-A-CORPORATE-PCC-AI-STAFF-VOICE-BANK-CASTING-PURPOSE-2026-09-25-001',
   'PSC-A-CORPORATE-PCC-ROOM-VOICE-APPROVAL-PATH-2026-09-27-001'),
  'deployed',jsonb_build_object('entry_page_commit','05d36810ad2279d46f5feb2e0105cc2c16397fb0',
   'approval_page_commit','28a6ddda038097cb22aa96b3d230a67cf7755a77',
   'voice_bank_version',9,'voice_bank_sha256','743100078c6216a40d826229ed77e36e32b248ccffc312bffa0310a891f44ba5',
   'nace_presence_version',1,'nace_presence_sha256','efdda9caca6bcd4361eb24a7a535239f920cfd4b8fe6c5e816edc26444203d21',
   'schema_commit','1a497281bacf5ef843e7ab22590dffdb51dda90d'),
  'behavior',jsonb_build_array('Verified PCC entry displays NACE transcript and offers Hear NACE and Continue',
   'Audio attempt uses current PCC session and exact approved PCC_ENTRY NACE Voice Bank binding',
   'Provider ID checked against Founder NACE/System Operator ID before fixed greeting synthesis',
   'Replay control handles browser playback block; entry is not prevented by missing audio',
   'No arbitrary speech or command authority is granted by greeting'),
  'physical_readback',jsonb_build_object('nace_provider_candidates',0,'nace_entry_bindings',0,
   'chad_office_identity_count',1,'anonymous_resolver_execute',false,
   'unbound_entry_result','VOICE_IDENTITY_NOT_ACTIVE'),
  'not_established',jsonb_build_array('Founder NACE provider lookup and exact candidate approval',
   'audible browser acceptance','NACE voice across every PCC page','live system intelligence conversation',
   'spoken PROCEED/HALT command execution or receipts'),
  'next','Founder enters PCC, stages and approves NACE exact candidate; repeat entry for audible acceptance. Then extend NACE contextual session to all PCC pages under governed intelligence and command contracts.'
 ) body
),a as (
 insert into corporate_psc.psc_a_records
  (record_id,record_type,title,canonical_payload,integrity_hash,status,established_by)
 select 'PSC-A-CORPORATE-PCC-NACE-ENTRY-PRESENCE-2026-09-27-001',
  'CORPORATE_BUILD_CHECKPOINT','NACE verified-entry voice presence source deployed',body,
  encode(digest(body::text,'sha256'),'hex'),'AUTHORITATIVE','corporate-coo-chad-g-pennington'
 from payload returning record_id,integrity_hash
),bp as (
 select a.record_id,a.integrity_hash,jsonb_build_object('psc_a_record_id',a.record_id,
  'state','ENTRY_PRESENCE_DEPLOYED_AUDIO_APPROVAL_AND_BROWSER_ACCEPTANCE_PENDING',
  'next','Founder exact candidate approval; browser audible acceptance; all-page conversational integration') body from a
),b as (
 insert into corporate_psc.psc_b_records
  (record_id,psc_a_record_id,record_type,continuity_payload,integrity_hash,established_by)
 select 'PSC-B-CORPORATE-PCC-NACE-ENTRY-PRESENCE-2026-09-27-001',record_id,
  'CONTINUITY_HANDOFF',body,encode(digest(body::text,'sha256'),'hex'),
  'corporate-coo-chad-g-pennington' from bp returning record_id
)
insert into corporate_psc.psc_receipts
 (receipt_id,checkpoint,source_table,source_record_id,verifier_actor_id,evidence)
select 'PSC-RECEIPT-CORPORATE-PCC-NACE-ENTRY-PRESENCE-2026-09-27-001',
 'NACE_ENTRY_SOURCE_DEPLOYED_AUDIO_PENDING','corporate_psc.psc_a_records',bp.record_id,
 'corporate-coo-chad-g-pennington',jsonb_build_object('psc_a_hash',bp.integrity_hash,
  'psc_b_record_id',(select record_id from b),'entry_bindings',0,'browser_audio_test',false)
from bp;
commit;
