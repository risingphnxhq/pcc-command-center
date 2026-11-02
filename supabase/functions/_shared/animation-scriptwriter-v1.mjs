import { validateProductionBreakdown } from "./animation-production-breakdown-v1.mjs";
const OUTPUT_TYPES = new Set([
  "EPISODE", "SERIES_EPISODE", "ANIMATION", "AD", "REEL", "MICRO_DRAMA",
  "NOVEL", "BOOK_MANUSCRIPT", "BOOK_CHAPTER", "BOOK_SCENE", "CORPORATE_MARKETING",
  "CORPORATE_JINGLE", "TV_SPOT", "TV_COMMERCIAL", "SOCIAL_MEDIA_CAMPAIGN", "OTHER",
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
  const production = validateProductionBreakdown(input.output_type, draft, input);
  gates.push(...production.gates);
  return { ok: gates.every((gate) => gate.result === "PASS"), gates, failures: gates.filter((gate) => gate.result === "FAIL") };
}

function writerSystem(mode) {
  const voice = mode === "REVISE"
    ? "Revise the supplied script to resolve the review issues. Keep approved facts, canon, ending, and voice. Return the complete corrected JSON package only."
    : "You are the RPE Script Writer. Create original, coherent, production-ready work. Follow the supplied registered BOAS and KNOAS exactly; do not invent policy or platform rules. Return JSON only.";
  return `${voice}\n\nUse EFPB (End From Beginning Protocol): if a desired ending or action is supplied, treat it as the target; decide the final payoff first, then derive the character choices, causal turns, setup, and opening that make it earned. Build the complete work before segmentation. Preserve continuity and character motivation. Corporate marketing is marketing and must meet its supplied campaign/audience/brand policy; treat it separately from fictional entertainment.\n\nReturn this exact object shape: {"ending_first":{"final_payoff":"...","setup_and_payoff":"..."},"logline":"...","synopsis":"...","full_script":"...","continuity_ledger":[{"fact":"...","source":"idea or policy"}],"channel_segments":[{"index":1,"purpose":"...","script":"...","estimated_duration_seconds":0,"handoff":"..."}],"production_breakdown":[{"segment_index":1,"scene_number":1,"heading":"...","duration_seconds":5,"scene_script":"...","visual_action":"...","camera":"...","dialogue":[{"speaker":"...","text":"...","delivery":"..."}],"sound_cues":[{"cue":"...","start_seconds":0}],"keyframes":[{"description":"...","frame_fraction":0},{"description":"...","frame_fraction":1}]}],"production_notes":["..."]}. For every video/marketing output, include production_breakdown. Scene numbers are contiguous; map all scene_script text back to its channel segment exactly. Give each scene 2-12 ordered visual keyframes from fraction 0 to 1, visual action, camera direction, bounded duration, explicit dialogue/sound arrays. Do not invent scene, voice, sound, animation, or asset IDs; PMF assigns IDs from approved registries. Segment the complete script to the supplied channel output specification. Never silently omit story beats to fit a format.`;
}

function reviewerSystem() {
  return "You are the independent RPE Script Reviewer. Evaluate the full script and every channel segment against the supplied registered BOAS/KNOAS, channel profile, output specification, and request. Check causal coherence, earned ending, character consistency, continuity, completeness, segmentation, production scene coverage, visual/camera direction, dialogue/sound cues, keyframe progression, audience suitability, and marketing claims where applicable. Treat corporate marketing as marketing. Do not invent missing requirements. Return JSON only: {\"decision\":\"PASS\"|\"REVISE\"|\"BLOCK\",\"issues\":[{\"severity\":\"ERROR\"|\"WARNING\",\"code\":\"...\",\"message\":\"...\",\"correction\":\"...\"}],\"summary\":\"...\"}. PASS only when there are no ERROR issues. BLOCK when policy is missing/conflicting or a safe correction cannot be determined.";
}

const BOOK_OUTPUTS = new Set(["BOOK_MANUSCRIPT", "NOVEL", "BOOK_CHAPTER", "BOOK_SCENE"]);
const BOOK_CONTEXT_FIELDS = {
  BOOK_MANUSCRIPT: ["audience", "book_id", "book_title", "volume_or_story_scope"],
  NOVEL: ["audience", "book_id", "book_title", "volume_or_story_scope"],
  BOOK_CHAPTER: ["audience", "book_id", "book_title", "book_number", "chapter_number", "chapter_title", "chapter_goal"],
  BOOK_SCENE: ["audience", "book_id", "book_title", "book_number", "chapter_number", "scene_number", "scene_goal", "point_of_view"],
};

function validateBookContext(input) {
  const context = input.writing_context;
  if (!context || Array.isArray(context) || typeof context !== "object") throw new Error("BOOK_WRITING_CONTEXT_REQUIRED");
  const fields = BOOK_CONTEXT_FIELDS[input.output_type] ?? [];
  for (const field of fields) {
    const value = context[field];
    if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "") throw new Error(`BOOK_${field.toUpperCase()}_REQUIRED`);
  }
  if (Number.isInteger(context.book_number) && (context.book_number < 1 || context.book_number > 13)
      && String(context.saga_id ?? "").toUpperCase() === "OCS") throw new Error("OCS_BOOK_NUMBER_MUST_BE_1_TO_13");
  const policy = input.channel_policy;
  if (!policy.knoas_psc_id || !Array.isArray(policy.authorized_psc_ids) || !policy.authorized_psc_ids.includes(policy.knoas_psc_id))
    throw new Error("APPROVED_BOOK_BIBLE_PSC_REQUIRED");
  if ((input.output_type === "BOOK_CHAPTER" || input.output_type === "BOOK_SCENE")
      && (!Number.isInteger(context.book_number) || context.book_number < 1 || context.book_number > 13 && String(context.saga_id ?? "").toUpperCase() === "OCS"))
    throw new Error("BOOK_NUMBER_INVALID");
  if (input.output_type === "BOOK_CHAPTER" && (!Number.isInteger(context.chapter_number) || context.chapter_number < 1)) throw new Error("BOOK_CHAPTER_NUMBER_INVALID");
  if (input.output_type === "BOOK_SCENE" && (!Number.isInteger(context.scene_number) || context.scene_number < 1)) throw new Error("BOOK_SCENE_NUMBER_INVALID");
  return context;
}

