-- Exact Founder voice IDs can be staged; activation and room consumers remain gated.
begin;
with payload as (
  select jsonb_build_object(
    'subject','Founder Corporate ElevenLabs voice binding staging contract',
    'owner','Chad G. Pennington / Corporate COO',
    'authority','Phoenix King directive to wire existing created voices to offices, Board Room, War Room and NACE',
    'governing_psc',jsonb_build_array(
      'PSC-A-CORPORATE-PCC-AI-STAFF-VOICE-BANK-CASTING-PURPOSE-2026-09-25-001',
      'PSC-A-CORPORATE-PHOENIX-VOICE-ORCHESTRATOR-V3-1-0-2026-09-23-001',
      'PSC-A-CORPORATE-PCC-CHAD-MASON-GOVERNED-COMMAND-EXECUTION-REQUIREMENT-2026-09-26-001'),
    'deployed','pcc-voice-bank v6 ACTIVE',
    'edge_sha256','7a13b8650329c6ac195f0d975b25821e8e641b1db97b0e31e7c4f3882e171b9a',
    'source_commit','d71aa39f47dae114c260a480d4539a7ede4ebb13',
    'founder_page_commit','d315411173718f989edaa56305c6c442b1e0b064',
    'implemented',jsonb_build_array('18 exact Founder-supplied mappings allowlisted: 17 Corporate offices plus NACE System Operator',
      'Warren retains OpenAI path','PCC entry required','provider ID lookup before candidate staging',
      'digest-bound proposed candidate with provider lineage, rights context and event','existing activation unchanged'),
    'physical_readback',jsonb_build_object('edge_version',6,'edge_state','ACTIVE',
      'active_identity','Chad OpenAI PCC_OFFICE_PILOT only','provider_candidates_staged',0),
    'critical_design_gap','Voice Bank permits one active candidate per persona; replacing Chad before a surface-aware resolver and ElevenLabs office consumer would break the current pilot.',
    'not_established',jsonb_build_array('Founder PCC browser candidate staging','each provider lookup result',
      'ElevenLabs voice activation','office/Board/War Room persona speech','NACE audible every-page session',
      'spoken PROCEED or HALT execution route'),
    'next_work','Build surface-aware identity/version binding and ElevenLabs room renderer with authenticated speaker, floor and receipts; then obtain exact candidate approval and test. Systems command execution stays with Mason and the governed relay.'
  ) body
), a as (
  insert into corporate_psc.psc_a_records
    (record_id,record_type,title,canonical_payload,integrity_hash,status,established_by)
  select 'PSC-A-CORPORATE-PCC-FOUNDER-VOICE-BINDING-STAGING-2026-09-26-001',
    'CORPORATE_BUILD_CHECKPOINT','Founder voice binding staging without activation',body,
    encode(digest(body::text,'sha256'),'hex'),'AUTHORITATIVE','corporate-coo-chad-g-pennington'
  from payload returning record_id,integrity_hash
), bpayload as (
  select jsonb_build_object('psc_a_record_id',a.record_id,
    'current_state','PROVIDER_BINDING_STAGING_BUILT_ACTIVE_IDENTITIES_UNCHANGED',
    'next_work','Surface-aware Voice Bank identity and approved ElevenLabs consumers; first credential-bound Founder candidate staging; independent Systems command lane',
    'prohibition','No room voice, NACE command execution, or production voice rollout claim') body,a.record_id from a
), b as (
  insert into corporate_psc.psc_b_records
    (record_id,psc_a_record_id,record_type,continuity_payload,integrity_hash,established_by)
  select 'PSC-B-CORPORATE-PCC-FOUNDER-VOICE-BINDING-STAGING-2026-09-26-001',
    record_id,'CONTINUITY_HANDOFF',body,encode(digest(body::text,'sha256'),'hex'),'corporate-coo-chad-g-pennington'
  from bpayload returning record_id
)
insert into corporate_psc.psc_receipts
  (receipt_id,checkpoint,source_table,source_record_id,verifier_actor_id,evidence)
select 'PSC-RECEIPT-CORPORATE-PCC-FOUNDER-VOICE-BINDING-STAGING-2026-09-26-001',
  'VOICE_BINDING_STAGING_BUILT_ACTIVATION_PENDING','corporate_psc.psc_a_records',a.record_id,
  'corporate-coo-chad-g-pennington',jsonb_build_object('psc_a_hash',a.integrity_hash,
    'psc_b_record_id',(select record_id from b),'edge_version',6,'active_identity_change',false)
from a;
commit;
