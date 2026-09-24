-- Corporate PCC V1 mission/workstream lineage checkpoint.
-- Applied to project ttkceizmjeckrorhkhfr on 2026-09-24.
-- Private relation. No anon/authenticated privileges or RLS policies.
create table if not exists pcc_hq.mission_workstream_links (
  mission_id text not null references pcc_hq.mission_registry(mission_id),
  workstream_id uuid not null references pcc_hq.workstreams(workstream_id),
  evidence_psc_id text not null references corporate_psc.psc_a_records(record_id),
  linked_at timestamptz not null default now(),
  primary key (mission_id, workstream_id),
  unique (workstream_id)
);
alter table pcc_hq.mission_workstream_links enable row level security;
revoke all on pcc_hq.mission_workstream_links from public, anon, authenticated;

-- Backfill only the mission and workstream explicitly paired by existing
-- requirements and source Canon. No generic guessing from owner or title.
insert into pcc_hq.mission_workstream_links (mission_id, workstream_id, evidence_psc_id)
select m.mission_id, w.workstream_id,
  'PSC-A-CORPORATE-LEXOMARK-TAXONOMY-AND-CHAD-S2S-PILOT-PACKAGE-2026-09-23-001'
from pcc_hq.mission_registry m
join pcc_hq.workstreams w on w.requirements->>'mission_id' = m.mission_id
join corporate_psc.psc_a_records a
  on a.record_id = 'PSC-A-CORPORATE-LEXOMARK-TAXONOMY-AND-CHAD-S2S-PILOT-PACKAGE-2026-09-23-001'
where m.mission_id = 'PCC-V1-ESTABLISH-HQ'
  and w.workstream_code = 'PCC_V1_CHAD_S2S_PILOT'
  and w.owner_office_id = m.office_id
  and a.canonical_payload->'telephony'->>'workstream' = 'PCC_V1_CHAD_S2S_PILOT'
on conflict do nothing;
