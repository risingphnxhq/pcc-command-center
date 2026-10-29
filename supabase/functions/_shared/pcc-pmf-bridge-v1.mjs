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

/** Signed server-to-server handoff. Returns PMF's receipt; never retries invisibly. */
export async function postHeldAnimationHandoff({
  url, secret, keyId = KEY_ID, packet, fetchImpl = fetch,
  now = Date.now(), nonce = crypto.randomUUID(),
}) {
  if (keyId !== KEY_ID || typeof secret !== "string" || secret.length < 32) {
    throw new Error("PMF_BRIDGE_CONFIGURATION_INVALID");
  }
  let endpoint;
  try { endpoint = new URL(url); } catch { throw new Error("PMF_BRIDGE_URL_INVALID"); }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) {
    throw new Error("PMF_BRIDGE_HTTPS_REQUIRED");
  }
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