function authoringId(requestId, kind, index) {
  const safeRequest = requestId.replace(/[^A-Za-z0-9_.:-]/g, "_");
  return `AUTH-${safeRequest}-${kind}-${String(index).padStart(4, "0")}`;
}

function bookSystem(mode, outputType) {
  if (mode === "WRITE_MASTER" || mode === "REVISE_MASTER") {
    return `You are the RPE long-form Playwright. Follow only the verified BOAS/KNOAS policy, approved book-bible PSC, and supplied writing context. Apply End From Beginning Protocol: establish the requested ending/payoff first, then write the complete master. Do not segment or adapt it. Return JSON only with ending_first {final_payoff,setup_and_payoff}, logline, synopsis, full_script, continuity_ledger, character_arc_ledger, and series_arc_contribution. Keep the supplied world facts intact; never invent canon approvals or source PSCs. ${mode === "REVISE_MASTER" ? "Make only the evidence-based corrections in the supplied Reviewer receipt and return a complete new master." : "Write the complete master before any format adaptation."}`;
  }
  if (mode === "ADAPT_MASTER") {
    const instruction = outputType === "BOOK_MANUSCRIPT" || outputType === "NOVEL"
      ? "Return volume_chapter_scene_outline as ordered chapter_number/chapter_title/summary entries, plus continuity_ledger, character_arc_ledger, series_arc_contribution. Do not rewrite the supplied master."
      : outputType === "BOOK_CHAPTER"
        ? "Return chapter_title, chapter_beats (purpose entries), continuity_ledger, canon_source_notes, series_arc_contribution. Do not rewrite the supplied chapter master."
        : "Return scene_beats (purpose entries), entry_state, exit_state, and canon_source_notes. Do not rewrite the supplied scene master.";
    return `You are the format adapter for the RPE Playwright. Adapt the supplied complete master to the requested ${outputType} package using its verified policy and writing context. Preserve master text exactly; return JSON only. ${instruction}`;
  }
  return "You are the independent Reviewer. Evaluate the complete master and adapted book package against the verified policy, approved bible source, EFPB payoff, continuity, character arcs, audience and requested format. Return JSON only: {\"decision\":\"PASS\"|\"REVISE\"|\"BLOCK\",\"issues\":[{\"severity\":\"ERROR\"|\"WARNING\",\"code\":\"...\",\"message\":\"...\",\"correction\":\"...\"}],\"summary\":\"...\"}. PASS only with no ERROR issues; BLOCK if canon/policy conflicts cannot be safely resolved.";
}

