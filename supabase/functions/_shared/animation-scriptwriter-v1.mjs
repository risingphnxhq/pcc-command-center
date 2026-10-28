const OUTPUT_TYPES = new Set([
  "EPISODE", "AD", "CORPORATE_MARKETING", "TV_SPOT", "REEL",
  "MICRO_DRAMA", "NOVEL", "BOOK_CHAPTER", "BOOK_SCENE",
]);
const MAX_REPAIRS = 2;

/** Require the channel policy produced by PCC's trusted BOAS/KNOAS resolver. */
export function validateWriterInput(input) {
  if (!input || typeof input !== "object") throw new Error("WRITER_INPUT_REQUIRED");
  for (const field of ["request_id", "channel_key", "output_type", "idea"]) {
    if (typeof input[field] !== "string" || !input[field].trim()) throw new Error(`WRITER_${field.toUpperCase()}_REQUIRED`);
  }
  if (!OUTPUT_TYPES.has(input.output_type)) throw new Error("WRITER_OUTPUT_TYPE_UNSUPPORTED");
  const p = input.channel_policy;
  if (!p || typeof p !== "object" || !p.boas_id || !p.knoas_id || !p.channel_profile || !p.output_spec) {
    throw new Error("REGISTERED_BOAS_KNOAS_POLICY_REQUIRED");
  }
  return input;
}

function jsonPrompt(value) { return JSON.stringify(value, null, 2); }
function parseObject(raw, errorCode) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error(errorCode); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error(errorCode);
  return parsed;
}
function validateDraft(draft) {
  const ending = draft.ending_first;
  if (!ending || typeof ending.final_payoff !== "string" || !ending.final_payoff.trim()) throw new Error("SCRIPT_ENDING_REQUIRED");
  for (const key of ["logline", "synopsis", "full_script"]) {
    if (typeof draft[key] !== "string" || !draft[key].trim()) throw new Error(`SCRIPT_${key.toUpperCase()}_REQUIRED`);
  }
  if (!Array.isArray(draft.channel_segments) || draft.channel_segments.length === 0) throw new Error("CHANNEL_SEGMENTS_REQUIRED");
  if (!Array.isArray(draft.continuity_ledger)) throw new Error("CONTINUITY_LEDGER_REQUIRED");
  return draft;
}

function writerSystem(mode) {
  const voice = mode === "REVISE"
    ? "Revise the supplied script to resolve the review issues. Keep approved facts, canon, ending, and voice. Return the complete corrected JSON package only."
    : "You are the RPE Script Writer. Create original, coherent, production-ready work. Follow the supplied registered BOAS and KNOAS exactly; do not invent policy or platform rules. Return JSON only.";
  return `${voice}\n\nUse EFPB (End From Beginning Protocol): decide the final payoff first, then derive the character choices, causal turns, setup, and opening that make it earned. Build the complete work before segmentation. Preserve continuity and character motivation. Corporate marketing is marketing and must meet its supplied campaign/audience/brand policy; treat it separately from fictional entertainment.\n\nReturn this exact object shape: {"ending_first":{"final_payoff":"...","setup_and_payoff":"..."},"logline":"...","synopsis":"...","full_script":"...","continuity_ledger":[{"fact":"...","source":"idea or policy"}],"channel_segments":[{"index":1,"purpose":"...","script":"...","estimated_duration_seconds":0,"handoff":"..."}],"production_notes":["..."]}. Segment the complete script to the supplied channel output specification. Never silently omit story beats to fit a format.`;
}

function reviewerSystem() {
  return "You are the independent RPE Script Reviewer. Evaluate the full script and every channel segment against the supplied registered BOAS/KNOAS, channel profile, output specification, and request. Check causal coherence, earned ending, character consistency, continuity, completeness, segmentation, audience suitability, and marketing claims where applicable. Treat corporate marketing as marketing. Do not invent missing requirements. Return JSON only: {\"decision\":\"PASS\"|\"REVISE\"|\"BLOCK\",\"issues\":[{\"severity\":\"ERROR\"|\"WARNING\",\"code\":\"...\",\"message\":\"...\",\"correction\":\"...\"}],\"summary\":\"...\"}. PASS only when there are no ERROR issues. BLOCK when policy is missing/conflicting or a safe correction cannot be determined.";
}

/**
 * Provider-neutral PCC writer/reviewer loop. `model.complete` must return raw JSON.
 * `notify` records unresolved QA notices; it must not dispatch to a publisher.
 */
export async function runAnimationScriptwriter(input, { model, notify = async () => {} }) {
  validateWriterInput(input);
  if (!model || typeof model.complete !== "function") throw new Error("SCRIPT_MODEL_ADAPTER_REQUIRED");
  const context = {
    request_id: input.request_id,
    channel_key: input.channel_key,
    output_type: input.output_type,
    idea: input.idea,
    series_context: input.series_context ?? {},
    channel_policy: input.channel_policy,
  };
  const receipts = [];
  const first = parseObject(await model.complete({ mode: "WRITE", system: writerSystem("WRITE"), user: jsonPrompt(context) }), "SCRIPT_WRITER_JSON_INVALID");
  let draft = validateDraft(first);

  for (let repair = 0; repair <= MAX_REPAIRS; repair++) {
    const review = parseObject(await model.complete({
      mode: "REVIEW",
      system: reviewerSystem(),
      user: jsonPrompt({ ...context, script_package: draft, previous_review_receipts: receipts }),
    }), "SCRIPT_REVIEW_JSON_INVALID");
    if (!["PASS", "REVISE", "BLOCK"].includes(review.decision) || !Array.isArray(review.issues)) throw new Error("SCRIPT_REVIEW_SHAPE_INVALID");
    const receipt = { attempt: repair + 1, decision: review.decision, issues: review.issues, summary: String(review.summary ?? "") };
    receipts.push(receipt);
    const errors = review.issues.filter((issue) => issue?.severity === "ERROR");
    if (review.decision === "PASS" && errors.length === 0) {
      return { state: "SCRIPT_REVIEW_PASSED", request_id: input.request_id, script_package: draft, review_receipts: receipts, repair_count: repair };
    }
    if (review.decision === "BLOCK" || repair === MAX_REPAIRS) {
      const result = { state: "SCRIPT_REVIEW_NEEDS_ATTENTION", request_id: input.request_id, script_package: draft, review_receipts: receipts, repair_count: repair };
      await notify({ type: "SCRIPT_REVIEW_NEEDS_ATTENTION", request_id: input.request_id, channel_key: input.channel_key, unresolved_issues: errors.length ? errors : review.issues });
      return result;
    }
    const revised = parseObject(await model.complete({
      mode: "REVISE",
      system: writerSystem("REVISE"),
      user: jsonPrompt({ ...context, script_package: draft, review_receipt: receipt }),
    }), "SCRIPT_REVISION_JSON_INVALID");
    draft = validateDraft(revised);
  }
  throw new Error("SCRIPT_REVIEW_LOOP_UNREACHABLE");
}
