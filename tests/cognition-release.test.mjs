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
  assert.match(nace.briefing(sample), /agenda is unavailable until individual Founder sign-in/i);
  const agenda = { open_task_count: 1, current_action_receipt_count: 2, generated_at: '2026-09-29T23:00:00Z', tasks: [{ title:'Bounded Patrick test', assignment_id:'G1-PATRICK-CORP-ENG', state:'ASSIGNED' }] };
  assert.match(nace.respond('What next?', sample, agenda), /Bounded Patrick test/);
  assert.match(nace.respond('Is Patrick working on it?', sample, agenda), /awaiting the worker.s own claim/i);
  assert.doesNotMatch(nace.respond('Is Patrick working on it?', sample, agenda), /Patrick is working/i);
  nace.select(sample.offices[0]);
  assert.match(nace.respond('Tell me more', sample), /Chad G. Pennington/);
  assert.match(nace.respond('Show receipts', sample, agenda), /does not prove independent verification/);
  assert.match(nace.respond('Brief me', null), /cannot read the Corporate source/);
});

test('Command Floor refreshes source and holds private briefing audio', () => {
  const page = readFileSync(new URL('../command-floor.html', import.meta.url), 'utf8');
  const inline = page.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  assert.ok(inline);
  new vm.Script(inline);
  assert.match(inline, /async function handle\(input\)/);
  assert.match(inline, /snapshot=await read\(\)/);
  assert.match(inline, /agenda=await readAgenda\(\)/);
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

test('Corporate command mutations and private agenda require individual Founder identity', () => {
  const gateway = readFileSync(new URL('../supabase/functions/pcc-entry-gateway/index.ts', import.meta.url), 'utf8');
  const consolePage = readFileSync(new URL('../console.html', import.meta.url), 'utf8');
  const sql = readFileSync(new URL('../db/pcc_nace_corporate_agenda.sql', import.meta.url), 'utf8');
  assert.match(gateway, /isNaceAgendaRoute \|\| isCommandBeaconRoute \|\| isTaskCommandRoute \|\| isWorkerCommandRoute \|\| isWorkerProvisionRoute/);
  assert.match(gateway, /admin\.auth\.getUser\(individual\)/);
  assert.match(gateway, /pcc_founder_private_subject/);
  assert.match(consolePage, /X-PCC-Individual-Authorization/);
  assert.doesNotMatch(consolePage, /G1-SYLVIA-SUPPORT/);
  assert.match(sql, /revoke all on function public\.pcc_nace_corporate_agenda\(uuid\) from public, anon, authenticated/);
  new vm.Script(consolePage.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]);
});

test('Founder entry uses the bound individual identity and preserves the directory fallback', () => {
  const gateway = readFileSync(new URL('../supabase/functions/pcc-entry-gateway/index.ts', import.meta.url), 'utf8');
  const entry = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(gateway, /path === "authorize-founder"/);
  assert.match(gateway, /admin\.auth\.getUser\(individual\)/);
  assert.match(gateway, /pcc_founder_private_subject/);
  assert.match(entry, /X-PCC-Individual-Authorization/);
  assert.match(entry, /Use HQ passphrase for directory access/);
  new vm.Script(entry.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]);
});

test('Office work and voice pilot stay on six-office activation scope', () => {
  const officePage = readFileSync(new URL('../office.html', import.meta.url), 'utf8');
  const voice = readFileSync(new URL('../supabase/functions/pcc-voice-realtime-session/index.ts', import.meta.url), 'utf8');
  assert.match(officePage, /liveOfficeIds\.has\(officeId\)/);
  assert.match(voice, /OFFICE_NOT_LIVE_IN_THIS_PHASE/);
  assert.match(voice, /SYLVIA_SOMERS/);
  new vm.Script(officePage.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]);
});
