import {validateResolvedAnimationPolicy} from "./animation-channel-policy-v1.mjs";

const isObject=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const POLICY_FIELDS=[
  "channel_key","output_type","production_intent","policy_revision","approval_psc_id",
  "boas_id","boas_revision","boas_psc_id","knoas_id","knoas_revision","knoas_psc_id",
  "policy_id","channel_profile","output_spec",
];
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!isObject(value))return value;
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
}
function equal(left,right){return JSON.stringify(stable(left))===JSON.stringify(stable(right));}

export function animationPolicySnapshot(policy){
  if(!isObject(policy))throw new Error("ANIMATION_POLICY_SNAPSHOT_SOURCE_REQUIRED");
  return Object.freeze(Object.fromEntries(POLICY_FIELDS.map(key=>[key,policy[key]])));
}

/**
 * Resolves the current append-only PCC policy, checks the exact channel/output/lane,
 * and asks the signed PMF bridge to verify its immutable PSC and BOAS registry lineage.
 * Nothing is accepted merely because the PCC row says approved.
 */
export async function resolveTrustedAnimationPolicy({
  request, resolveRegisteredPolicy, verifySource, expectedSnapshot,
}={}){
  if(!isObject(request)
    ||typeof request.channel_key!=="string"
    ||typeof request.output_type!=="string"
    ||typeof request.production_intent!=="string"
    ||typeof resolveRegisteredPolicy!=="function"
    ||typeof verifySource!=="function"){
    throw new Error("ANIMATION_POLICY_RESOLVER_BINDINGS_REQUIRED");
  }
  const raw=await resolveRegisteredPolicy({
    channel_key:request.channel_key,
    output_type:request.output_type,
    production_intent:request.production_intent,
  });
  const policy=validateResolvedAnimationPolicy(raw,request);
  const verification=await verifySource(policy);
  if(!isObject(verification)||verification.status!=="VERIFIED"
    ||verification.channel_key!==policy.channel_key
    ||verification.output_type!==policy.output_type
    ||verification.production_intent!==policy.production_intent
    ||verification.policy_id!==policy.policy_id
    ||verification.policy_revision!==policy.policy_revision
    ||verification.approval_psc_id!==policy.approval_psc_id
    ||verification.boas_id!==policy.boas_id
    ||verification.boas_revision!==policy.boas_revision
    ||verification.boas_psc_id!==policy.boas_psc_id
    ||verification.knoas_id!==policy.knoas_id
    ||verification.knoas_revision!==policy.knoas_revision
    ||verification.knoas_psc_id!==policy.knoas_psc_id
    ||verification.registry_state!=="ACTIVE"
    ||!equal(verification.evidence_psc_ids,[policy.approval_psc_id,policy.boas_psc_id,policy.knoas_psc_id])){
    throw new Error("ANIMATION_POLICY_SOURCE_NOT_VERIFIED");
  }
  const snapshot=animationPolicySnapshot(policy);
  if(expectedSnapshot!==undefined&&(!isObject(expectedSnapshot)||!equal(snapshot,expectedSnapshot))){
    throw new Error("ANIMATION_POLICY_SNAPSHOT_STALE");
  }
  return Object.freeze({policy,snapshot,verification});
}
