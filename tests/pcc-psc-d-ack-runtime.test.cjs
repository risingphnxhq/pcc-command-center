// PCC Gate 2 containment regression tests. Run: node --test tests/pcc-psc-d-ack-runtime.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "..", "pcc-psc-d-ack-runtime.js"), "utf8");
const FOREMAN = "PCC-CSE-PSC-STREAM-FOREMAN-V0-PCC-CONSTRUCTION-CONTINUITY-2026-10-05-001";
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness({ authenticated = true, projection = null } = {}) {
  const listeners = {}, events = {}, calls = [];
  const elements = Object.fromEntries(["pscDState","pscDOutput","pscDAckButton","pscDReconcileButton","pscDRunAcceptanceButton"].map(id => [id,{disabled:false,textContent:"",className:"",addEventListener:(event,fn)=>{events[id+":"+event]=fn;}}]));
  const session = authenticated ? {access_token:"TEST_TOKEN"} : null;
  const defaultProjection = {ok:true,actor_id:"RPE-MASON-HQ",data:{continuity_state:"RECONCILIATION_REQUIRED",foreman:{psc_id:FOREMAN,canon_state:"CONTROLLING"},stream:{system_stream_id:"ORG-PCC-006"},boas:{boas_root_id:"BOAS-ROOT-ORG-PCC-006",system_stream_id:"ORG-PCC-006",build_control_id:"PCC-BCR-PCC-RECONCILIATION-000001"},build_control:{build_control_id:"PCC-BCR-PCC-RECONCILIATION-000001",build_owner_actor_id:"RPE-MASON-HQ",system_stream_id:"ORG-PCC-006",boas_root_id:"BOAS-ROOT-ORG-PCC-006"},gates:[{gate_code:"2",state:"IN_PROGRESS"}],psc_d:{actor_id:"RPE-MASON-HQ"}}};
  const client = {auth:{getSession:async()=>({data:{session}}),onAuthStateChange:fn=>{listeners.auth=fn;}}};
  const context = {window:{supabase:{createClient:()=>client},addEventListener:(event,fn)=>{listeners[event]=fn;}},document:{getElementById:id=>elements[id]||null},fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>projection||defaultProjection};},sessionStorage:{removeItem:()=>{},getItem:()=>null},console};
  vm.runInNewContext(source,context);
  return {elements,events,listeners,calls};
}

test("login event reads continuity but never commits PSC-D", async()=>{
  const h=harness();h.listeners["pcc:systems-runtime-verified"]();await tick();await tick();
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].body.scope,"CONTINUITY");
  assert.match(h.calls[0].url,/pcc-systems-read-v1/);
  assert.equal(h.elements.pscDAckButton.disabled,true);
});
test("unauthenticated recovery fails closed without network calls",async()=>{
  const h=harness({authenticated:false});await h.events["pscDReconcileButton:click"]();
  assert.equal(h.calls.length,0);assert.match(h.elements.pscDState.textContent,/CONTEXT_REHYDRATION_REQUIRED/);
});
test("incomplete continuity denies acceptance",async()=>{
  const h=harness({projection:{ok:true,actor_id:"RPE-MASON-HQ",data:{continuity_state:"CONTEXT_REHYDRATION_REQUIRED"}}});
  await h.events["pscDReconcileButton:click"]();
  assert.equal(h.elements.pscDAckButton.disabled,true);
  assert.match(h.elements.pscDState.textContent,/CONTEXT_REHYDRATION_REQUIRED/);
});
test("explicit ACK never calls sync function without server acceptance",async()=>{
  const h=harness();await h.events["pscDReconcileButton:click"]();
  h.events["pscDAckButton:click"]();
  assert.equal(h.calls.length,1);
  assert.match(h.elements.pscDState.textContent,/ACK BLOCKED/);
});
test("successful read-only recovery is not successor certification",async()=>{
  const h=harness();await h.events["pscDRunAcceptanceButton:click"]();
  assert.match(h.elements.pscDState.textContent,/NOT CERTIFIED/);
  assert.equal(h.elements.pscDAckButton.disabled,true);
});

test("wrong institutional actor rejects recovered projection",async()=>{
  const h=harness({projection:{ok:true,actor_id:"UNKNOWN_ACTOR",data:{continuity_state:"RECONCILIATION_REQUIRED"}}});
  await h.events["pscDReconcileButton:click"]();
  assert.match(h.elements.pscDState.textContent,/CONTEXT_REHYDRATION_REQUIRED/);
  assert.equal(h.elements.pscDAckButton.disabled,true);
});
test("logout disables ACK and requires authenticated session",async()=>{
  const h=harness();h.listeners.auth("SIGNED_OUT",null);
  assert.equal(h.elements.pscDAckButton.disabled,true);
  assert.match(h.elements.pscDState.textContent,/AUTHENTICATED SYSTEMS SESSION REQUIRED/);
});
test("repeated acceptance clicks never invoke PSC-D writer",async()=>{
  const h=harness();
  await h.events["pscDRunAcceptanceButton:click"]();
  await h.events["pscDRunAcceptanceButton:click"]();
  h.events["pscDAckButton:click"]();
  assert.equal(h.calls.length,2);
  assert.ok(h.calls.every(call=>call.body.scope==="CONTINUITY" && call.url.includes("pcc-systems-read-v1")));
});
