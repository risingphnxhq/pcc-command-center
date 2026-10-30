import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/pcc-migrations/20261029_pcc_animation_z_replenishment_alert_v1.sql', import.meta.url), 'utf8');
const edge = readFileSync(new URL('../supabase/functions/pcc-animation-control-v1/index.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../animation-engine.html', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../pcc-animation-engine.js', import.meta.url), 'utf8');

test('inventory counts only quality-approved private outputs that have not been distributed', () => {
  assert.match(migration, /j\.render_review_state = 'APPROVED'/);
  assert.match(migration, /j\.artifact_manifest->>'quality_approved' = 'true'/);
  assert.match(migration, /j\.artifact_manifest->>'private' = 'true'/);
  assert.match(migration, /j\.artifact_manifest->>'distribution_performed' = 'false'/);
  assert.match(migration, /j\.status in \('QA','COMPLETE'\)/);
});

test('low-stock groups are scoped to channel, output type, and series or campaign', () => {
  assert.match(migration, /primary key \(channel_key, output_type, series_key\)/);
  assert.match(migration, /request_payload->>'series_context'/);
  assert.match(migration, /v_count <= 3/);
  assert.match(migration, /v_count > 3/);
  assert.match(migration, /notification_generation/);
});

test('job changes refresh inventory and PCC returns open alerts to authorized users', () => {
  assert.match(migration, /after insert or update or delete on public\.pcc_animation_jobs/);
  assert.match(migration, /pcc_animation_replenishment_read_v1/);
  assert.match(edge, /pcc_animation_replenishment_read_v1/);
  assert.match(edge, /alerts_available:/);
  assert.match(page, /id="inventoryAlerts"/);
  assert.match(ui, /renderAlerts\(result\.alerts/);
});

test('inventory alerts do not publish or schedule work', () => {
  assert.match(migration, /PCC low-stock notices/);
  assert.match(page, /does not publish or schedule content/);
  assert.doesNotMatch(migration, /insert into public\.cep_v2_jobs/i);
  assert.doesNotMatch(migration, /distribution_performed' = 'true'/);
});

test('alert transition generation is evaluated atomically inside the upsert', () => {
  assert.match(migration, /notification_generation=public\.pcc_animation_replenishment_alerts_v1\.notification_generation\s*\+ case when public\.pcc_animation_replenishment_alerts_v1\.alert_state='RESOLVED' and excluded\.alert_state='OPEN'/);
  assert.doesNotMatch(migration, /v_previous/);
});
