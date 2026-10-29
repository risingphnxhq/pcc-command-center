const KEY_ID = "pcc-animation-v1";
const utf8 = new TextEncoder();

function toHex(bytes) {
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
}

async function sign(secret, timestamp, nonce, body) {
  if (!Number.isSafeInteger(timestamp) || !/^[a-f0-9-]{36}$/i.test(nonce)) throw new Error("PMF_BRIDGE_SIGNATURE_INPUT_INVALID");
  const key = await crypto.subtle.importKey("raw", utf8.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, utf8.encode(`${timestamp}\n${nonce}\n${body}`)));
}

function same(left, right) {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((v, i) => same(v, right[i]));
  }
  const a = Object.keys(left).sort(), b = Object.keys(right).sort();
  return a.length === b.length && a.every((key, i) => key === b[i] && same(left[key], right[key]));
}

function validateHttpsEndpoint(url) {
  let endpoint;
  try { endpoint = new URL(url); } catch { throw new Error("PMF_BRIDGE_URL_INVALID"); }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) throw new Error("PMF_BRIDGE_HTTPS_REQUIRED");
  return endpoint;
}

function validPolicy(policy) {
  return policy && typeof policy === "object" && !Array.isArray(policy)
    && typeof policy.channel_key === "string"
    && typeof policy.output_type === "string"
    && typeof policy.production_intent === "string"
    && typeof policy.policy_revision === "string"
    && typeof policy.approval_psc_id === "string"
    && typeof policy.boas_id === "string"
    && typeof policy.boas_revision === "string"
    && typeof policy.boas_psc_id === "string"
    && typeof policy.knoas_id === "string"
    && typeof policy.knoas_revision === "string"
    && typeof policy.knoas_psc_id === "string"
    && typeof policy.policy_id === "string";
}

/** Read-only signed PMF call. A missing or mismatched source blocks script writing. */
export async function resolveVerifiedAnimationPolicySource({
  url, secret, keyId = KEY_ID, policy, fetchImpl = fetch,
  now = Date.now(), nonce = crypto.randomUUID(),
}) {
  if (keyId !== KEY_ID || typeof secret !== "string" || secret.length < 32) {
    throw new Error("PMF_BRIDGE_CONFIGURATION_INVALID");
  }
  if (!validPolicy(policy)) throw new Error("ANIMATION_POLICY_INPUT_INVALID");
  const endpoint = validateHttpsEndpoint(url);
  const body = JSON.stringify({ protocol: "pcc-pmf-animation-bridge/v1", action: "RESOLVE_POLICY", policy });
  const timestamp = String(now);
  const signature = await sign(secret, now, nonce, body);
  const response = await fetchImpl(endpoint.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pcc-bridge-key-id": keyId,
      "x-pcc-bridge-timestamp": timestamp,
      "x-pcc-bridge-nonce": nonce,
      "x-pcc-bridge-signature": signature,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error("PMF_POLICY_RESOLVER_RESPONSE_INVALID"); }
  const verified = result?.verification;
  const expected = {
    status: "VERIFIED",
    channel_key: policy.channel_key,
    output_type: policy.output_type,
    production_intent: policy.production_intent,
    policy_id: policy.policy_id,
    policy_revision: policy.policy_revision,
    approval_psc_id: policy.approval_psc_id,
    boas_id: policy.boas_id,
    boas_revision: policy.boas_revision,
    boas_psc_id: policy.boas_psc_id,
    knoas_id: policy.knoas_id,
    knoas_revision: policy.knoas_revision,
    knoas_psc_id: policy.knoas_psc_id,
    evidence_psc_ids: [policy.approval_psc_id, policy.boas_psc_id, policy.knoas_psc_id],
    registry_state: "ACTIVE",
  };
  if (!response.ok || result?.ok !== true || result?.protocol !== "pcc-pmf-animation-bridge/v1" || !same(verified, expected)) {
    throw new Error("ANIMATION_POLICY_SOURCE_NOT_VERIFIED");
  }
  return verified;
}

/** Signed server-to-server handoff. Returns PMF's receipt; never retries invisibly. */
export async function postHeldAnimationHandoff({
  url, secret, keyId = KEY_ID, packet, fetchImpl = fetch,
  now = Date.now(), nonce = crypto.randomUUID(),
}) {
  if (keyId !== KEY_ID || typeof secret !== "string" || secret.length < 32) {
    throw new Error("PMF_BRIDGE_CONFIGURATION_INVALID");
  }
  const endpoint = validateHttpsEndpoint(url);
  if (!packet || typeof packet !== "object" || Array.isArray(packet)
      || packet.state !== "HELD_PMF_ADMISSION_REQUIRED"
      || packet.admission_snapshot?.render_dispatch !== "DISABLED") {
    throw new Error("PMF_BRIDGE_PACKET_MUST_REMAIN_HELD");
  }
  const body = JSON.stringify({ protocol: "pcc-pmf-animation-bridge/v1", action: "INTAKE_HELD", packet });
  const timestamp = String(now);
  const signature = await sign(secret, now, nonce, body);
  const response = await fetchImpl(endpoint.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pcc-bridge-key-id": keyId,
      "x-pcc-bridge-timestamp": timestamp,
      "x-pcc-bridge-nonce": nonce,
      "x-pcc-bridge-signature": signature,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error("PMF_BRIDGE_RESPONSE_INVALID"); }
  if (!response.ok || result?.ok !== true || result?.receipt?.state !== "HELD_PMF_ADMISSION_REQUIRED"
      || result?.receipt?.render_dispatch !== "DISABLED" || result?.receipt?.cep_enqueue !== "DISABLED") {
    throw new Error("PMF_BRIDGE_HELD_INTAKE_FAILED");
  }
  return result.receipt;
}


