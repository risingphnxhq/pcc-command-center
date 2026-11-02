import test from "node:test";
import assert from "node:assert/strict";
import { isTriageOnlyDecision, validateReviewDecision } from "../supabase/functions/pcc-workspace-ingest-v1/review-adjudication.mjs";

const intakeId = "36a012be-559d-4fa1-8a2a-0ae4cfd56df7";
const actionId = "89c1aebd-7f93-4abe-8fe6-2e0d9e145c6c";

test("accepts an explicit triage acceptance without granting execution", () => {
  assert.deepEqual(validateReviewDecision({
    intake_id: intakeId, review_action_id: actionId, decision: "ACCEPTED", reason: "",
  }), {
    intake_id: intakeId, review_action_id: actionId, decision: "ACCEPTED", reason: "",
  });
  assert.equal(isTriageOnlyDecision("ACCEPTED"), true);
});

test("requires a reason for needs-changes and declined decisions", () => {
  for (const decision of ["NEEDS_CHANGES", "DECLINED"]) {
    assert.throws(() => validateReviewDecision({
      intake_id: intakeId, review_action_id: actionId, decision, reason: "  ",
    }), { message: "REVIEW_REASON_REQUIRED" });
  }
});

test("rejects malformed ids, unknown decisions, and oversized reasons", () => {
  assert.throws(() => validateReviewDecision({
    intake_id: "bad", review_action_id: actionId, decision: "ACCEPTED",
  }), { message: "INVALID_INTAKE_ID" });
  assert.throws(() => validateReviewDecision({
    intake_id: intakeId, review_action_id: actionId, decision: "EXECUTE",
  }), { message: "REVIEW_DECISION_INVALID" });
  assert.throws(() => validateReviewDecision({
    intake_id: intakeId, review_action_id: actionId, decision: "ACCEPTED", reason: "x".repeat(2001),
  }), { message: "REVIEW_REASON_TOO_LONG" });
  assert.equal(isTriageOnlyDecision("UNREVIEWED"), false);
});
