import test from "node:test";
import assert from "node:assert/strict";
import { resolveProductionIntent, validateHandoffSource } from "./animation-handoff-v1.mjs";

const job = {
  job_id: "request-1", status: "SCRIPT_REVIEW_PASSED", channel_key: "phnx_kids",
  output_type: "EPISODE", production_intent: "NARRATIVE", title: "Pilot", idea: "A story",
  channel_policy_id: "123e4567-e89b-42d3-a456-426614174001",
  channel_policy_revision: "policy-rev-3", channel_policy_approval_psc_id: "PSC-CHANNEL-001",
  boas_psc_id: "PSC-BOAS-001", knoas_psc_id: "PSC-KNOAS-001",
  boas_id: "boas-kids", boas_revision: "rev-12", boas_approved: true,
  knoas_id: "knoas-kids", knoas_revision: "rev-9", knoas_approved: true,
  script_bundle: {
    full_script: "Scene.", channel_segments: [{ index: 1 }], binary_validation: { ok: true },
    policy_source_verification: {
      status: "VERIFIED", channel_key: "phnx_kids", output_type: "EPISODE", production_intent: "NARRATIVE",
      policy_id: "123e4567-e89b-42d3-a456-426614174001", policy_revision: "policy-rev-3",
      approval_psc_id: "PSC-CHANNEL-001", boas_id: "boas-kids", boas_revision: "rev-12", boas_psc_id: "PSC-BOAS-001",
      knoas_id: "knoas-kids", knoas_revision: "rev-9", knoas_psc_id: "PSC-KNOAS-001",
      evidence_psc_ids: ["PSC-CHANNEL-001", "PSC-BOAS-001", "PSC-KNOAS-001"],
    },
  },
  review_receipt: { state: "SCRIPT_REVIEW_PASSED", receipts: [{ decision: "PASS" }] },
  request_payload: { approved_channel_policy_snapshot: { output_spec: { minimum_segments:1, maximum_segments:12 } } },
  pmf_job_ref: null, pve_job_ref: null, png_job_ref: null, render_job_ref: null,
};

test("AD and REEL require a channel's explicit marketing or narrative lane", () => {
  assert.throws(() => resolveProductionIntent("AD", null), /PRODUCTION_INTENT_REQUIRED/);
  assert.equal(resolveProductionIntent("REEL", "NARRATIVE"), "NARRATIVE");
  assert.equal(resolveProductionIntent("AD", "MARKETING"), "MARKETING");
});

test("corporate marketing and story formats resolve to their locked lanes", () => {
  assert.equal(resolveProductionIntent("CORPORATE_MARKETING", null), "MARKETING");
  assert.equal(resolveProductionIntent("TV_SPOT", null), "MARKETING");
  assert.equal(resolveProductionIntent("EPISODE", null), "NARRATIVE");
  assert.throws(() => resolveProductionIntent("EPISODE", "MARKETING"), /PRODUCTION_INTENT_CONFLICT/);
});

test("routes every PSC-approved format to its correct production lane", () => {
  for (const output of ["CORPORATE_MARKETING", "CORPORATE_JINGLE", "TV_SPOT", "TV_COMMERCIAL", "SOCIAL_MEDIA_CAMPAIGN"]) {
    assert.equal(resolveProductionIntent(output, null), "MARKETING", output);
  }
  for (const output of ["EPISODE", "SERIES_EPISODE", "ANIMATION", "MICRO_DRAMA", "NOVEL", "BOOK_MANUSCRIPT", "BOOK_CHAPTER", "BOOK_SCENE"]) {
    assert.equal(resolveProductionIntent(output, null), "NARRATIVE", output);
  }
  assert.equal(resolveProductionIntent("OTHER", null), null);
});

test("builds a complete, held PCC-to-PMF handoff and never dispatches it", () => {
  const packet = validateHandoffSource(job);
  assert.equal(packet.contract_version, "PCC_PMF_ANIMATION_HANDOFF_V1");
  assert.equal(packet.approved_policy.channel_policy_id, job.channel_policy_id);
  assert.equal(packet.approved_policy.channel_policy_revision, "policy-rev-3");
  assert.equal(packet.approved_policy.channel_policy_approval_psc_id, "PSC-CHANNEL-001");
  assert.equal(packet.approved_policy.boas_revision, "rev-12");
  assert.equal(packet.approved_policy.knoas_revision, "rev-9");
  assert.equal(packet.writer_master_and_segments, job.script_bundle);
  assert.equal(packet.policy_source_verification, job.script_bundle.policy_source_verification);
  assert.deepEqual(packet.approved_policy.output_spec, job.request_payload.approved_channel_policy_snapshot.output_spec);
  assert.equal(packet.reviewer_receipt, job.review_receipt);
  assert.deepEqual(packet.production_context, { series_context: "", context_notes: "", desired_ending_or_action: "" });
  assert.equal(packet.state, "HELD_PMF_ADMISSION_REQUIRED");
  assert.equal(packet.admission_snapshot.render_dispatch, "DISABLED");
  assert.equal("dispatch" in packet, false);
});

test("blocks handoff when any source approval or QA receipt is missing", () => {
  assert.throws(() => validateHandoffSource({ ...job, status: "REVIEW" }), /SCRIPT_REVIEW_PASS_REQUIRED/);
  assert.throws(() => validateHandoffSource({ ...job, knoas_approved: false }), /APPROVED_BOAS_KNOAS_REVISIONS_REQUIRED/);
  assert.throws(() => validateHandoffSource({ ...job, channel_policy_approval_psc_id: null }), /APPROVED_BOAS_KNOAS_REVISIONS_REQUIRED/);
  assert.throws(() => validateHandoffSource({ ...job, script_bundle: { binary_validation: { ok: false } } }), /BINARY_QA_PASS_REQUIRED/);
  assert.throws(() => validateHandoffSource({ ...job, review_receipt: null }), /REVIEWER_RECEIPT_REQUIRED/);
  assert.throws(() => validateHandoffSource({ ...job, script_bundle: { ...job.script_bundle, policy_source_verification: null } }), /VERIFIED_CHANNEL_POLICY_SOURCE_REQUIRED/);
  assert.throws(() => validateHandoffSource({ ...job, script_bundle: { ...job.script_bundle, policy_source_verification: { ...job.script_bundle.policy_source_verification, knoas_revision: "stale" } } }), /VERIFIED_CHANNEL_POLICY_SOURCE_REQUIRED/);
  const noOutputSpec={...job,request_payload:{approved_channel_policy_snapshot:{output_spec:null}}};
  assert.throws(()=>validateHandoffSource(noOutputSpec),/APPROVED_OUTPUT_SPEC_REQUIRED/);
  const noEpisodeRuntime={...job,output_type:"SERIES_EPISODE",
    script_bundle:{...job.script_bundle,policy_source_verification:{...job.script_bundle.policy_source_verification,output_type:"SERIES_EPISODE"}},
    request_payload:{approved_channel_policy_snapshot:{output_spec:{}}}};
  assert.throws(()=>validateHandoffSource(noEpisodeRuntime),/APPROVED_EPISODE_RUNTIME_POLICY_REQUIRED/);
});
