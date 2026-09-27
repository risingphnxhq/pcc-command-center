-- Bounded provider-audition build; no voice identity or room activation claim.
begin;
with payload as (
  select jsonb_build_object(
    'subject','Founder-supplied Corporate staff ElevenLabs voice roster bounded audition route',
    'owner','Chad G. Pennington / Corporate COO',
    'governing_council_psc','RPE-COO-PSC-CORPORATE-AI-EXECUTIVE-COUNCIL-STAFF-ROLES-2026-09-16-006',
    'voice_purpose_psc','PSC-A-CORPORATE-PCC-AI-STAFF-VOICE-BANK-CASTING-PURPOSE-2026-09-25-001',
    'source_roster','docs/corporate-elevenlabs-voice-roster-2026-09-26.json',
    'source_commit','5069b78ed2d9843bddc72e626882a51ba1cfca21',
    'edge_function','pcc-elevenlabs-staff-voices v1 ACTIVE',
    'edge_sha256','72b03e5880d73a8709f22bf02fbfd51789088aeeb7c33db666f730c966497923',
    'scope',jsonb_build_object('founder_voice_ids',18,'corporate_offices',17,'nace_system_operator',1,
      'warren','OpenAI path retained; no ElevenLabs ID','mason','Systems authority separate'),
    'security','Exact roster only; PCC short-lived session; managed provider key; fixed short audition line; no activation route',
    'verification',jsonb_build_array('18 source mappings matched Founder roster','browser script syntax passed','edge function v1 ACTIVE and source digest read back','Corporate Voice Bank still has only Chad OpenAI office pilot identity'),
    'not_yet_verified',jsonb_build_array('public GitHub Pages availability','provider lookup for each voice under valid PCC session','audible samples','Voice Bank candidate approvals','Board and War Room voice consumption'),
    'next_work','Founder runs bounded voice lookup and audible test; stage exact verified candidates through digest-bound approval; build authorized room voice consumer and receipts'
  ) body
), a as (
  insert into corporate_psc.psc_a_records
    (record_id,record_type,title,canonical_payload,integrity_hash,status,established_by)
  select 'PSC-A-CORPORATE-PCC-STAFF-ELEVENLABS-BOUNDED-AUDITION-BUILD-2026-09-26-001',
    'CORPORATE_BUILD_CHECKPOINT','Founder staff ElevenLabs bounded audition build',body,
    encode(digest(body::text,'sha256'),'hex'),'AUTHORITATIVE','corporate-coo-chad-g-pennington'
  from payload returning record_id,integrity_hash
), bpayload as (
  select jsonb_build_object('psc_a_record_id',a.record_id,
    'current_state','ROSTER_AND_AUDITION_ROUTE_BUILT_PROVIDER_AND_ROOM_ACCEPTANCE_PENDING',
    'next_work','Verify each ID and audio through PCC; preserve exact candidate approval and room speaker controls',
    'prohibition','Do not label voices active throughout PCC or claim a vocal Board or War Room') body,a.record_id from a
), b as (
  insert into corporate_psc.psc_b_records
    (record_id,psc_a_record_id,record_type,continuity_payload,integrity_hash,established_by)
  select 'PSC-B-CORPORATE-PCC-STAFF-ELEVENLABS-BOUNDED-AUDITION-BUILD-2026-09-26-001',
    record_id,'CONTINUITY_HANDOFF',body,encode(digest(body::text,'sha256'),'hex'),'corporate-coo-chad-g-pennington'
  from bpayload returning record_id
)
insert into corporate_psc.psc_receipts
  (receipt_id,checkpoint,source_table,source_record_id,verifier_actor_id,evidence)
select 'PSC-RECEIPT-CORPORATE-PCC-STAFF-ELEVENLABS-BOUNDED-AUDITION-BUILD-2026-09-26-001',
  'BOUNDED_AUDITION_BUILD_PROVIDER_ACCEPTANCE_PENDING','corporate_psc.psc_a_records',a.record_id,
  'corporate-coo-chad-g-pennington',jsonb_build_object('psc_a_hash',a.integrity_hash,
    'psc_b_record_id',(select record_id from b),'edge_version',1,'provider_lookups_verified',false,
    'room_voice_activation',false)
from a;
commit;
