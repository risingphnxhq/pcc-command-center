import test from "node:test";
import assert from "node:assert/strict";
import { runAnimationScriptwriter, validateAnimationScript, validateWriterInput } from "./animation-scriptwriter-v1.mjs";

const input = {
  request_id: "req-123", channel_key: "phnx_kids", output_type: "EPISODE", idea: "A phoenix helps a child solve a problem.",
  channel_policy: { policy_id:"POLICY-1", policy_revision:"1", approval_psc_id:"APPROVAL-PSC-1", boas_id: "boas-kids-v1", boas_revision: "boas-rev-1", boas_approved: true, boas_psc_id:"BOAS-PSC-1", knoas_id: "knoas-kids-v1", knoas_revision: "knoas-rev-1", knoas_approved: true, knoas_psc_id:"KNOAS-PSC-1", authorized_psc_ids:["APPROVAL-PSC-1","BOAS-PSC-1","KNOAS-PSC-1","OCS-BIBLE-PSC-1"], channel_profile: { audience: "children" }, output_spec: { segments: "episode scenes" } },
};
const good = (payoff = "The child teaches the phoenix to ask for help.") => ({
  ending_first: { final_payoff: payoff, setup_and_payoff: "The early mistake teaches the ending lesson." },
  logline: "A child and phoenix solve a problem together.", synopsis: "The child learns to ask for help.", full_script: "Scene 1... Scene 2...",
  continuity_ledger: [{ fact: "The phoenix is curious", source: "idea" }],
  channel_segments: [{ index: 1, purpose: "Opening", script: "Scene 1... Scene 2...", estimated_duration_seconds: 30, handoff: "Scene 2" }],
  production_breakdown: [{ segment_index: 1, scene_number: 1, heading: "EXT. FOREST - DAY", duration_seconds: 30, scene_script: "Scene 1... Scene 2...", visual_action: "The child and phoenix solve the problem together.", camera: "Wide to medium, steady push-in.", dialogue: [], sound_cues: [], keyframes: [{ description: "They see the problem.", frame_fraction: 0 }, { description: "They solve it together.", frame_fraction: 1 }] }],
  production_notes: [],
});
const raw = (value) => JSON.stringify(value);

test("accepts the same production types as PCC intake", () => {
  for (const output_type of ["EPISODE","SERIES_EPISODE","ANIMATION","AD","REEL","MICRO_DRAMA","NOVEL","BOOK_MANUSCRIPT","BOOK_CHAPTER","BOOK_SCENE","CORPORATE_MARKETING","CORPORATE_JINGLE","TV_SPOT","TV_COMMERCIAL","SOCIAL_MEDIA_CAMPAIGN","OTHER"]) {
    assert.equal(validateWriterInput({ ...input, output_type }).output_type, output_type);
  }
  assert.throws(() => validateWriterInput({ ...input, output_type: "UNSUPPORTED" }), /WRITER_OUTPUT_TYPE_UNSUPPORTED/);
});

test("requires registered BOAS/KNOAS policy before writing", async () => {
  await assert.rejects(() => runAnimationScriptwriter({ ...input, channel_policy: null }, { model: { complete: async () => "{}" } }), /REGISTERED_BOAS_KNOAS_POLICY_REQUIRED/);
});

test("requires approved immutable BOAS and KNOAS revisions before writing", async () => {
  await assert.rejects(() => runAnimationScriptwriter({
    ...input, channel_policy: { ...input.channel_policy, knoas_approved: false },
  }, { model: { complete: async () => "{}" } }), /REGISTERED_BOAS_KNOAS_POLICY_REQUIRED/);
});

test("carries series, canon or campaign context, and desired ending into the Writer and Reviewer", async () => {
  const contextualInput = { ...input, series_context: "Obsidian Core Saga, Book 1", context_notes: "Use the approved saga canon.", desired_ending_or_action: "End with the betrayal revealed." };
  const replies = [raw(good()), raw({ decision: "PASS", issues: [], summary: "Coherent and policy-aligned." })];
  const sent = [];
  await runAnimationScriptwriter(contextualInput, { model: { complete: async ({ user }) => { sent.push(JSON.parse(user)); return replies.shift(); } } });
  assert.equal(sent[0].series_context, contextualInput.series_context);
  assert.equal(sent[0].context_notes, contextualInput.context_notes);
  assert.equal(sent[0].desired_ending_or_action, contextualInput.desired_ending_or_action);
  assert.equal(sent[1].desired_ending_or_action, contextualInput.desired_ending_or_action);
});

