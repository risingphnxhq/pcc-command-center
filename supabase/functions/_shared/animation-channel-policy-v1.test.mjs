import test from "node:test";
import assert from "node:assert/strict";
import { validateAnimationPolicyRegistration, validateResolvedAnimationPolicy } from "./animation-channel-policy-v1.mjs";

const valid = () => ({
  channel_key: "phnx_kids", output_type: "SERIES_EPISODE", production_intent: "NARRATIVE",
  policy_revision: "r1", approval_psc_id: "PSC-APPROVAL-001",
  boas_id: "BOAS-PHXN-KIDS", boas_revision: "v1", boas_psc_id: "PSC-BOAS-001",
  knoas_id: "KNOAS-PHXN-KIDS", knoas_revision: "v1", knoas_psc_id: "PSC-KNOAS-001",
  channel_profile: { audience: "8-10", canon: "approved" },
  output_spec: { minimum_segments: 1, maximum_segments: 12, release_destination:"PHOENIX_KIDS", runtime_policy_psc_id:"PMF-FOUNDER-PSC-PHANIMATION-EPISODE-RUNTIME-CLARIFICATION-2026-10-31-001", min_total_duration_seconds:180, max_total_duration_seconds:300 },
});

test("accepts policy registrations only with immutable BOAS/KNOAS lineage", () => {
  const policy = validateAnimationPolicyRegistration(valid());
  assert.equal(policy.boas_psc_id, "PSC-BOAS-001");
  assert.equal(policy.knoas_psc_id, "PSC-KNOAS-001");
  assert.equal(policy.approval_psc_id, "PSC-APPROVAL-001");
});

test("blocks unapproved or incomplete policy pointers and output limits", () => {
  for (const field of ["approval_psc_id", "boas_id", "boas_revision", "boas_psc_id", "knoas_id", "knoas_revision", "knoas_psc_id"]) {
    const input = valid(); input[field] = "";
    assert.throws(() => validateAnimationPolicyRegistration(input), /POLICY_/);
  }
  const noSpec = valid(); noSpec.output_spec = [];
  assert.throws(() => validateAnimationPolicyRegistration(noSpec), /POLICY_PROFILE_AND_OUTPUT_SPEC_REQUIRED/);
});

test("keeps corporate marketing separate from narrative policy", () => {
  const marketing = valid(); marketing.output_type = "TV_COMMERCIAL"; marketing.production_intent = "MARKETING";
  assert.equal(validateAnimationPolicyRegistration(marketing).production_intent, "MARKETING");
  const mismatch = valid(); mismatch.output_type = "TV_COMMERCIAL"; mismatch.production_intent = "NARRATIVE";
  assert.throws(() => validateAnimationPolicyRegistration(mismatch), /POLICY_INTENT_CONFLICT/);
});

test("resolved policies must match the exact requested channel, format, and lane", () => {
  const policy = { ...valid(), policy_id: "123e4567-e89b-42d3-a456-426614174001", approved: true };
  const resolved = validateResolvedAnimationPolicy(policy, { channel_key: "phnx_kids", output_type: "SERIES_EPISODE", production_intent: "NARRATIVE" });
  assert.equal(resolved.boas_revision, "v1");
  assert.equal(resolved.policy_id, policy.policy_id);
  assert.throws(() => validateResolvedAnimationPolicy(policy, { channel_key: "phnx_faceless", output_type: "SERIES_EPISODE", production_intent: "NARRATIVE" }), /REGISTERED_CHANNEL_POLICY_MISMATCH/);
  assert.throws(() => validateResolvedAnimationPolicy({ ...policy, approved: false }, { channel_key: "phnx_kids", output_type: "SERIES_EPISODE", production_intent: "NARRATIVE" }), /REGISTERED_CHANNEL_POLICY_REQUIRED/);
});

test("binds PHNX Phanimation series policy to PSN's exact 25-minute allocation PSC", () => {
  const input = valid();
  input.channel_key = "phnx_phanimation";
  input.output_spec = {
    release_destination: "PHNX_PHANIMATION",
    runtime_policy_psc_id: "PMF-FOUNDER-PSC-PHANIMATION-PSN-25-MINUTE-EPISODE-ALLOCATION-2026-10-31-001",
    min_total_duration_seconds: 1500,
    target_total_duration_seconds: 1500,
    max_total_duration_seconds: 1500,
  };
  const policy = validateAnimationPolicyRegistration(input);
  assert.equal(policy.output_spec.target_total_duration_seconds, 1500);
  const wrongDuration = { ...input, output_spec: { ...input.output_spec, target_total_duration_seconds: 180 } };
  assert.throws(() => validateAnimationPolicyRegistration(wrongDuration), /POLICY_SERIES_EPISODE_RUNTIME_SPEC_MISMATCH/);
  const wrongPsc = { ...input, output_spec: { ...input.output_spec, runtime_policy_psc_id: "UNAPPROVED" } };
  assert.throws(() => validateAnimationPolicyRegistration(wrongPsc), /POLICY_SERIES_EPISODE_RUNTIME_SPEC_MISMATCH/);
});
