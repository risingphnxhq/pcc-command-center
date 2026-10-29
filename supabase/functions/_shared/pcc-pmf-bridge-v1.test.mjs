import test from "node:test";
import assert from "node:assert/strict";
import { postHeldAnimationHandoff } from "./pcc-pmf-bridge-v1.mjs";

const secret = "0123456789abcdef0123456789abcdef";
const packet = {
  state: "HELD_PMF_ADMISSION_REQUIRED",
  admission_snapshot: { render_dispatch: "DISABLED" },
};

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

test("rejects non-HTTPS endpoints and attempts to bypass the PMF hold", async () => {
  await assert.rejects(postHeldAnimationHandoff({ url: "http://systems.example/bridge", secret, packet }), /HTTPS_REQUIRED/);
  await assert.rejects(postHeldAnimationHandoff({ url: "https://systems.example/bridge", secret, packet: { ...packet, state: "READY" } }), /MUST_REMAIN_HELD/);
});

test("does not accept non-held, publishing, or failed bridge receipts", async () => {
  await assert.rejects(postHeldAnimationHandoff({
    url: "https://systems.example/bridge", secret, packet,
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, receipt: { state: "READY", render_dispatch: "ENABLED" } }), { status: 200 }),
  }), /HELD_INTAKE_FAILED/);
});