/** Signed read-only query of PMF's server-verified production admission state. */
export async function readPmfAnimationProductionReadiness({
  url, secret, keyId = KEY_ID, fetchImpl = fetch,
  now = Date.now(), nonce = crypto.randomUUID(),
}) {
  if (keyId !== KEY_ID || typeof secret !== "string" || secret.length < 32) {
    throw new Error("PMF_BRIDGE_CONFIGURATION_INVALID");
  }
  const endpoint = validateHttpsEndpoint(url);
  const body = JSON.stringify({ protocol: "pcc-pmf-animation-bridge/v1", action: "PRODUCTION_READINESS" });
  const timestamp = String(now);
  const signature = await sign(secret, now, nonce, body);
  const response = await fetchImpl(endpoint.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pcc-bridge-key-id": keyId,
      "x-pcc-bridge-timestamp": timestamp,
      "x-pcc-bridge-nonce": nonce,
      "x-pcc-bridge-signature": signature,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error("PMF_ADMISSION_RESPONSE_INVALID"); }
  const readiness = result?.readiness;
  if (!response.ok || result?.ok !== true
      || result?.protocol !== "pcc-pmf-animation-bridge/v1"
      || result?.action !== "PRODUCTION_READINESS"
      || !readiness || !["PRODUCTION_BLOCKED", "PRODUCTION_ADMITTED"].includes(readiness.state)
      || typeof readiness.production_enabled !== "boolean"
      || !["DISABLED", "REQUIRES_SCOPED_AUTHORIZATION"].includes(readiness.render_dispatch)
      || (readiness.state === "PRODUCTION_BLOCKED"
        && (readiness.production_enabled !== false || readiness.render_dispatch !== "DISABLED"))
      || (readiness.state === "PRODUCTION_ADMITTED"
        && (readiness.production_enabled !== true
          || readiness.render_dispatch !== "REQUIRES_SCOPED_AUTHORIZATION"))) {
    throw new Error("PMF_ADMISSION_RESPONSE_INVALID");
  }
  return Object.freeze({ readiness, contract: result.contract ?? null });
}


/** Ask Systems for an ephemeral private artifact URL after PCC has authorized a reviewer. */
export async function requestPmfAnimationReviewUrl({
  url, secret, keyId = KEY_ID, pccRequestId, executionId, resultReceiptId, artifactSha256,
  fetchImpl = fetch, now = Date.now(), nonce = crypto.randomUUID(),
}) {
  if (keyId !== KEY_ID || typeof secret !== "string" || secret.length < 32) {
    throw new Error("PMF_REVIEW_BRIDGE_CONFIGURATION_INVALID");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pccRequestId ?? "")
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(executionId ?? "")
      || resultReceiptId !== executionId || !HEX.test(artifactSha256 ?? "")) {
    throw new Error("PMF_REVIEW_REQUEST_INVALID");
  }
  const endpoint = validateHttpsEndpoint(url);
  if (endpoint.search || endpoint.hash) throw new Error("PMF_BRIDGE_URL_INVALID");
  const request = {
    pcc_request_id: pccRequestId,
    execution_id: executionId,
    result_receipt_id: resultReceiptId,
    artifact_sha256: artifactSha256.toLowerCase(),
  };
  const body = JSON.stringify({ protocol: "pcc-pmf-animation-bridge/v1", action: "CREATE_RENDER_REVIEW_URL", payload: request });
  const signature = await sign(secret, now, nonce, body);
  const response = await fetchImpl(endpoint.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pcc-bridge-key-id": keyId,
      "x-pcc-bridge-timestamp": String(now),
      "x-pcc-bridge-nonce": nonce,
      "x-pcc-bridge-signature": signature,
    },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error("PMF_REVIEW_URL_RESPONSE_INVALID"); }
  let signed;
  try { signed = new URL(result?.signed_url); } catch { throw new Error("PMF_REVIEW_URL_RESPONSE_INVALID"); }
  let decodedPath;
  try { decodedPath = decodeURIComponent(signed.pathname); } catch { throw new Error("PMF_REVIEW_URL_RESPONSE_INVALID"); }
  const expectedPath = "/storage/v1/object/sign/pmf-animation-private/" + executionId + "/scene.mp4";
  const expiresAt = Date.parse(result?.expires_at);
  if (!response.ok || result?.ok !== true || result?.protocol !== "pcc-pmf-animation-bridge/v1"
      || result?.action !== "CREATE_RENDER_REVIEW_URL" || result?.state !== "REVIEW_REQUIRED"
      || result?.pcc_request_id !== pccRequestId || result?.execution_id !== executionId
      || result?.result_receipt_id !== resultReceiptId || result?.sha256 !== artifactSha256.toLowerCase()
      || result?.mime_type !== "video/mp4" || signed.protocol !== "https:" || signed.origin !== endpoint.origin
      || signed.username || signed.password || signed.hash || decodedPath !== expectedPath
      || !signed.searchParams.has("token") || !Number.isFinite(expiresAt)
      || expiresAt <= now || expiresAt > now + 120_000) {
    throw new Error("PMF_REVIEW_URL_RESPONSE_INVALID");
  }
  return Object.freeze({
    state: "REVIEW_REQUIRED",
    pcc_request_id: pccRequestId,
    execution_id: executionId,
    result_receipt_id: resultReceiptId,
    artifact_sha256: artifactSha256.toLowerCase(),
    mime_type: "video/mp4",
    signed_url: signed.toString(),
    expires_at: new Date(expiresAt).toISOString(),
  });
}
