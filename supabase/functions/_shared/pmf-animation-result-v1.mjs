const utf8 = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX = /^[a-f0-9]{64}$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
const KEY_ID = "pmf-animation-result-v1";

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
}

function constantTimeHexEqual(a, b) {
  if (!HEX.test(a ?? "") || !HEX.test(b ?? "")) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function signPmfAnimationResult(secret, timestamp, nonce, body) {
  if (typeof secret !== "string" || secret.length < 32
      || !Number.isSafeInteger(timestamp) || !UUID.test(nonce ?? "")
      || typeof body !== "string") throw new Error("PMF_RESULT_SIGNATURE_INPUT_INVALID");
  const key = await crypto.subtle.importKey("raw", utf8.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key,
    utf8.encode(String(timestamp) + "\n" + nonce + "\n" + body)));
}

export async function verifyPmfAnimationResultRequest({
  secret, keyId, timestamp, nonce, body, signature, now = Date.now(), maxSkewMs = 60_000,
} = {}) {
  if (typeof secret !== "string" || secret.length < 32 || keyId !== KEY_ID
      || typeof timestamp !== "string" || !/^\d{13}$/.test(timestamp)
      || !UUID.test(nonce ?? "") || typeof body !== "string" || !HEX.test(signature ?? "")
      || !Number.isSafeInteger(now) || !Number.isSafeInteger(maxSkewMs) || maxSkewMs < 0) return false;
  const requestTime = Number(timestamp);
  if (!Number.isSafeInteger(requestTime) || Math.abs(now - requestTime) > maxSkewMs) return false;
  const expected = await signPmfAnimationResult(secret, requestTime, nonce, body);
  return constantTimeHexEqual(expected, signature);
}

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

export function validatePmfAnimationResultEnvelope(envelope) {
  if (!exactKeys(envelope, ["protocol", "action", "receipt"])
      || envelope.protocol !== "pmf-pcc-animation-result/v1"
      || envelope.action !== "RENDER_REVIEW_REQUIRED") throw new Error("PMF_RESULT_ENVELOPE_INVALID");
  const receipt = envelope.receipt;
  if (!exactKeys(receipt, [
    "pcc_request_id", "execution_id", "manifest_psc_id", "result_receipt_id",
    "render_authorization_receipt_id", "state", "quality_approved",
    "distribution_performed", "artifact",
  ]) || !UUID.test(receipt.pcc_request_id ?? "") || !UUID.test(receipt.execution_id ?? "")
      || typeof receipt.manifest_psc_id !== "string" || !ID.test(receipt.manifest_psc_id)
      || typeof receipt.result_receipt_id !== "string" || !ID.test(receipt.result_receipt_id)
      || typeof receipt.render_authorization_receipt_id !== "string" || !ID.test(receipt.render_authorization_receipt_id)
      || receipt.state !== "ANIMATION_RECORDED_REVIEW_REQUIRED"
      || receipt.quality_approved !== false || receipt.distribution_performed !== false) {
    throw new Error("PMF_RESULT_RECEIPT_INVALID");
  }
  const artifact = receipt.artifact;
  if (!exactKeys(artifact, ["storage_ref", "mime_type", "sha256", "bytes"])
      || artifact.storage_ref !== `pmf-animation-private/${receipt.execution_id}/scene.mp4`
      || artifact.mime_type !== "video/mp4" || !HEX.test(artifact.sha256 ?? "")
      || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1 || artifact.bytes > 2_000_000_000) {
    throw new Error("PMF_RESULT_ARTIFACT_INVALID");
  }
  return Object.freeze({
    pcc_request_id: receipt.pcc_request_id,
    execution_id: receipt.execution_id,
    manifest_psc_id: receipt.manifest_psc_id,
    result_receipt_id: receipt.result_receipt_id,
    render_authorization_receipt_id: receipt.render_authorization_receipt_id,
    state: receipt.state,
    quality_approved: false,
    distribution_performed: false,
    artifact: Object.freeze({
      storage_ref: artifact.storage_ref, mime_type: artifact.mime_type,
      sha256: artifact.sha256.toLowerCase(), bytes: artifact.bytes,
    }),
  });
}
