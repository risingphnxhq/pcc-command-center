import test from "node:test";
import assert from "node:assert/strict";
import {
  signPmfAnimationResult,
  verifyPmfAnimationResultRequest,
  validatePmfAnimationResultEnvelope,
} from "./pmf-animation-result-v1.mjs";

const secret = "0123456789abcdef0123456789abcdef";
const timestamp = "1700000000000";
const nonce = "33333333-3333-4333-8333-333333333333";
const receipt = {
  pcc_request_id: "11111111-1111-4111-8111-111111111111",
  execution_id: "22222222-2222-4222-8222-222222222222",
  manifest_psc_id: "PMF-MANIFEST-1",
  result_receipt_id: "PMF-RECEIPT-1",
  render_authorization_receipt_id: "PCC-AUTH-1",
  state: "ANIMATION_RECORDED_REVIEW_REQUIRED",
  quality_approved: false,
  distribution_performed: false,
  artifact: {
    storage_ref: "pmf-animation-private/22222222-2222-4222-8222-222222222222/scene.mp4",
    mime_type: "video/mp4", sha256: "a".repeat(64), bytes: 1200,
  },
};
const envelope = { protocol: "pmf-pcc-animation-result/v1", action: "RENDER_REVIEW_REQUIRED", receipt };

test("validates the exact private review-only result contract", () => {
  assert.equal(validatePmfAnimationResultEnvelope(envelope).artifact.bytes, 1200);
});
test("rejects a public object, changed execution path, false hash, or approval claim", () => {
  for (const patch of [
    { artifact: { ...receipt.artifact, storage_ref: "https://public.invalid/scene.mp4" } },
    { artifact: { ...receipt.artifact, storage_ref: "pmf-animation-private/other/scene.mp4" } },
    { artifact: { ...receipt.artifact, sha256: "bad" } },
    { quality_approved: true },
    { distribution_performed: true },
  ]) assert.throws(() => validatePmfAnimationResultEnvelope({ ...envelope, receipt: { ...receipt, ...patch } }));
});
test("verifies timestamped HMAC request and fails closed on tampering or stale timestamps", async () => {
  const body = JSON.stringify(envelope);
  const signature = await signPmfAnimationResult(secret, Number(timestamp), nonce, body);
  assert.equal(await verifyPmfAnimationResultRequest({
    secret, keyId: "pmf-animation-result-v1", timestamp, nonce, body, signature, now: Number(timestamp),
  }), true);
  assert.equal(await verifyPmfAnimationResultRequest({
    secret, keyId: "pmf-animation-result-v1", timestamp, nonce, body: body + " ", signature, now: Number(timestamp),
  }), false);
  assert.equal(await verifyPmfAnimationResultRequest({
    secret, keyId: "pmf-animation-result-v1", timestamp, nonce, body, signature, now: Number(timestamp) + 60_001,
  }), false);
});
test("rejects wrong protocol, extra fields, and malformed receipt", () => {
  assert.throws(() => validatePmfAnimationResultEnvelope({ ...envelope, ignored: true }));
  assert.throws(() => validatePmfAnimationResultEnvelope({ ...envelope, action: "PUBLISH" }));
  assert.throws(() => validatePmfAnimationResultEnvelope({
    ...envelope, receipt: { ...receipt, artifact: { ...receipt.artifact, bytes: 0 } },
  }));
});
