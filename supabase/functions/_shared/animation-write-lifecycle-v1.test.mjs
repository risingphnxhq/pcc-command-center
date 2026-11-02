import test from "node:test";
import assert from "node:assert/strict";
import { resolveTrustedAnimationPolicy } from "./animation-channel-policy-runtime-v1.mjs";
import { executeAnimationWriteLifecycle } from "./animation-write-lifecycle-v1.mjs";

const sourceScope = { saga_id: "OCS", book_id: "OCS-BOOK-1", chapter_number: "1" };
const policy = () => ({
  policy_id: "123e4567-e89b-42d3-a456-426614174001",
  channel_key: "phnx_animation", output_type: "BOOK_CHAPTER", production_intent: "NARRATIVE",
  policy_revision: "r7", approval_psc_id: "PSC-APPROVAL-001",
  boas_id: "BOAS-OCS", boas_revision: "v1", boas_psc_id: "PSC-BOAS-001",
  knoas_id: "KNOAS-OCS", knoas_revision: "v3", knoas_psc_id: "PSC-KNOAS-001",
  boas_approved: true, knoas_approved: true,
  channel_profile: { audience: "young-adult" },
  output_spec: { scope: sourceScope, minimum_segments: 1, maximum_segments: 12 },
  approved: true, revoked: false,
});
const verification = (p) => ({
  status: "VERIFIED", channel_key: p.channel_key, output_type: p.output_type,
  production_intent: p.production_intent, policy_id: p.policy_id,
  policy_revision: p.policy_revision, approval_psc_id: p.approval_psc_id,
  boas_id: p.boas_id, boas_revision: p.boas_revision, boas_psc_id: p.boas_psc_id,
  knoas_id: p.knoas_id, knoas_revision: p.knoas_revision, knoas_psc_id: p.knoas_psc_id,
  evidence_psc_ids: [p.approval_psc_id, p.boas_psc_id, p.knoas_psc_id], registry_state: "ACTIVE",
});
const job = () => ({
  job_id: "123e4567-e89b-42d3-a456-426614174099",
  channel_key: "phnx_animation", output_type: "BOOK_CHAPTER", production_intent: "NARRATIVE",
  idea: "Tyrion notices that the systems around him create unequal outcomes.",
  request_payload: {
    source_scope: sourceScope,
    series_context: "Obsidian Core Saga",
    writing_context: {
      saga_id: "OCS", audience: "young-adult", book_id: "OCS-BOOK-1", book_number: 1,
      book_title: "The Awakening", chapter_number: 1, chapter_title: "THE WEIGHT OF SEEING",
      chapter_goal: "Establish Tyrion's question about who designed the systems.",
    },
    desired_ending_or_action: "End with the question: Who will fix it?",
  },
});

async function resolvePolicy(events, request = {}) {
  const raw = policy();
  return await resolveTrustedAnimationPolicy({
    request: {
      channel_key: "phnx_animation", output_type: "BOOK_CHAPTER", production_intent: "NARRATIVE",
      source_scope: sourceScope, ...request,
    },
    resolveRegisteredPolicy: async (match) => { events.push("POLICY_RESOLVE"); assert.deepEqual(match.source_scope, sourceScope); return raw; },
    verifySource: async (current) => { events.push("SOURCE_VERIFY"); return verification(current); },
  });
}

