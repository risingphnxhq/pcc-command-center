import test from "node:test";
import assert from "node:assert/strict";
import { resolveProductionIntent, validateHandoffSource } from "./animation-handoff-v1.mjs";

const job = {
  job_id: "request-1", status: "SCRIPT_REVIEW_PASSED", channel_key: "phnx_kids",
  output_type: "EPISODE", production_intent: "NARRATIVE", title: "Pilot", idea: "A story",
  boas_id: "boas-kids", boas_revision: "rev-12", boas_approved: true,
  knoas_id: "knoas-kids", knoas_revision: "rev-9", knoas_approved: true,
  script_bundle: { full_script: "Scene.", channel_segments: [{ index: 1 }], binary_validation: { ok: true } },
  review_receipt: { state: "SCRIPT_REVIEW_PASSED", receipts: [{ decision: "PASS" }] },
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
  assert.equal(packet.approved_policy.boas_revision, "rev-12");
  assert.equal(packet.approved_policy.knoas_revision, "rev-9");
  assert.equal(packet.writer_master_and_segments, job.script_bundle);
  assert.equal(packet.reviewer_receipt, job.review_receipt);
  assert.deepEqual(packet.production_context, { series_context: "", context_notes: "", desired_ending_or_action: "" });
  assert.equal(packet.state, "HELD_PMF_ADMISSION_REQUIRED");
  assert.equal(packet.admission_snapshot.render_dispatch, "DISABLED");
  assert.equal("dispatch" in packet, false);
});

test("blocks handoff when any source approval or QA receipt is missing", () => {
  assert.throws(() => validateHandoffSource({ ...job, status: "REVIEW" }), /SCRIPT_REVIEW_PASS_REQUIRED/);
  assert.throws(() => validateHandoffSource({ ...job, knoas_approved: false }), /APPROVED_BOAS_KNOAS_REVISIONS_REQUIRED/);
  assert.throws(() => validateHandoffSource({ ...job, script_bundle: { binary_validation: { ok: false } } }), /BINARY_QA_PASS_REQUIRED/);
  assert.throws(() => validateHandoffSource({ ...job, review_receipt: null }), /REVIEWER_RECEIPT_REQUIRED/);
});
