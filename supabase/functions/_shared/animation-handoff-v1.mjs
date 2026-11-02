const MARKETING_OUTPUTS = new Set(["CORPORATE_MARKETING", "TV_SPOT", "CORPORATE_JINGLE", "TV_COMMERCIAL", "SOCIAL_MEDIA_CAMPAIGN"]);
const NARRATIVE_OUTPUTS = new Set(["EPISODE", "SERIES_EPISODE", "ANIMATION", "MICRO_DRAMA", "NOVEL", "BOOK_MANUSCRIPT", "BOOK_CHAPTER", "BOOK_SCENE"]);
const BOOK_OUTPUTS = new Set(["NOVEL", "BOOK_MANUSCRIPT", "BOOK_CHAPTER", "BOOK_SCENE"]);
const objectOrEmpty = value => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};

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
  if (!job.channel_policy_id || !job.channel_policy_revision || !job.channel_policy_approval_psc_id
    || !job.boas_psc_id || !job.knoas_psc_id
    || !job.boas_id || !job.knoas_id || !job.boas_revision || !job.knoas_revision
    || job.boas_approved !== true || job.knoas_approved !== true) {
    throw new Error("APPROVED_BOAS_KNOAS_REVISIONS_REQUIRED");
  }
  if (!job.script_bundle || job.script_bundle.binary_validation?.ok !== true) throw new Error("BINARY_QA_PASS_REQUIRED");
  const source = job.script_bundle.policy_source_verification;
  const sourceMatches = source?.status === "VERIFIED"
    && source.channel_key === job.channel_key
    && source.output_type === job.output_type
    && source.production_intent === (job.production_intent ?? null)
    && source.policy_id === job.channel_policy_id
    && source.policy_revision === job.channel_policy_revision
    && source.approval_psc_id === job.channel_policy_approval_psc_id
    && source.boas_id === job.boas_id && source.boas_revision === job.boas_revision
    && source.boas_psc_id === job.boas_psc_id
    && source.knoas_id === job.knoas_id && source.knoas_revision === job.knoas_revision
    && source.knoas_psc_id === job.knoas_psc_id
    && Array.isArray(source.evidence_psc_ids)
    && [job.channel_policy_approval_psc_id, job.boas_psc_id, job.knoas_psc_id].every(id => source.evidence_psc_ids.includes(id));
  if (!sourceMatches) throw new Error("VERIFIED_CHANNEL_POLICY_SOURCE_REQUIRED");
  if (!job.review_receipt || job.review_receipt.state !== "SCRIPT_REVIEW_PASSED"
    || !Array.isArray(job.review_receipt.receipts) || !job.review_receipt.receipts.length) {
    throw new Error("REVIEWER_RECEIPT_REQUIRED");
  }
  const intent = resolveProductionIntent(job.output_type, job.production_intent);
  const requestPayload = objectOrEmpty(job.request_payload);
  const writingContext = objectOrEmpty(requestPayload.writing_context);
  const sourceScope = objectOrEmpty(requestPayload.source_scope);
  if (BOOK_OUTPUTS.has(job.output_type)) {
    const chapterScopeMatches = job.output_type !== "BOOK_CHAPTER" && job.output_type !== "BOOK_SCENE"
      || Number.isSafeInteger(writingContext.chapter_number) && sourceScope.chapter_number === String(writingContext.chapter_number);
    const sceneScopeMatches = job.output_type !== "BOOK_SCENE"
      || Number.isSafeInteger(writingContext.scene_number) && sourceScope.scene_number === String(writingContext.scene_number);
    if (typeof writingContext.book_id !== "string" || !writingContext.book_id.trim()
      || sourceScope.book_id !== writingContext.book_id
      || !chapterScopeMatches || !sceneScopeMatches) {
      throw new Error("BOOK_HANDOFF_SOURCE_SCOPE_REQUIRED");
    }
  }
  return {
    contract_version: "PCC_PMF_ANIMATION_HANDOFF_V1",
    request: { request_id: job.job_id, channel_key: job.channel_key, output_type: job.output_type, production_intent: intent, title: job.title, idea: job.idea },
    production_context: {
      series_context: requestPayload.series_context ?? "",
      context_notes: requestPayload.context_notes ?? "",
      desired_ending_or_action: requestPayload.desired_ending_or_action ?? "",
      source_scope: sourceScope,
      writing_context: BOOK_OUTPUTS.has(job.output_type)
        ? { ...writingContext, approved_bible_psc_id: job.knoas_psc_id }
        : writingContext,
    },
    policy_source_verification: source,
    approved_policy: {
      channel_policy_id: job.channel_policy_id,
      channel_policy_revision: job.channel_policy_revision,
      channel_policy_approval_psc_id: job.channel_policy_approval_psc_id,
      boas_id: job.boas_id, boas_revision: job.boas_revision, boas_psc_id: job.boas_psc_id,
      knoas_id: job.knoas_id, knoas_revision: job.knoas_revision, knoas_psc_id: job.knoas_psc_id,
    },
    writer_master_and_segments: job.script_bundle,
    reviewer_receipt: job.review_receipt,
    existing_system_refs: { pmf_job_ref: job.pmf_job_ref ?? null, pve_job_ref: job.pve_job_ref ?? null, png_job_ref: job.png_job_ref ?? null, render_job_ref: job.render_job_ref ?? null },
    admission_snapshot: { pmf_admission: "NOT_ADMITTED", pmf_certification: "NOT_CERTIFIED", render_dispatch: "DISABLED" },
    state: "HELD_PMF_ADMISSION_REQUIRED",
  };
}

