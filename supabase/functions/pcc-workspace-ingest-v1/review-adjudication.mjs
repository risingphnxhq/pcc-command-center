const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECISIONS = new Set(["ACCEPTED", "NEEDS_CHANGES", "DECLINED"]);

export function validateReviewDecision(input = {}) {
  const intake_id = typeof input.intake_id === "string" ? input.intake_id.trim() : "";
  const review_action_id = typeof input.review_action_id === "string" ? input.review_action_id.trim() : "";
  const decision = typeof input.decision === "string" ? input.decision.trim().toUpperCase() : "";
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!UUID.test(intake_id)) throw new Error("INVALID_INTAKE_ID");
  if (!UUID.test(review_action_id)) throw new Error("INVALID_REVIEW_ACTION_ID");
  if (!DECISIONS.has(decision)) throw new Error("REVIEW_DECISION_INVALID");
  if (reason.length > 2000) throw new Error("REVIEW_REASON_TOO_LONG");
  if ((decision === "NEEDS_CHANGES" || decision === "DECLINED") && !reason) {
    throw new Error("REVIEW_REASON_REQUIRED");
  }
  return { intake_id, review_action_id, decision, reason };
}

export function isTriageOnlyDecision(decision) {
  return DECISIONS.has(decision) && decision !== "UNREVIEWED";
}
