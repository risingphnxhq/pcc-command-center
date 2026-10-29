const MAX_ISSUE_CODES = 40;

export function buildReviewerNotificationReceipt(notices, issuedAt = new Date().toISOString()) {
  if (!Array.isArray(notices)) return null;
  const attention = notices.filter((notice) =>
    notice && typeof notice === "object" && notice.type === "SCRIPT_REVIEW_NEEDS_ATTENTION"
  );
  if (!attention.length) return null;
  const issues = attention.flatMap((notice) =>
    Array.isArray(notice.unresolved_issues) ? notice.unresolved_issues : []
  );
  const issueCodes = [...new Set(issues
    .map((issue) => typeof issue?.code === "string" ? issue.code.trim() : "")
    .filter(Boolean))].slice(0, MAX_ISSUE_CODES);
  return {
    event: "SCRIPT_REVIEW_NEEDS_ATTENTION",
    delivery: "PCC_JOB_CARD",
    delivery_state: "RECORDED",
    issued_at: issuedAt,
    unresolved_issue_count: issues.length,
    issue_codes: issueCodes,
  };
}
