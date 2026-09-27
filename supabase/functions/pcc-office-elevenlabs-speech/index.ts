import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const origin = "https://command.risingphoenixhq.com";
const cors = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Max-Age": "600", Vary: "Origin",
  "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const encoder = new TextEncoder();
const json = (body: unknown, status: number) => new Response(JSON.stringify(body),
  { status, headers: { ...cors, "Content-Type": "application/json" } });
function bytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")), c => c.charCodeAt(0));
}
async function validSession(token: string, secret: string) {
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0].length > 1024 || parts[1].length > 128) return false;
  try {
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!await crypto.subtle.verify("HMAC", key, bytes(parts[1]), encoder.encode(parts[0]))) return false;
    const payload = JSON.parse(new TextDecoder().decode(bytes(parts[0])));
    return payload.scope === "PCC_REGISTERED_READ" && Number.isFinite(payload.exp) &&
      payload.exp > Date.now() && payload.exp < Date.now() + 10 * 60_000;
  } catch { return false; }
}

Deno.serve(async request => {
  if (request.headers.get("Origin") !== origin) return json({ error: "ORIGIN_DENIED" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const signing = Deno.env.get("PCC_GATE_SIGNING_KEY");
  if (!signing || signing.length < 32) return json({ error: "SESSION_VALIDATION_UNAVAILABLE" }, 503);
  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!await validSession(bearer, signing)) return json({ error: "ENTRY_REQUIRED" }, 401);
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) return json({ error: "JSON_REQUIRED" }, 415);
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return json({ error: "INVALID_REQUEST" }, 400); }
  const persona = String(input.persona_id || "");
  const receiptId = String(input.session_receipt_id || "");
  const text = input.text;
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(persona) || !/^[0-9a-f-]{36}$/i.test(receiptId) ||
    typeof text !== "string" || !text.trim() || text.length > 1800) return json({ error: "INVALID_TURN" }, 400);

  const url = Deno.env.get("SUPABASE_URL"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (!url || !service || !apiKey) return json({ error: "VOICE_SERVICE_UNAVAILABLE" }, 503);
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const resolved = await admin.rpc("pcc_voice_bank_resolve", { p_persona_id: persona, p_surface: "PCC_OFFICE_PILOT" });
  if (resolved.error || !resolved.data || resolved.data.provider !== "elevenlabs")
    return json({ error: "ELEVENLABS_IDENTITY_NOT_ACTIVE" }, 409);
  const voiceId = String(resolved.data.provider_voice_ref || "");
  if (!/^[A-Za-z0-9]{20}$/.test(voiceId)) return json({ error: "INVALID_VOICE_BINDING" }, 409);
  const { data: receipt, error } = await admin.rpc("pcc_voice_office_session_validate", {
    p_session_receipt_id: receiptId, p_persona_id: persona, p_provider_voice_ref: voiceId,
  });
  if (error || !receipt || receipt.persona_id !== persona || receipt.provider !== "elevenlabs" ||
    receipt.provider_voice_ref !== voiceId || receipt.surface !== "PCC_OFFICE_PILOT" ||
    !["PROVIDER_ACCEPTED", "AUDIO_STARTED"].includes(receipt.session_state) ||
    Date.now() - Date.parse(receipt.opened_at) > 10 * 60_000)
    return json({ error: "VOICE_SESSION_NOT_ACTIVE" }, 403);

  // Only an approved office identity can render; text is sent to ElevenLabs for the requested spoken turn.
  const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`, {
    method: "POST", headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text: text.trim(), model_id: "eleven_flash_v2_5" }),
  }).catch(() => null);
  if (!upstream?.ok || !upstream.body) return json({ error: "VOICE_RENDER_FAILED" }, 502);
  return new Response(upstream.body, { status: 200, headers: { ...cors, "Content-Type": "audio/mpeg",
    "X-PCC-Voice-Provider": "elevenlabs", "X-PCC-Persona": persona } });
});
