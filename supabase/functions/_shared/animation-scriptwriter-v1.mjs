const OUTPUT_TYPES = new Set([
  "EPISODE", "AD", "CORPORATE_MARKETING", "TV_SPOT", "REEL",
  "MICRO_DRAMA", "NOVEL", "BOOK_CHAPTER", "BOOK_SCENE", "OTHER",
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
  if (!p || typeof p !== "object" || !p.boas_id || !p.knoas_id || !p.boas_revision || !p.knoas_revision || p.boas_approved !== true || p.knoas_approved !== true || !p.channel_profile || !p.output_spec) {
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
function normalizedText(value) { return String(value ?? "").trim().replace(/\\s+/g, " "); }

/** Objective pass/fail checks; story quality remains the Reviewer's job. */
export function validateAnimationScript(input, draft) {
  const gates = [];
  const add = (id, ok, detail) => gates.push({ id, result: ok ? "PASS" : "FAIL", detail });
  const p = input?.channel_policy;
  add("REGISTERED_POLICY_IDS", Boolean(p?.boas_id && p?.knoas_id), "BOAS and KNOAS identifiers are required.");
  add("APPROVED_POLICY_REVISIONS", Boolean(p?.boas_revision && p?.knoas_revision && p?.boas_approved === true && p?.knoas_approved === true), "Approved BOAS and KNOAS revisions are required.");
  add("FULL_SCRIPT_PRESENT", typeof draft?.full_script === "string" && Boolean(draft.full_script.trim()), "The complete script must be present.");
  add("ENDING_FIRST_PRESENT", Boolean(draft?.ending_first?.final_payoff?.trim?.()) && Boolean(draft?.ending_first?.setup_and_payoff?.trim?.()), "EFPB payoff and setup/payoff explanation are required.");
  add("CONTINUITY_LEDGER_PRESENT", Array.isArray(draft?.continuity_ledger), "A continuity ledger array is required.");
  const segments = draft?.channel_segments;
  add("CHANNEL_SEGMENTS_PRESENT", Array.isArray(segments) && segments.length > 0, "At least one channel segment is required.");
  if (Array.isArray(segments) && segments.length > 0) {
    add("SEGMENT_ORDER_CONTIGUOUS", segments.every((s, i) => s?.index === i + 1), "Segment indexes must be contiguous and start at 1.");
    const fields = segments.every((s) => typeof s?.purpose === "string" && s.purpose.trim() && typeof s?.script === "string" && s.script.trim() && typeof s?.handoff === "string" && s.handoff.trim() && Number.isFinite(s?.estimated_duration_seconds) && s.estimated_duration_seconds >= 0);
    add("SEGMENT_FIELDS_VALID", fields, "Each segment needs purpose, script, handoff, and a non-negative duration.");
    const joined = normalizedText(segments.map((s) => s?.script ?? "").join(" "));
    const complete = Boolean(normalizedText(draft?.full_script)) && joined === normalizedText(draft?.full_script);
    add("FULL_SCRIPT_SEGMENT_COVERAGE", complete, "Ordered segment text must reproduce the complete script, with whitespace normalized.");
    const spec = p?.output_spec ?? {};
    if (Number.isInteger(spec.minimum_segments)) add("MINIMUM_SEGMENTS", segments.length >= spec.minimum_segments, "Below required minimum segment count.");
    if (Number.isInteger(spec.maximum_segments)) add("MAXIMUM_SEGMENTS", segments.length <= spec.maximum_segments, "Above allowed maximum segment count.");
    if (Number.isFinite(spec.max_segment_duration_seconds)) add("SEGMENT_DURATION_LIMIT", segments.every((s) => Number.isFinite(s?.estimated_duration_seconds) && s.estimated_duration_seconds <= spec.max_segment_duration_seconds), "A segment exceeds the registered duration limit.");
  }
  return { ok: gates.every((gate) => gate.result === "PASS"), gates, failures: gates.filter((gate) => gate.result === "FAIL") };
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
  let draft = first;

  for (let repair = 0; repair <= MAX_REPAIRS; repair++) {
    const binary = validateAnimationScript(input, draft);
    const review = parseObject(await model.complete({
      mode: "REVIEW",
      system: reviewerSystem(),
      user: jsonPrompt({ ...context, script_package: draft, binary_validation: binary, previous_review_receipts: receipts }),
    }), "SCRIPT_REVIEW_JSON_INVALID");
    if (!["PASS", "REVISE", "BLOCK"].includes(review.decision) || !Array.isArray(review.issues)) throw new Error("SCRIPT_REVIEW_SHAPE_INVALID");
    const binaryIssues = binary.failures.map((gate) => ({ severity: "ERROR", code: gate.id, message: gate.detail, correction: "Correct the objective gate and regenerate the complete script package." }));
    const issues = [...review.issues, ...binaryIssues];
    const decision = binary.ok ? review.decision : (review.decision === "BLOCK" ? "BLOCK" : "REVISE");
    const receipt = { attempt: repair + 1, decision, issues, summary: String(review.summary ?? ""), binary_validation: binary };
    receipts.push(receipt);
    const errors = issues.filter((issue) => issue?.severity === "ERROR");
    if (decision === "PASS" && errors.length === 0) {
      return { state: "SCRIPT_REVIEW_PASSED", request_id: input.request_id, script_package: draft, binary_validation: binary, review_receipts: receipts, repair_count: repair };
    }
    if (decision === "BLOCK" || repair === MAX_REPAIRS) {
      const result = { state: "SCRIPT_REVIEW_NEEDS_ATTENTION", request_id: input.request_id, script_package: draft, binary_validation: binary, review_receipts: receipts, repair_count: repair };
      await notify({ type: "SCRIPT_REVIEW_NEEDS_ATTENTION", request_id: input.request_id, channel_key: input.channel_key, unresolved_issues: errors.length ? errors : review.issues });
      return result;
    }
    const revised = parseObject(await model.complete({
      mode: "REVISE",
      system: writerSystem("REVISE"),
      user: jsonPrompt({ ...context, script_package: draft, review_receipt: receipt }),
    }), "SCRIPT_REVISION_JSON_INVALID");
    draft = revised;
  }
  throw new Error("SCRIPT_REVIEW_LOOP_UNREACHABLE");
}
