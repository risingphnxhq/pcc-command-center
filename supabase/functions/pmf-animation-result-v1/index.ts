import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import {
  validatePmfAnimationResultEnvelope,
  verifyPmfAnimationResultRequest,
} from "../_shared/pmf-animation-result-v1.mjs";

const KEY_ID = "pmf-animation-result-v1";
const MAX_BODY_BYTES = 16_000;
const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers });
}
async function readBody(req: Request): Promise<string | null> {
  const declared = req.headers.get("content-length");
  if (declared && (!/^\\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "POST_REQUIRED" });
  const secret = Deno.env.get("PMF_ANIMATION_RESULT_HMAC_SECRET") ?? "";
  if (secret.length < 32) return json(503, { ok: false, error: "PMF_ANIMATION_RESULT_NOT_CONFIGURED" });
  let raw: string | null;
  try { raw = await readBody(req); } catch { return json(400, { ok: false, error: "UTF8_BODY_REQUIRED" }); }
  if (raw === null) return json(413, { ok: false, error: "RESULT_BODY_TOO_LARGE" });

  const keyId = req.headers.get("x-pmf-result-key-id") ?? "";
  const timestamp = req.headers.get("x-pmf-result-timestamp") ?? "";
  const nonce = req.headers.get("x-pmf-result-nonce") ?? "";
  const signature = req.headers.get("x-pmf-result-signature") ?? "";
  const verified = await verifyPmfAnimationResultRequest({
    secret, keyId, timestamp, nonce, body: raw, signature,
  });
  if (!verified) return json(401, { ok: false, error: "PMF_RESULT_AUTHENTICATION_FAILED" });

  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return json(400, { ok: false, error: "INVALID_JSON" }); }
  let receipt: Record<string, unknown>;
  try { receipt = validatePmfAnimationResultEnvelope(parsed).receipt as unknown as Record<string, unknown>; }
  catch (error) { return json(400, { ok: false, error: error instanceof Error ? error.message : "PMF_RESULT_INVALID" }); }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json(503, { ok: false, error: "PCC_RESULT_DATABASE_NOT_CONFIGURED" });
  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await service.rpc("pcc_animation_record_render_receipt_v1", {
    p_key_id: keyId, p_nonce: nonce, p_receipt: receipt,
  });
  if (error || !data) return json(409, { ok: false, error: "PCC_RENDER_RECEIPT_REJECTED" });
  return json(202, {
    ok: true,
    state: "REVIEW_REQUIRED",
    result_receipt_id: receipt.result_receipt_id,
    quality_approved: false,
    distribution_performed: false,
  });
});
