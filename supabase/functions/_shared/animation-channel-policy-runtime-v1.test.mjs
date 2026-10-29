import test from "node:test";
import assert from "node:assert/strict";
import {animationPolicySnapshot,resolveTrustedAnimationPolicy} from "./animation-channel-policy-runtime-v1.mjs";

const makePolicy=()=>({
  policy_id:"123e4567-e89b-42d3-a456-426614174001",
  channel_key:"phnx_kids",output_type:"SERIES_EPISODE",production_intent:"NARRATIVE",
  policy_revision:"r1",approval_psc_id:"PSC-CHANNEL-001",boas_id:"BOAS-PHXN-KIDS",
  boas_revision:"v1",boas_psc_id:"PSC-BOAS-001",knoas_id:"KNOAS-PHXN-KIDS",
  knoas_revision:"v1",knoas_psc_id:"PSC-KNOAS-001",
  channel_profile:{audience:"8-10"},output_spec:{minimum_segments:1,maximum_segments:12},
  approved:true,revoked:false,
});
const request=()=>({channel_key:"phnx_kids",output_type:"SERIES_EPISODE",production_intent:"NARRATIVE"});
const verification=p=>({
  status:"VERIFIED",channel_key:p.channel_key,output_type:p.output_type,production_intent:p.production_intent,
  policy_id:p.policy_id,policy_revision:p.policy_revision,approval_psc_id:p.approval_psc_id,
  boas_id:p.boas_id,boas_revision:p.boas_revision,boas_psc_id:p.boas_psc_id,
  knoas_id:p.knoas_id,knoas_revision:p.knoas_revision,knoas_psc_id:p.knoas_psc_id,
  evidence_psc_ids:[p.approval_psc_id,p.boas_psc_id,p.knoas_psc_id],registry_state:"ACTIVE",
});
const run=(overrides={})=>{
 const policy=overrides.policy??makePolicy();
 return resolveTrustedAnimationPolicy({
  request:overrides.request??request(),
  resolveRegisteredPolicy:async()=>overrides.raw===undefined?policy:overrides.raw,
  verifySource:async()=>overrides.source===undefined?verification(policy):overrides.source,
  ...(overrides.expectedSnapshot===undefined?{}:{expectedSnapshot:overrides.expectedSnapshot}),
 });
};

test("resolves exact current policy and returns immutable snapshot plus source receipt",async()=>{
 const result=await run();
 assert.equal(result.snapshot.policy_id,makePolicy().policy_id);
 assert.equal(result.verification.status,"VERIFIED");
});
test("fails closed for absent or unapproved registry policy",async()=>{
 await assert.rejects(()=>run({raw:null}),/REGISTERED_CHANNEL_POLICY_REQUIRED/);
 await assert.rejects(()=>run({raw:{...makePolicy(),approved:false}}),/REGISTERED_CHANNEL_POLICY_REQUIRED/);
});
test("fails closed for request channel, format, or intent mismatch",async()=>{
 await assert.rejects(()=>run({request:{...request(),channel_key:"phnx_faceless"}}),/REGISTERED_CHANNEL_POLICY_MISMATCH/);
 await assert.rejects(()=>run({request:{...request(),output_type:"REEL"}}),/REGISTERED_CHANNEL_POLICY_MISMATCH/);
});
test("requires trusted PMF PSC and BOAS source verification",async()=>{
 await assert.rejects(()=>run({source:{status:"UNVERIFIED"}}),/ANIMATION_POLICY_SOURCE_NOT_VERIFIED/);
});
test("does not silently switch a queued job to a newer policy revision",async()=>{
 const snapshot={...animationPolicySnapshot(makePolicy()),policy_revision:"r0"};
 await assert.rejects(()=>run({expectedSnapshot:snapshot}),/ANIMATION_POLICY_SNAPSHOT_STALE/);
});
test("snapshot excludes mutable approval flags but binds full policy content",()=>{
 const policy=makePolicy();
 const snapshot=animationPolicySnapshot(policy);
 assert.equal("approved" in snapshot,false);
 assert.equal(snapshot.output_spec.maximum_segments,12);
});
