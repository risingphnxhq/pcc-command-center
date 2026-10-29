import test from "node:test";
import assert from "node:assert/strict";
import { runAnimationScriptwriter, validateAnimationScript, validateWriterInput } from "./animation-scriptwriter-v1.mjs";

const input = {
  request_id: "req-123", channel_key: "phnx_kids", output_type: "EPISODE", idea: "A phoenix helps a child solve a problem.",
  channel_policy: { boas_id: "boas-kids-v1", boas_revision: "boas-rev-1", boas_approved: true, knoas_id: "knoas-kids-v1", knoas_revision: "knoas-rev-1", knoas_approved: true, channel_profile: { audience: "children" }, output_spec: { segments: "episode scenes" } },
};
const good = (payoff = "The child teaches the phoenix to ask for help.") => ({
  ending_first: { final_payoff: payoff, setup_and_payoff: "The early mistake teaches the ending lesson." },
  logline: "A child and phoenix solve a problem together.", synopsis: "The child learns to ask for help.", full_script: "Scene 1... Scene 2...",
  continuity_ledger: [{ fact: "The phoenix is curious", source: "idea" }],
  channel_segments: [{ index: 1, purpose: "Opening", script: "Scene 1... Scene 2...", estimated_duration_seconds: 30, handoff: "Scene 2" }], production_notes: [],
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
