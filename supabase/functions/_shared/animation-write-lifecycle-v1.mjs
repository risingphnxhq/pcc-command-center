import { runAnimationScriptwriter } from "./animation-scriptwriter-v1.mjs";
import { buildReviewerNotificationReceipt } from "./reviewer-notice-v1.mjs";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function validateTrustedPolicy(job, trustedPolicy) {
  if (!isObject(job) || !isObject(trustedPolicy) || !isObject(trustedPolicy.policy) || !isObject(trustedPolicy.verification)) {
    throw new Error("ANIMATION_POLICY_SOURCE_NOT_VERIFIED");
  }
  const policy = trustedPolicy.policy;
  const verification = trustedPolicy.verification;
  const expectedEvidence = [policy.approval_psc_id, policy.boas_psc_id, policy.knoas_psc_id];
  if (verification.status !== "VERIFIED"
    || verification.policy_id !== policy.policy_id
    || verification.policy_revision !== policy.policy_revision
    || verification.approval_psc_id !== policy.approval_psc_id
    || verification.channel_key !== policy.channel_key
    || verification.output_type !== policy.output_type
    || verification.production_intent !== policy.production_intent
    || verification.boas_id !== policy.boas_id
    || verification.boas_revision !== policy.boas_revision
    || verification.boas_psc_id !== policy.boas_psc_id
    || verification.knoas_id !== policy.knoas_id
    || verification.knoas_revision !== policy.knoas_revision
    || verification.knoas_psc_id !== policy.knoas_psc_id
    || verification.registry_state !== "ACTIVE"
    || !Array.isArray(verification.evidence_psc_ids)
    || JSON.stringify(verification.evidence_psc_ids) !== JSON.stringify(expectedEvidence)
    || job.channel_key !== policy.channel_key
    || job.output_type !== policy.output_type
    || job.production_intent !== policy.production_intent
    || policy.approved !== true
    || policy.revoked === true) {
    throw new Error("ANIMATION_POLICY_SOURCE_NOT_VERIFIED");
  }
  return { policy, verification };
}

/**
 * Runs the same verified Writer -> Reviewer -> SAVE_SCRIPT lifecycle used by PCC.
 * The caller supplies a persistence adapter so the contract can be tested without
 * invoking Supabase, a model API, or any render/release system.
 */
export async function executeAnimationWriteLifecycle({
  job,
  trustedPolicy,
  canReview = false,
  model,
  notify = async () => {},
  saveScript,
} = {}) {
  if (!job?.job_id || typeof saveScript !== "function") throw new Error("ANIMATION_WRITE_LIFECYCLE_BINDINGS_REQUIRED");
  const { policy, verification } = validateTrustedPolicy(job, trustedPolicy);
  const notices = [];
  const result = await runAnimationScriptwriter({
    request_id: job.job_id,
    channel_key: job.channel_key,
    output_type: job.output_type,
    production_intent: job.production_intent,
    idea: job.idea,
    series_context: job.request_payload?.series_context ?? "",
    source_scope: job.request_payload?.source_scope ?? {},
    writing_context: job.request_payload?.writing_context ?? {},
    context_notes: job.request_payload?.context_notes ?? "",
    desired_ending_or_action: job.request_payload?.desired_ending_or_action ?? "",
    channel_policy: {
      ...policy,
      boas_approved: true,
      knoas_approved: true,
      authorized_psc_ids: verification.evidence_psc_ids,
    },
  }, {
    model,
    notify: async (notice) => {
      notices.push(notice);
      await notify(notice);
    },
  });

  const status = result.state === "SCRIPT_REVIEW_PASSED" ? "SCRIPT_REVIEW_PASSED" : "REVIEW";
  const savePayload = {
    job_id: job.job_id,
    channel_policy_id: policy.policy_id,
    channel_policy_revision: policy.policy_revision,
    channel_policy_approval_psc_id: policy.approval_psc_id,
    boas_id: policy.boas_id,
    boas_revision: policy.boas_revision,
    boas_approved: true,
    boas_psc_id: policy.boas_psc_id,
    knoas_id: policy.knoas_id,
    knoas_revision: policy.knoas_revision,
    knoas_approved: true,
    knoas_psc_id: policy.knoas_psc_id,
    script_bundle: {
      ...result.script_package,
      binary_validation: result.binary_validation,
      repair_count: result.repair_count,
      policy_source_verification: verification,
    },
    review_receipt: {
      state: result.state,
      receipts: result.review_receipts,
      unresolved_issues: result.review_receipts.at(-1)?.issues ?? [],
      notification_receipt: buildReviewerNotificationReceipt(notices),
    },
    status,
    can_review: canReview,
  };
  const saved = await saveScript(savePayload);
  if (saved?.error) throw new Error("ANIMATION_SCRIPT_SAVE_FAILED");
  return { result, saved, savePayload };
}
