const MARKETING_OUTPUTS = new Set(["CORPORATE_MARKETING", "TV_SPOT", "CORPORATE_JINGLE", "TV_COMMERCIAL", "SOCIAL_MEDIA_CAMPAIGN"]);
const NARRATIVE_OUTPUTS = new Set(["EPISODE", "SERIES_EPISODE", "ANIMATION", "MICRO_DRAMA", "NOVEL", "BOOK_MANUSCRIPT", "BOOK_CHAPTER", "BOOK_SCENE"]);

export function resolveProductionIntent(outputType, suppliedIntent) {
  if (["AD", "REEL"].includes(outputType)) {
    if (!["MARKETING", "NARRATIVE"].includes(suppliedIntent)) throw new Error("PRODUCTION_INTENT_REQUIRED");
    return suppliedIntent;
  }
  if (MARKETING_OUTPUTS.has(outputType)) {
    if (suppliedIntent && suppliedIntent !== "MARKETING") throw new Error("PRODUCTION_INTENT_CONFLICT");
    return "MARKETING";
  }
  if (NARRATIVE_OUTPUTS.has(outputType)) {
    if (suppliedIntent && suppliedIntent !== "NARRATIVE") throw new Error("PRODUCTION_INTENT_CONFLICT");
    return "NARRATIVE";
  }
  if (suppliedIntent && !["MARKETING", "NARRATIVE"].includes(suppliedIntent)) throw new Error("PRODUCTION_INTENT_INVALID");
  return suppliedIntent ?? null;
}

export function validateHandoffSource(job) {
  if (!job || job.status !== "SCRIPT_REVIEW_PASSED") throw new Error("SCRIPT_REVIEW_PASS_REQUIRED");
  if (!job.boas_id || !job.knoas_id || !job.boas_revision || !job.knoas_revision
    || job.boas_approved !== true || job.knoas_approved !== true) {
    throw new Error("APPROVED_BOAS_KNOAS_REVISIONS_REQUIRED");
  }
  if (!job.script_bundle || job.script_bundle.binary_validation?.ok !== true) throw new Error("BINARY_QA_PASS_REQUIRED");
  if (!job.review_receipt || job.review_receipt.state !== "SCRIPT_REVIEW_PASSED"
    || !Array.isArray(job.review_receipt.receipts) || !job.review_receipt.receipts.length) {
    throw new Error("REVIEWER_RECEIPT_REQUIRED");
  }
  const intent = resolveProductionIntent(job.output_type, job.production_intent);
  return {
    contract_version: "PCC_PMF_ANIMATION_HANDOFF_V1",
    request: { request_id: job.job_id, channel_key: job.channel_key, output_type: job.output_type, production_intent: intent, title: job.title, idea: job.idea },
    production_context: { series_context: job.request_payload?.series_context ?? "", context_notes: job.request_payload?.context_notes ?? "", desired_ending_or_action: job.request_payload?.desired_ending_or_action ?? "" },
    approved_policy: {
      boas_id: job.boas_id, boas_revision: job.boas_revision,
      knoas_id: job.knoas_id, knoas_revision: job.knoas_revision,
    },
    writer_master_and_segments: job.script_bundle,
    reviewer_receipt: job.review_receipt,
    existing_system_refs: { pmf_job_ref: job.pmf_job_ref ?? null, pve_job_ref: job.pve_job_ref ?? null, png_job_ref: job.png_job_ref ?? null, render_job_ref: job.render_job_ref ?? null },
    admission_snapshot: { pmf_admission: "NOT_ADMITTED", pmf_certification: "NOT_CERTIFIED", render_dispatch: "DISABLED" },
    state: "HELD_PMF_ADMISSION_REQUIRED",
  };
}