test("runs source-scoped policy resolution through OCS chapter writing, review, and saved receipt", async () => {
  const events = [];
  const trustedPolicy = await resolvePolicy(events);
  let savePayload;
  const chapter = "BOOK 1: THE AWAKENING\\n\\nCHAPTER 1: THE WEIGHT OF SEEING\\n\\nThe city never slept—but at this hour, it whispered.";
  const lifecycle = await executeAnimationWriteLifecycle({
    job: job(), trustedPolicy, canReview: true,
    model: { complete: async ({ mode }) => {
      events.push(mode);
      if (mode === "WRITE_MASTER") return JSON.stringify({
        ending_first: { final_payoff: "Who will fix it?", setup_and_payoff: "Ty's observation of designed systems seeds the final question." },
        logline: "An observant young inventor begins to question who designed the systems around him.",
        synopsis: "Tyrion connects everyday inequities to the logic behind them.", full_script: chapter,
        continuity_ledger: [{ fact: "Tyrion lives in East San Jose.", source: "approved canon" }],
      });
      if (mode === "ADAPT_MASTER") return JSON.stringify({
        chapter_beats: [{ purpose: "Show Tyrion tracing the pattern behind unequal outcomes." }],
        canon_source_notes: ["PSC-KNOAS-001"],
      });
      if (mode === "REVIEW") return JSON.stringify({ decision: "PASS", issues: [], summary: "Chapter preserves the verified source and requested ending." });
      throw new Error(`UNEXPECTED_MODEL_MODE:${mode}`);
    } },
    saveScript: async (payload) => {
      events.push("SAVE_SCRIPT");
      savePayload = payload;
      return { data: { job_id: payload.job_id, status: payload.status }, error: null };
    },
  });

  assert.deepEqual(events, ["POLICY_RESOLVE", "SOURCE_VERIFY", "WRITE_MASTER", "ADAPT_MASTER", "REVIEW", "SAVE_SCRIPT"]);
  assert.equal(lifecycle.result.state, "SCRIPT_REVIEW_PASSED");
  assert.equal(savePayload.script_bundle.sections.complete_chapter, chapter);
  assert.equal(savePayload.script_bundle.source_binding.knoas_revision, "v3");
  assert.deepEqual(savePayload.script_bundle.policy_source_verification.evidence_psc_ids,
    ["PSC-APPROVAL-001", "PSC-BOAS-001", "PSC-KNOAS-001"]);
  assert.equal(savePayload.script_bundle.sections.chapter_beats[0].beat_id,
    "AUTH-123e4567-e89b-42d3-a456-426614174099-CH-BEAT-0001");
  assert.equal(savePayload.can_review, true);
});

test("fails closed before calling the Writer or saving when source evidence is mismatched", async () => {
  const events = [];
  const resolved = await resolvePolicy(events);
  const trustedPolicy = { ...resolved, verification: {
    ...resolved.verification, evidence_psc_ids: ["PSC-APPROVAL-001", "PSC-BOAS-001", "PSC-UNAPPROVED-999"],
  } };
  await assert.rejects(() => executeAnimationWriteLifecycle({
    job: job(), trustedPolicy,
    model: { complete: async () => { events.push("WRITER"); return "{}"; } },
    saveScript: async () => { events.push("SAVE"); return { data: {} }; },
  }), /ANIMATION_POLICY_SOURCE_NOT_VERIFIED/);
  assert.deepEqual(events, ["POLICY_RESOLVE", "SOURCE_VERIFY"]);
});

test("surfaces a failed SAVE_SCRIPT RPC so the handler can fail and hold the job", async () => {
  const events = [];
  const trustedPolicy = await resolvePolicy(events);
  await assert.rejects(() => executeAnimationWriteLifecycle({
    job: job(), trustedPolicy,
    model: { complete: async ({ mode }) => {
      if (mode === "WRITE_MASTER") return JSON.stringify({
        ending_first: { final_payoff: "Who will fix it?", setup_and_payoff: "The observation leads to action." },
        logline: "A systems minded teenager asks who designed the world.", synopsis: "Tyrion sees patterns.",
        full_script: "A complete chapter.", continuity_ledger: [],
      });
      if (mode === "ADAPT_MASTER") return JSON.stringify({ chapter_beats: [{ purpose: "Introduce the central question." }] });
      return JSON.stringify({ decision: "PASS", issues: [], summary: "Pass." });
    } },
    saveScript: async () => ({ data: null, error: { code: "RPC_FAILED" } }),
  }), /ANIMATION_SCRIPT_SAVE_FAILED/);
});
