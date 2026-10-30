import test from "node:test";
import assert from "node:assert/strict";
import { buildReviewerNotificationReceipt } from "./reviewer-notice-v1.mjs";

test("records an in-PCC notice when the Reviewer leaves blocking issues", () => {
  const receipt = buildReviewerNotificationReceipt([{
    type: "SCRIPT_REVIEW_NEEDS_ATTENTION",
    unresolved_issues: [
      { severity: "ERROR", code: "CONTINUITY" },
      { severity: "ERROR", code: "ENDING_UNEARNED" },
    ],
  }], "2026-10-29T12:00:00.000Z");
  assert.deepEqual(receipt, {
    event: "SCRIPT_REVIEW_NEEDS_ATTENTION",
    delivery: "PCC_JOB_CARD",
    delivery_state: "RECORDED",
    issued_at: "2026-10-29T12:00:00.000Z",
    unresolved_issue_count: 2,
    issue_codes: ["CONTINUITY", "ENDING_UNEARNED"],
  });
});

test("does not create an attention notice when no blocking notification was sent", () => {
  assert.equal(buildReviewerNotificationReceipt([]), null);
  assert.equal(buildReviewerNotificationReceipt([{ type: "OTHER" }]), null);
});

test("deduplicates and bounds issue codes while preserving issue count", () => {
  const issues = Array.from({ length: 50 }, (_, i) => ({ code: i < 2 ? "SAME" : "ISSUE_" + i }));
  const receipt = buildReviewerNotificationReceipt([{ type: "SCRIPT_REVIEW_NEEDS_ATTENTION", unresolved_issues: issues }]);
  assert.equal(receipt.unresolved_issue_count, 50);
  assert.equal(receipt.issue_codes.length, 40);
  assert.equal(receipt.issue_codes[0], "SAME");
});