async function runBookScriptwriter(input, { model, notify }) {
  validateBookContext(input);
  const policy = input.channel_policy;
  const sourcePscIds = [policy.approval_psc_id, policy.boas_psc_id, policy.knoas_psc_id];
  const writingContext={...input.writing_context,approved_bible_psc_id:policy.knoas_psc_id};
  if (sourcePscIds.some(id => typeof id !== "string" || !id || !policy.authorized_psc_ids.includes(id))) throw new Error("BOOK_POLICY_SOURCE_SET_INCOMPLETE");
  const context = {request_id:input.request_id, channel_key:input.channel_key, output_type:input.output_type,
    idea:input.idea, writing_context:writingContext, series_context:input.series_context ?? "",
    context_notes:input.context_notes ?? "", desired_ending_or_action:input.desired_ending_or_action ?? "", channel_policy:policy};
  const receipts=[]; let revision=0;
  let master=parseObject(await model.complete({mode:"WRITE_MASTER",system:bookSystem("WRITE_MASTER",input.output_type),user:jsonPrompt(context)}),"BOOK_MASTER_JSON_INVALID");
  while (true) {
    if (typeof master.full_script !== "string" || !master.full_script.trim() || typeof master.ending_first?.final_payoff !== "string" || !master.ending_first.final_payoff.trim()
      || typeof master.ending_first?.setup_and_payoff !== "string" || !master.ending_first.setup_and_payoff.trim()
      || !Array.isArray(master.continuity_ledger)) throw new Error("BOOK_MASTER_CONTRACT_INVALID");
    if (writingContext.saga_id === "OCS" && (!Number.isInteger(writingContext.book_number) || writingContext.book_number < 1 || writingContext.book_number > 13))
      throw new Error("OCS_BOOK_NUMBER_MUST_BE_1_TO_13");
    const masterRevision={...master,request_id:input.request_id,revision_id:`MASTER-${input.request_id}-R${revision+1}`,revision_number:revision+1,source_psc_ids:sourcePscIds};
    const adaptation=parseObject(await model.complete({mode:"ADAPT_MASTER",system:bookSystem("ADAPT_MASTER",input.output_type),user:jsonPrompt({...context,complete_master:masterRevision})}),"BOOK_ADAPTATION_JSON_INVALID");
    const chapterTitle=writingContext.chapter_title;
    const sections=input.output_type === "BOOK_MANUSCRIPT" || input.output_type === "NOVEL"
      ? {complete_master_manuscript:masterRevision.full_script,volume_chapter_scene_outline:(adaptation.volume_chapter_scene_outline??[]).map((c,i)=>({...c,chapter_id:authoringId(input.request_id,"CH",i+1)})),continuity_ledger:masterRevision.continuity_ledger,character_arc_ledger:masterRevision.character_arc_ledger??[],series_arc_contribution:masterRevision.series_arc_contribution??adaptation.series_arc_contribution}
      : input.output_type === "BOOK_CHAPTER"
        ? {complete_chapter:masterRevision.full_script,chapter_title:chapterTitle,chapter_beats:(adaptation.chapter_beats??[]).map((b,i)=>({...b,beat_id:authoringId(input.request_id,"CH-BEAT",i+1)})),continuity_ledger:adaptation.continuity_ledger??masterRevision.continuity_ledger,canon_source_notes:adaptation.canon_source_notes??sourcePscIds,series_arc_contribution:masterRevision.series_arc_contribution??adaptation.series_arc_contribution}
        : {complete_scene:masterRevision.full_script,scene_beats:(adaptation.scene_beats??[]).map((b,i)=>({...b,beat_id:authoringId(input.request_id,"SC-BEAT",i+1)})),entry_state:adaptation.entry_state,exit_state:adaptation.exit_state,canon_source_notes:adaptation.canon_source_notes??sourcePscIds};
    const segments=[{index:1,purpose:"Complete book-format master",script:masterRevision.full_script,estimated_duration_seconds:0,handoff:"Book-format package ready for review"}];
    const draft={...masterRevision,channel_segments:segments,sections,authoring_ids:{book_id:writingContext.book_id,chapter_id:chapterTitle?authoringId(input.request_id,"CHAPTER",writingContext.chapter_number??1):undefined}};
    if (input.output_type === "BOOK_CHAPTER" && !chapterTitle) throw new Error("BOOK_CHAPTER_TITLE_REQUIRED");
    if (input.output_type === "BOOK_SCENE") draft.authoring_ids.scene_id=authoringId(input.request_id,"SCENE",writingContext.scene_number);
    if ((input.output_type === "BOOK_MANUSCRIPT" || input.output_type === "NOVEL")
        && (!sections.volume_chapter_scene_outline.length || !sections.character_arc_ledger.length || typeof sections.series_arc_contribution !== "string" || !sections.series_arc_contribution.trim()))
      throw new Error("BOOK_MANUSCRIPT_STRUCTURE_REQUIRED");
    if (input.output_type === "BOOK_CHAPTER" && (!sections.chapter_beats.length || sections.chapter_beats.some(b=>typeof b.purpose!=="string"||!b.purpose.trim())))
      throw new Error("BOOK_CHAPTER_BEATS_REQUIRED");
    if (input.output_type === "BOOK_SCENE" && (!sections.scene_beats.length || sections.scene_beats.some(b=>typeof b.purpose!=="string"||!b.purpose.trim())
        || !sections.entry_state || typeof sections.entry_state!=="object" || !sections.exit_state || typeof sections.exit_state!=="object"))
      throw new Error("BOOK_SCENE_STRUCTURE_REQUIRED");
    const review=parseObject(await model.complete({mode:"REVIEW",system:bookSystem("REVIEW",input.output_type),user:jsonPrompt({...context,complete_master:masterRevision,adapted_package:draft,previous_review_receipts:receipts})}),"BOOK_REVIEW_JSON_INVALID");
    if (!["PASS","REVISE","BLOCK"].includes(review.decision)||!Array.isArray(review.issues)) throw new Error("BOOK_REVIEW_SHAPE_INVALID");
    const errors=review.issues.filter(i=>i?.severity==="ERROR");
    const decision=errors.length&&review.decision==="PASS"?"REVISE":review.decision;
    receipts.push({attempt:revision+1,decision,issues:review.issues,summary:String(review.summary??""),master_revision_id:masterRevision.revision_id});
    if (decision==="PASS"&&!errors.length) return {state:"SCRIPT_REVIEW_PASSED",script_package:{...draft,source_binding:{policy_id:policy.policy_id,policy_revision:policy.policy_revision,approval_psc_id:policy.approval_psc_id,boas_id:policy.boas_id,boas_revision:policy.boas_revision,boas_psc_id:policy.boas_psc_id,knoas_id:policy.knoas_id,knoas_revision:policy.knoas_revision,knoas_psc_id:policy.knoas_psc_id}},binary_validation:{ok:true,gates:[{id:"BOOK_MASTER_ADAPTATION_BINDING",result:"PASS"},{id:"BOOK_POLICY_SOURCE_SET",result:"PASS"},{id:"BOOK_AUTHORING_IDS",result:"PASS"}]},review_receipts:receipts,repair_count:revision,master_revision_id:masterRevision.revision_id};
    if (decision==="BLOCK"||revision>=MAX_REPAIRS) {
      await notify({type:"SCRIPT_REVIEW_NEEDS_ATTENTION",request_id:input.request_id,channel_key:input.channel_key,unresolved_issues:errors.length?errors:review.issues});
      return {state:"SCRIPT_REVIEW_NEEDS_ATTENTION",script_package:{...draft,source_binding:{policy_id:policy.policy_id,policy_revision:policy.policy_revision,approval_psc_id:policy.approval_psc_id,boas_id:policy.boas_id,boas_revision:policy.boas_revision,boas_psc_id:policy.boas_psc_id,knoas_id:policy.knoas_id,knoas_revision:policy.knoas_revision,knoas_psc_id:policy.knoas_psc_id}},binary_validation:{ok:false,gates:[{id:"BOOK_REVIEW",result:"FAIL"}]},review_receipts:receipts,repair_count:revision,master_revision_id:masterRevision.revision_id};
    }
    revision++;
    master=parseObject(await model.complete({mode:"REVISE_MASTER",system:bookSystem("REVISE_MASTER",input.output_type),user:jsonPrompt({...context,prior_master:masterRevision,review_receipt:receipts.at(-1)})}),"BOOK_REVISION_JSON_INVALID");
  }
}

/**
 * Provider-neutral PCC writer/reviewer loop. `model.complete` must return raw JSON.
 * `notify` records unresolved QA notices; it must not dispatch to a publisher.
 */
export async function runAnimationScriptwriter(input, { model, notify = async () => {} }) {
  validateWriterInput(input);
  if (!model || typeof model.complete !== "function") throw new Error("SCRIPT_MODEL_ADAPTER_REQUIRED");
  if (BOOK_OUTPUTS.has(input.output_type)) return await runBookScriptwriter(input, {model, notify});
  const context = {
    request_id: input.request_id,
    channel_key: input.channel_key,
    output_type: input.output_type,
    production_intent: input.production_intent ?? null,
    idea: input.idea,
    series_context: input.series_context ?? "",
    context_notes: input.context_notes ?? "",
    desired_ending_or_action: input.desired_ending_or_action ?? "",
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
