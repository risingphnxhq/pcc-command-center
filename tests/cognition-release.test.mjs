import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../nace-cognition.js', import.meta.url), 'utf8');
const sandbox = {};
vm.runInNewContext(source, sandbox);
const sample = { offices: [
  { office_id: 'CHAD_G_PENNINGTON', display_name: 'Chad G. Pennington', mission_count: 2, workstream_count: 1, source_present: true },
  { office_id: 'PEGGY_WILSON', display_name: 'Peggy Wilson', mission_count: 1, source_present: false },
] };

test('NACE discloses gaps and maintains office context without inventing receipts', () => {
  const nace = sandbox.NACECognition.create();
  assert.match(nace.briefing(sample), /source is unverified for 1 offices/i);
  assert.match(nace.respond('What next?', sample), /cannot rank live work/i);
  nace.select(sample.offices[0]);
  assert.match(nace.respond('Tell me more', sample), /Chad G. Pennington/);
  assert.match(nace.respond('Show receipts', sample), /No execution receipt feed/);
  assert.match(nace.respond('Brief me', null), /cannot read the Corporate source/);
});

test('Command Floor refreshes source and holds private briefing audio', () => {
  const page = readFileSync(new URL('../command-floor.html', import.meta.url), 'utf8');
  const inline = page.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  assert.ok(inline);
  new vm.Script(inline);
  assert.match(inline, /async function handle\(input\)/);
  assert.match(inline, /snapshot=await read\(\)/);
  assert.match(inline, /I will not answer from stale state/);
  assert.match(inline, /Private source briefings are text-only/);
  assert.doesNotMatch(inline, /lastSourceReply=message/);
});

test('Six office page and backend agree on the activation gate', () => {
  const page = readFileSync(new URL('../office-work.html', import.meta.url), 'utf8');
  const functionSource = readFileSync(new URL('../supabase/functions/pcc-corporate-office-work/index.ts', import.meta.url), 'utf8');
  const cores = readFileSync(new URL('../supabase/functions/pcc-corporate-office-work/actor-cores.ts', import.meta.url), 'utf8');
  const expected = ['ALEXIS_VALE','MICHAEL_CARRINGTON','CHAD_G_PENNINGTON','OLIVER_GRANT','PEGGY_WILSON','SYLVIA_SOMERS'];
  for (const id of expected) { assert.match(page, new RegExp(id)); assert.match(cores, new RegExp(id)); }
  assert.match(functionSource, /if \(!actorCore\) return reply\(\{ error:"OFFICE_NOT_LIVE_IN_THIS_PHASE" \},403\)/);
  assert.doesNotMatch(cores, /WARREN_LONG:/);
  new vm.Script(page.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]);
});
