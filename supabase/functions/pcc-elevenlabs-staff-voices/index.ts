import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Founder-supplied casting IDs. These are candidates, not activated room voices.
const voices: Record<string, string> = {
  ALEXIS_VALE: "AgHBZjWY3b5qxxQ4vcKs", MICHAEL_CARRINGTON: "CZ78DWjyEx9eQimOPqPi",
  CHAD_G_PENNINGTON: "QFXXcK8p6cIl5Dtc2XE7", JORDAN_HALE: "WGINef1wh4Hi6O62bfO8",
  PATRICK_ROSS: "Noo2D0uxFyzbTIA6RY8t", AIDEN_MERCER: "5lm1mr2qVzTTtc8lNLgo",
  REBECCA_LAWSON: "VCUa8W1mPO0QcgrSewvs", OLIVER_GRANT: "tw43HEeA0n5kOjSqCFT9",
  ADRIAN_BLACKWELL: "Gympn2UbmkJD4IHh5kzM", MARCUS_BELL: "3jR9BuQAOPMWUjWpi0ll",
  AVERY_COLE: "KzOeyayOIrEe4EKNJvGq", JULIAN_ROWE: "emNETt9bfkECEZrrqDQS",
  DERRICK_THOMPSON: "lGMJWfnL2SVUwU7i6zQ7", SIMONE_HARPER: "i7vPmJ2yNcoEVAdpHcQa",
  VICTOR_LANG: "aCF7fSyJwGn1etojgoux", PEGGY_WILSON: "FrzKLwOr0y3qieiphjs2",
  SYLVIA_SOMERS: "4RZ84U1b4WCqpu57LvIq", NACE: "H1GhCI6GEKiSXZcwmUkc",
};
const origin = "https://command.risingphoenixhq.com";
const headers = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Max-Age": "600", Vary: "Origin",
  "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const encoder = new TextEncoder();
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}
function bytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")), c => c.charCodeAt(0));
}
async function session(token: string, secret: string) {
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
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (!["GET", "POST"].includes(request.method)) return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const signing = Deno.env.get("PCC_GATE_SIGNING_KEY");
  if (!signing || signing.length < 32) return json({ error: "SESSION_VALIDATION_UNAVAILABLE" }, 503);
  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!await session(bearer, signing)) return json({ error: "ENTRY_REQUIRED" }, 401);
  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) return json({ error: "ELEVENLABS_MANAGED_SECRET_REQUIRED" }, 503);

  let personaId: string;
  if (request.method === "GET") personaId = new URL(request.url).searchParams.get("persona_id") || "";
  else {
    if (!request.headers.get("Content-Type")?.startsWith("application/json")) return json({ error: "JSON_REQUIRED" }, 415);
    let input: Record<string, unknown>;
    try { input = await request.json(); } catch { return json({ error: "INVALID_REQUEST" }, 400); }
    personaId = typeof input.persona_id === "string" ? input.persona_id : "";
  }
  const voiceId = voices[personaId];
  if (!voiceId) return json({ error: "PERSONA_NOT_IN_FOUNDER_VOICE_ROSTER" }, 404);
  const lookup = await fetch(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
    headers: { "xi-api-key": apiKey, Accept: "application/json" },
  }).catch(() => null);
  if (!lookup) return json({ error: "PROVIDER_UNAVAILABLE" }, 502);
  if (!lookup.ok) return json({ error: "VOICE_LOOKUP_FAILED", provider_status: lookup.status, persona_id: personaId }, 502);
  let metadata: { voice_id?: string; name?: string; category?: string };
  try { metadata = await lookup.json(); } catch { return json({ error: "PROVIDER_RESPONSE_UNREADABLE" }, 502); }
  if (metadata.voice_id !== voiceId) return json({ error: "PROVIDER_VOICE_ID_MISMATCH" }, 502);
  if (request.method === "GET") return json({ persona_id: personaId, voice_id: voiceId,
    provider_name: metadata.name, category: metadata.category, state: "PROVIDER_LOOKUP_VERIFIED",
    activation: "UNCHANGED", room_speech: "NOT_CONNECTED" });

  // Fixed short line limits spending and prevents arbitrary text generation under a shared PCC session.
  const rendered = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`, {
    method: "POST", headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text: `This is the bounded voice audition for ${personaId.replaceAll("_", " ")}.`, model_id: "eleven_flash_v2_5" }),
  }).catch(() => null);
  if (!rendered) return json({ error: "PROVIDER_UNAVAILABLE" }, 502);
  if (!rendered.ok || !rendered.body) return json({ error: "VOICE_RENDER_FAILED", provider_status: rendered.status }, 502);
  return new Response(rendered.body, { status: 200, headers: { ...headers, "Content-Type": "audio/mpeg",
    "X-PCC-Voice-Provider": "elevenlabs", "X-PCC-Persona": personaId } });
});
