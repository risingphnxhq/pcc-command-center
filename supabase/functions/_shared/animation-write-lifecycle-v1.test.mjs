import test from "node:test";
import assert from "node:assert/strict";
import { resolveTrustedAnimationPolicy } from "./animation-channel-policy-runtime-v1.mjs";
import { executeAnimationWriteLifecycle } from "./animation-write-lifecycle-v1.mjs";
import { validateHandoffSource } from "./animation-handoff-v1.mjs";
import { postHeldAnimationHandoff } from "./pcc-pmf-bridge-v1.mjs";

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

test("carries a reviewed 25-minute Phanimation episode through the signed held PMF handoff", async () => {
  const animationPolicy = {
    policy_id: "123e4567-e89b-42d3-a456-426614174021",
    channel_key: "phnx_animation", output_type: "SERIES_EPISODE", production_intent: "NARRATIVE",
    policy_revision: "synthetic-r1", approval_psc_id: "PSC-SYNTH-CHANNEL-001",
    boas_id: "BOAS-PHANIMATION-SYNTHETIC", boas_revision: "v1", boas_psc_id: "PSC-SYNTH-BOAS-001",
    knoas_id: "KNOAS-PHANIMATION-SYNTHETIC", knoas_revision: "v1", knoas_psc_id: "PSC-SYNTH-KNOAS-001",
    channel_profile: { audience: "synthetic-fixture" },
    output_spec: { minimum_segments: 10, maximum_segments: 10, max_segment_duration_seconds: 180, max_total_duration_seconds: 1500 },
    approved: true, revoked: false,
  };
  const verification = {
    status: "VERIFIED", channel_key: animationPolicy.channel_key, output_type: animationPolicy.output_type,
    production_intent: animationPolicy.production_intent, policy_id: animationPolicy.policy_id,
    policy_revision: animationPolicy.policy_revision, approval_psc_id: animationPolicy.approval_psc_id,
    boas_id: animationPolicy.boas_id, boas_revision: animationPolicy.boas_revision, boas_psc_id: animationPolicy.boas_psc_id,
    knoas_id: animationPolicy.knoas_id, knoas_revision: animationPolicy.knoas_revision, knoas_psc_id: animationPolicy.knoas_psc_id,
    evidence_psc_ids: [animationPolicy.approval_psc_id, animationPolicy.boas_psc_id, animationPolicy.knoas_psc_id],
    registry_state: "ACTIVE",
  };
  const trustedPolicy = await resolveTrustedAnimationPolicy({
    request: { channel_key: animationPolicy.channel_key, output_type: animationPolicy.output_type,
      production_intent: animationPolicy.production_intent },
    resolveRegisteredPolicy: async () => animationPolicy,
    verifySource: async () => verification,
  });
  const channelSegments = Array.from({ length: 10 }, (_, index) => ({
    index: index + 1, purpose: `Synthetic episode movement ${index + 1}`,
    script: `Synthetic story beat ${index + 1}.`, estimated_duration_seconds: 150,
    handoff: `Continue into movement ${index + 2}.`,
  }));
  const productionBreakdown = channelSegments.map((segment, index) => ({
    segment_index: segment.index, scene_number: index + 1, heading: `SCENE ${index + 1}`,
    duration_seconds: 150, scene_script: segment.script,
    visual_action: `Show the consequence of movement ${index + 1}.`, camera: "Hold a readable medium shot.",
    dialogue: [{ speaker: "Narrator", text: segment.script, delivery: "measured" }],
    sound_cues: [{ cue: "synthetic ambience", start_seconds: 15 }],
    keyframes: [
      { description: `Beginning of movement ${index + 1}.`, frame_fraction: 0 },
      { description: `End of movement ${index + 1}.`, frame_fraction: 1 },
    ],
  }));
  const episodeJob = {
    job_id: "123e4567-e89b-42d3-a456-426614174022",
    channel_key: animationPolicy.channel_key, output_type: animationPolicy.output_type,
    production_intent: animationPolicy.production_intent, title: "Synthetic Phanimation episode",
    idea: "A synthetic story used only to validate the animation production contract.",
    request_payload: {
      series_context: "Synthetic Phanimation series", context_notes: "Synthetic fixture only.",
      desired_ending_or_action: "Resolve the synthetic story question.",
      source_scope: { series_id: "SYNTHETIC-SERIES-001", episode_id: "SYNTHETIC-EPISODE-001" },
      writing_context: { runtime_seconds: 1500, frame_rate: "30/1", music_mux_position: "AFTER_SILENT_ANIMATION" },
    },
  };
  let saved;
  const lifecycle = await executeAnimationWriteLifecycle({
    job: episodeJob, trustedPolicy, canReview: true,
    model: { complete: async ({ mode }) => mode === "WRITE"
      ? JSON.stringify({
        ending_first: { final_payoff: "Resolve the synthetic story question.", setup_and_payoff: "The question is seeded in the opening movement." },
        logline: "A synthetic animation story.", synopsis: "A synthetic story spans ten linked movements.",
        full_script: channelSegments.map(segment => segment.script).join(" "), continuity_ledger: [],
        channel_segments: channelSegments, production_breakdown: productionBreakdown, production_notes: ["Synthetic only."],
      })
      : JSON.stringify({ decision: "PASS", issues: [], summary: "Synthetic 25-minute scene plan passed review." }) },
    saveScript: async payload => { saved = payload; return { data: { job_id: payload.job_id }, error: null }; },
  });
  assert.equal(lifecycle.result.state, "SCRIPT_REVIEW_PASSED");
  assert.equal(lifecycle.result.binary_validation.ok, true);
  assert.equal(productionBreakdown.reduce((seconds, scene) => seconds + scene.duration_seconds, 0), 1500);
  assert.equal(lifecycle.result.binary_validation.gates.find(gate => gate.id === "PRODUCTION_DURATION_LIMIT").result, "PASS");

  const packet = validateHandoffSource({
    ...episodeJob, status: saved.status,
    channel_policy_id: animationPolicy.policy_id, channel_policy_revision: animationPolicy.policy_revision,
    channel_policy_approval_psc_id: animationPolicy.approval_psc_id,
    boas_id: animationPolicy.boas_id, boas_revision: animationPolicy.boas_revision, boas_approved: true,
    boas_psc_id: animationPolicy.boas_psc_id,
    knoas_id: animationPolicy.knoas_id, knoas_revision: animationPolicy.knoas_revision, knoas_approved: true,
    knoas_psc_id: animationPolicy.knoas_psc_id,
    script_bundle: saved.script_bundle, review_receipt: saved.review_receipt,
  });
  assert.equal(packet.writer_master_and_segments.production_breakdown.length, 10);
  assert.deepEqual(packet.policy_source_verification.evidence_psc_ids, verification.evidence_psc_ids);
  assert.equal(packet.production_context.writing_context.runtime_seconds, 1500);
  assert.equal(packet.state, "HELD_PMF_ADMISSION_REQUIRED");

  let requestBody;
  const secret = "0123456789abcdef0123456789abcdef";
  const receipt = { state: "HELD_PMF_ADMISSION_REQUIRED", render_dispatch: "DISABLED", cep_enqueue: "DISABLED" };
  await postHeldAnimationHandoff({
    url: "https://systems.example/functions/v1/pcc-animation-bridge-v1", secret, packet,
    now: 1_800_000_000_000, nonce: "123e4567-e89b-42d3-a456-426614174088",
    fetchImpl: async (url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true, receipt }), { status: 202 });
    },
  });
  assert.equal(requestBody.action, "INTAKE_HELD");
  assert.deepEqual(requestBody.packet, packet);
  assert.equal(requestBody.packet.writer_master_and_segments.full_script, channelSegments.map(segment => segment.script).join(" "));
  assert.equal(requestBody.packet.admission_snapshot.render_dispatch, "DISABLED");
  assert.equal(requestBody.packet.admission_snapshot.pmf_certification, "NOT_CERTIFIED");
});