test("returns a passed script package with a review receipt", async () => {
  const replies = [raw(good()), raw({ decision: "PASS", issues: [], summary: "Coherent and policy-aligned." })];
  const result = await runAnimationScriptwriter(input, { model: { complete: async () => replies.shift() } });
  assert.equal(result.state, "SCRIPT_REVIEW_PASSED");
  assert.equal(result.script_package.ending_first.final_payoff, "The child teaches the phoenix to ask for help.");
  assert.equal(result.review_receipts.length, 1);
});

test("repairs a flagged script and notifies only when two corrections still fail", async () => {
  const replies = [
    raw(good("The phoenix wins without the child.")), raw({ decision: "REVISE", issues: [{ severity: "ERROR", code: "ENDING_UNEARNED", message: "The child has no agency.", correction: "Give the child the decisive action." }], summary: "Repair needed." }),
    raw(good()), raw({ decision: "PASS", issues: [], summary: "Fixed." }),
  ];
  const result = await runAnimationScriptwriter(input, { model: { complete: async ({ mode }) => { assert.ok(["WRITE", "REVIEW", "REVISE"].includes(mode)); return replies.shift(); } } });
  assert.equal(result.state, "SCRIPT_REVIEW_PASSED");
  assert.equal(result.repair_count, 1);
});

test("sends a notice and holds rather than halting the queue after repair limit", async () => {
  const replies = [raw(good()), ...Array.from({ length: 5 }, (_, i) => i % 2 === 0
    ? raw({ decision: "REVISE", issues: [{ severity: "ERROR", code: "CONTINUITY", message: "Contradiction.", correction: "Fix continuity." }], summary: "Still inconsistent." })
    : raw(good()))];
  const notices = [];
  const result = await runAnimationScriptwriter(input, { model: { complete: async () => replies.shift() }, notify: async (notice) => notices.push(notice) });
  assert.equal(result.state, "SCRIPT_REVIEW_NEEDS_ATTENTION");
  assert.equal(result.repair_count, 2);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].type, "SCRIPT_REVIEW_NEEDS_ATTENTION");
});

test("binary validator rejects incomplete segment coverage even if the AI reviewer passes", () => {
  const draft = good();
  draft.channel_segments[0].script = "Scene 1";
  const result = validateAnimationScript(input, draft);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((gate) => gate.id === "FULL_SCRIPT_SEGMENT_COVERAGE"));
});

test("book chapter writes the complete master before adaptation and preserves it with stable authoring IDs", async () => {
  const bookInput={...input,output_type:"BOOK_CHAPTER",writing_context:{saga_id:"OCS",audience:"Young adult",book_id:"OCS-BOOK-1",book_number:1,book_title:"The Awakening",chapter_number:1,chapter_title:"THE WEIGHT OF SEEING",chapter_goal:"Introduce Tyrion's central question.",approved_bible_psc_id:"OCS-BIBLE-PSC-1"}};
  const chapter="BOOK 1: THE AWAKENING\\n\\nCHAPTER 1: THE WEIGHT OF SEEING\\n\\nThe city never slept—but at this hour, it whispered.";
  const calls=[];
  const result=await runAnimationScriptwriter(bookInput,{model:{complete:async({mode})=>{
    calls.push(mode);
    if(mode==="WRITE_MASTER")return raw({ending_first:{final_payoff:"Who will fix it?",setup_and_payoff:"The question is seeded by the systems Ty observes."},logline:"A young inventor traces unfair systems.",synopsis:"Ty confronts the cost of seeing clearly.",full_script:chapter,continuity_ledger:[{fact:"Ty lives in East San Jose.",source:"approved canon"}],character_arc_ledger:[{character_id:"TYRION",start_state:"Observant",end_state:"Ready to act"}],series_arc_contribution:"Begins the saga's design question."});
    if(mode==="ADAPT_MASTER")return raw({chapter_beats:[{purpose:"Establish the city and Ty's burden."},{purpose:"Reveal the unanswered betrayal."}],canon_source_notes:["OCS-BIBLE-PSC-1"],series_arc_contribution:"Begins the saga's design question."});
    if(mode==="REVIEW")return raw({decision:"PASS",issues:[],summary:"Chapter package preserves the master and approved source binding."});
    throw new Error("UNEXPECTED_MODEL_MODE:"+mode);
  }}});
  assert.deepEqual(calls,["WRITE_MASTER","ADAPT_MASTER","REVIEW"]);
  assert.equal(result.state,"SCRIPT_REVIEW_PASSED");
  assert.equal(result.script_package.sections.complete_chapter,chapter);
  assert.equal(result.script_package.sections.chapter_title,"THE WEIGHT OF SEEING");
  assert.equal(result.script_package.source_binding.knoas_revision,"knoas-rev-1");
  assert.match(result.script_package.sections.chapter_beats[0].beat_id,/AUTH-req-123-CH-BEAT-0001/);
});
