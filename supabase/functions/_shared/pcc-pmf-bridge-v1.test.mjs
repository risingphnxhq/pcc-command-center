import test from "node:test";
import assert from "node:assert/strict";
import { postHeldAnimationHandoff, resolveVerifiedAnimationPolicySource } from "./pcc-pmf-bridge-v1.mjs";

const secret = "0123456789abcdef0123456789abcdef";
const policy = {
  policy_id: "123e4567-e89b-42d3-a456-426614174001",
  channel_key: "phnx_kids", output_type: "SERIES_EPISODE", production_intent: "NARRATIVE",
  policy_revision: "r1", approval_psc_id: "PSC-CHANNEL-001",
  boas_id: "BOAS-PHXN-KIDS", boas_revision: "v1", boas_psc_id: "PSC-BOAS-001",
  knoas_id: "KNOAS-PHXN-KIDS", knoas_revision: "v1", knoas_psc_id: "PSC-KNOAS-001",
  channel_profile: { audience: "8-10" }, output_spec: { minimum_segments: 1 },
};
const verification = {
  status: "VERIFIED", channel_key: policy.channel_key, output_type: policy.output_type,
  production_intent: policy.production_intent, policy_id: policy.policy_id,
  policy_revision: policy.policy_revision, approval_psc_id: policy.approval_psc_id,
  boas_id: policy.boas_id, boas_revision: policy.boas_revision, boas_psc_id: policy.boas_psc_id,
  knoas_id: policy.knoas_id, knoas_revision: policy.knoas_revision, knoas_psc_id: policy.knoas_psc_id,
  evidence_psc_ids: [policy.approval_psc_id, policy.boas_psc_id, policy.knoas_psc_id],
  registry_state: "ACTIVE",
};
const packet = {
  state: "HELD_PMF_ADMISSION_REQUIRED",
  admission_snapshot: { render_dispatch: "DISABLED" },
};

test("sends a signed source-resolution request and accepts only exact verified provenance", async () => {
  let sent;
  const result = await resolveVerifiedAnimationPolicySource({
    url: "https://systems.example/functions/v1/pcc-animation-bridge-v1",
    secret, policy, now: 1793222400000, nonce: "11111111-1111-4111-8111-111111111111",
    fetchImpl: async (url, options) => {
      sent = { url, options };
      return new Response(JSON.stringify({ ok: true, protocol: "pcc-pmf-animation-bridge/v1", verification }), { status: 200 });
    },
  });
  assert.deepEqual(result, verification);
  assert.equal(JSON.parse(sent.options.body).action, "RESOLVE_POLICY");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signature = Uint8Array.from(sent.options.headers["x-pcc-bridge-signature"].match(/.{2}/g), byte => parseInt(byte, 16));
  assert.equal(await crypto.subtle.verify("HMAC", key, signature,
    new TextEncoder().encode(`${sent.options.headers["x-pcc-bridge-timestamp"]}\n${sent.options.headers["x-pcc-bridge-nonce"]}\n${sent.options.body}`)), true);
});

test("rejects missing, failed, or mismatched source evidence", async () => {
  await assert.rejects(resolveVerifiedAnimationPolicySource({
    url: "https://systems.example/bridge", secret, policy,
    fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: "ANIMATION_POLICY_SOURCE_NOT_VERIFIED" }), { status: 409 }),
  }), /ANIMATION_POLICY_SOURCE_NOT_VERIFIED/);
  await assert.rejects(resolveVerifiedAnimationPolicySource({
    url: "https://systems.example/bridge", secret, policy,
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, protocol: "pcc-pmf-animation-bridge/v1", verification: { ...verification, channel_key: "rpe" } }), { status: 200 }),
  }), /ANIMATION_POLICY_SOURCE_NOT_VERIFIED/);
});

test("rejects non-HTTPS endpoints, incomplete policy, and bad bridge configuration", async () => {
  await assert.rejects(resolveVerifiedAnimationPolicySource({ url: "http://systems.example/bridge", secret, policy }), /HTTPS_REQUIRED/);
  await assert.rejects(resolveVerifiedAnimationPolicySource({ url: "https://systems.example/bridge", secret, policy: {} }), /INPUT_INVALID/);
  await assert.rejects(resolveVerifiedAnimationPolicySource({ url: "https://systems.example/bridge", secret: "short", policy }), /CONFIGURATION_INVALID/);
});

test("sends a signed held-intake envelope and accepts only PMF held receipt", async () => {
  let sent;
  const receipt = {
    request_id: "123e4567-e89b-42d3-a456-426614174000",
    state: "HELD_PMF_ADMISSION_REQUIRED", render_dispatch: "DISABLED", cep_enqueue: "DISABLED",
  };
  const output = await postHeldAnimationHandoff({
    url: "https://systems.example/functions/v1/pcc-animation-bridge-v1",
    secret, packet, now: 1793222400000, nonce: "11111111-1111-4111-8111-111111111111",
    fetchImpl: async (url, options) => {
      sent = { url, options };
      return new Response(JSON.stringify({ ok: true, receipt }), { status: 202 });
    },
  });
  assert.deepEqual(output, receipt);
  assert.equal(sent.url, "https://systems.example/functions/v1/pcc-animation-bridge-v1");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signature = Uint8Array.from(sent.options.headers["x-pcc-bridge-signature"].match(/.{2}/g), byte => parseInt(byte, 16));
  assert.equal(await crypto.subtle.verify("HMAC", key, signature,
    new TextEncoder().encode(`${sent.options.headers["x-pcc-bridge-timestamp"]}\n${sent.options.headers["x-pcc-bridge-nonce"]}\n${sent.options.body}`)), true);
});

test("rejects attempts to bypass the PMF hold or accepts a non-held receipt", async () => {
  await assert.rejects(postHeldAnimationHandoff({ url: "http://systems.example/bridge", secret, packet }), /HTTPS_REQUIRED/);
  await assert.rejects(postHeldAnimationHandoff({ url: "https://systems.example/bridge", secret, packet: { ...packet, state: "READY" } }), /MUST_REMAIN_HELD/);
  await assert.rejects(postHeldAnimationHandoff({
    url: "https://systems.example/bridge", secret, packet,
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, receipt: { state: "READY", render_dispatch: "ENABLED" } }), { status: 200 }),
  }), /HELD_INTAKE_FAILED/);
});
