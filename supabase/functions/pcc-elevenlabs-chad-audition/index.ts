import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Deployed source is authoritative in Corporate Supabase. This repository copy
// preserves the bounded Chad ElevenLabs audition route for review and rollback.
// Voice IDs come from Corporate PSC reconciliation and remain candidates until
// provider verification and Founder physical acceptance.
const allowedOrigin = "https://command.risingphoenixhq.com";
const encoder = new TextEncoder();
const voices: Record<string, string> = {
  chad_operator: "RXk4kQMwjHHtGkbjGN1A",
  chad_s2s: "QFXXcK8p6cII5Dtt2XE7",
  chad_database_identity: "RXk4kQMNjHHtGKbJGN1A",
  chad_database_mapping: "RXk4kQMWjHHtGKbJGN1A",
};
const cors = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Expose-Headers": "x-pcc-voice-provider, x-pcc-voice-candidate",
  "Access-Control-Max-Age": "600",
  Vary: "Origin",
};
function respond(body: BodyInit | null, status: number, contentType = "application/json", extra: Record<string,string> = {}) {
  return new Response(body, { status, headers: { ...cors, "Content-Type": contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra }});
}
function json(body: unknown, status: number) { return respond(JSON.stringify(body), status); }
function unb64url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (letter) => letter.charCodeAt(0));
}
async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
}
async function validPccSession(token: string, secret: string) {
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0].length > 1024 || parts[1].length > 128) return false;
  try {
    const verified = await crypto.subtle.verify("HMAC", await hmacKey(secret), unb64url(parts[1]), encoder.encode(parts[0]));
    if (!verified) return false;
    const payload = JSON.parse(new TextDecoder().decode(unb64url(parts[0])));
    return payload.scope === "PCC_REGISTERED_READ" && Number.isFinite(payload.exp) && payload.exp > Date.now() && payload.exp < Date.now() + 10 * 60_000;
  } catch { return false; }
}
Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (origin !== allowedOrigin) return json({ error: "ORIGIN_DENIED" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (!["GET", "POST"].includes(request.method)) return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const signingKey = Deno.env.get("PCC_GATE_SIGNING_KEY");
  if (!signingKey || signingKey.length < 32) return json({ error: "PCC_SESSION_VALIDATION_UNAVAILABLE" }, 503);
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!await validPccSession(token, signingKey)) return json({ error: "ENTRY_REQUIRED" }, 401);
  const configured = Boolean(Deno.env.get("ELEVENLABS_API_KEY"));
  if (request.method === "GET") return json({ provider: "elevenlabs", configured, persona_id: "CHAD_G_PENNINGTON", candidates: Object.keys(voices), state: configured ? "READY_FOR_BOUNDED_AUDITION" : "MANAGED_SECRET_REQUIRED" }, 200);
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) return json({ error: "JSON_REQUIRED" }, 415);
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return json({ error: "INVALID_REQUEST" }, 400); }
  if (input.persona_id !== "CHAD_G_PENNINGTON") return json({ error: "PERSONA_NOT_ALLOWED" }, 403);
  const candidate = String(input.candidate || "chad_operator");
  const voiceId = voices[candidate];
  if (!voiceId) return json({ error: "VOICE_CANDIDATE_NOT_ALLOWED" }, 400);
  const text = String(input.text || "").trim();
  if (!text || text.length > 600) return json({ error: "TEXT_LENGTH_INVALID" }, 400);
  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) return json({ error: "ELEVENLABS_MANAGED_SECRET_REQUIRED" }, 503);
  const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128&optimize_streaming_latency=3`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: "eleven_flash_v2_5", voice_settings: { stability: 0.48, similarity_boost: 0.78, style: 0.25, use_speaker_boost: true } }),
  });
  if (!upstream.ok || !upstream.body) {
    const detail = (await upstream.text()).slice(0, 300);
    console.error("ElevenLabs Chad audition failed", upstream.status, detail);
    return json({ error: "ELEVENLABS_RENDER_FAILED", provider_status: upstream.status }, 502);
  }
  return respond(upstream.body, 200, "audio/mpeg", { "X-PCC-Voice-Provider": "elevenlabs", "X-PCC-Voice-Candidate": candidate });
});
