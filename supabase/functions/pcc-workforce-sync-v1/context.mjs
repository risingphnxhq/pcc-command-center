// Read-only retrieval. Scope comes from the authenticated PCC projection, never caller roots.
export async function buildContext(projection, readRecord, limits = {}) {
  const maxRecords = limits.maxRecords ?? 128;
  const maxBytes = limits.maxBytes ?? 2_000_000;
  const missions = Array.isArray(projection.missions) ? projection.missions : [];
  const roots = [...new Set(missions.flatMap(m => Array.isArray(m.controlling_psc_ids) ? m.controlling_psc_ids : []))].sort();
  const validId = x => typeof x === 'string' && x.length > 0 && x.length <= 240 && /^[A-Za-z0-9_.:-]+$/.test(x);
  const issues = [];
  const records = [];
  const historicalReferences = [];
  const dispositionSource = 'PCC-CSE-PSC-MEMORY-RECALL-PROTOCOL-2026-08-25-005';
  const historicalIds = new Set(['PCC-CSE-PSC-DUAL-PLANE-SOURCE-OF-TRUTH-2026-08-25-002','PSC-STREAM-LIBRARY-PROTOCOL-2026-08-25-003','PSC-DETAILED-SUPABASE-CANON-DEPTH-2026-08-25-004']);
  const visited = new Set();
  const pending = roots.slice();
  let bytes = 0;
  if (!roots.length) issues.push({ code: 'ASSIGNED_GOVERNING_CANON_REQUIRED' });
  while (pending.length) {
    const id = pending.shift();
    if (!validId(id)) { issues.push({ code: 'INVALID_CANON_REFERENCE' }); continue; }
    if (visited.has(id)) continue;
    if (visited.size >= maxRecords) { issues.push({ code: 'CANON_RECORD_LIMIT', unresolved: pending.length + 1 }); break; }
    visited.add(id);
    let row;
    try { row = await readRecord(id); }
    catch { issues.push({ code: 'CANON_READ_FAILED', psc_id: id }); continue; }
    if (!row) { issues.push({ code: 'CANON_NOT_FOUND_IN_SYSTEMS_PROJECTION', psc_id: id }); continue; }
    if (row.psc_id !== id) { issues.push({ code: 'CANON_ID_MISMATCH', psc_id: id }); continue; }
    const encoded = new TextEncoder().encode(JSON.stringify(row));
    if (bytes + encoded.byteLength > maxBytes) { issues.push({ code: 'CANON_BYTE_LIMIT', psc_id: id }); break; }
    bytes += encoded.byteLength;
    records.push(row);
    if (row.superseded_by_psc_id) pending.push(row.superseded_by_psc_id);
    else if (['SUPERSEDED','RETIRED'].includes(row.canon_state)) issues.push({ code: 'CANON_NO_CURRENT_SUCCESSOR', psc_id: id });
    if (Array.isArray(row.dependency_psc_ids)) {
      const d = row.detailed_canon?.psc_d_dependency_disposition;
      const approved = row.psc_id === dispositionSource && d?.status === 'APPROVED' && d.scope === 'PSC_D_BOOTSTRAP_ONLY' && d.approved_by === 'PHOENIX_KING' && d.approval_request_id === 'e209fbe4-acdc-46b6-926e-2ef8c9ae3990' && Array.isArray(d.unavailable_references);
      for (const dependency of row.dependency_psc_ids) {
        const legacyWorkforceBridge = missions.length === 1
          && (missions[0].mission_id === 'RPE-SYS-WORKFORCE-RLS-IMPLEMENTATION-001'
            || (projection.actor?.actor_id === 'RPE-AIDEN-MERCER'
              && missions[0].mission_id === 'RPE-SYS-GATE1-AIDEN-AUDIT-001'))
          && row.psc_id === 'PCC-CSE-PSC-INTERIM-CORPORATE-SYSTEMS-COMMAND-INTEGRATION-2026-09-22-001'
          && dependency === 'RPE-PSC-PRIMARY-SECONDARY-BRIDGE-2026-09-21-001';
        const legacyDrillDependency = missions.length === 1
          && missions[0].mission_id === 'RPE-SYS-PSC-D-SUCCESSOR-DRILL-001'
          && projection.actor?.actor_id === 'RPE-MASON-HQ'
          && [
            'RPE-PSC-PRIMARY-SECONDARY-BRIDGE-2026-09-21-001',
            'RPE-HQ-SYSTEMS-BRIDGE-PSC-PCC-ENTERPRISE-WORKFORCE-OPERATING-ORDER-2026-09-14-001',
            'RPE-HQ-SYSTEMS-BRIDGE-PSC-2026-09-10-001',
            'DIBANA-CSE-PSC-2026-08-28-001'
          ].includes(dependency);
        if (legacyWorkforceBridge || legacyDrillDependency) {
          historicalReferences.push({
            source_psc_id: row.psc_id, psc_id: dependency, status: 'LEGACY_FOUNDER_DISPOSITION',
            required_for_this_bootstrap: false, original_dependency_preserved: true,
            disposition: legacyDrillDependency ? 'Legacy PSC-D build dependency, successor drill only' : 'Phoenix King direction, 2026-11-08, PCC PSC-D Infrastructure Communications'
          });
          continue;
        }
        if (!approved || !historicalIds.has(dependency) || !d.unavailable_references.includes(dependency)) { pending.push(dependency); continue; }
        // The original edge remains in Canon. This disposition applies only to PSC-D traversal.
        let recovered;
        try { recovered = await readRecord(dependency); }
        catch { issues.push({code:'HISTORICAL_SOURCE_READ_FAILED',psc_id:dependency}); continue; }
        if (recovered) {
          issues.push({code:'HISTORICAL_SOURCE_RECOVERED_RECONCILE_REQUIRED',psc_id:dependency});
          pending.push(dependency);
        } else historicalReferences.push({source_psc_id:row.psc_id,psc_id:dependency,status:'UNAVAILABLE_HISTORICAL_SOURCE',required_for_this_bootstrap:false,approval_request_id:d.approval_request_id,original_dependency_preserved:true});
      }
    }
    else if (row.dependency_psc_ids != null) issues.push({ code: 'INVALID_DEPENDENCY_LIST', psc_id: id });
  }
  // Stable representation permits clients to compare snapshots; a digest is not an ACK.
  function stable(x) {
    if (Array.isArray(x)) return x.map(stable);
    if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, stable(x[k])]));
    return x;
  }
  const content = stable({
    protocol: 'PSC-D-CONTEXT/1', actor: projection.actor, command: projection.command,
    authorities: projection.authorities ?? [], missions,
    state_version: projection.sync?.state_version ?? null,
    source_project: 'oyjmpbuxvfxusmbouldi', roots,
    records: records.sort((a,b) => a.psc_id.localeCompare(b.psc_id)), issues,
    historical_references: historicalReferences.sort((a,b) => a.psc_id.localeCompare(b.psc_id))
  });
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(content)));
  return {
    ...content, context_sha256: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,'0')).join(''),
    retrieval_state: issues.length ? 'INCOMPLETE_HOLD' : 'RETRIEVED_RECONCILIATION_REQUIRED',
    record_count: records.length, record_bytes: bytes, acknowledged: false,
    material_execution_authorized: false,
    jurisdiction_notice: 'Systems records only. Corporate records require the authorized Corporate corridor; Systems projections do not replace Corporate canon.',
    next_action: issues.length ? 'RESOLVE_RETRIEVAL_ISSUES_BEFORE_ACK' : 'READ_FULL_CONTEXT_RECONCILE_ASSIGNMENT_THEN_USE_AUTHENTICATED_PSC_D_ACK',
    evidence_boundary: 'Retrieval and a context digest do not establish cognitive consumption, accepted work or release certification.'
  };
}
