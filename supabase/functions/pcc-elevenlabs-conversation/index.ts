import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Issues a short-lived provider conversation token only for an approved PCC voice binding.
// The browser never receives the managed ElevenLabs API key or a browser-selected voice ID.
const origin = "https://command.risingphoenixhq.com";
const encoder = new TextEncoder();
const headers = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Max-Age": "600",
  "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Vary: "Origin" };
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { ...headers, "Content-Type": "application/json" } });
}
function bytes(value: string) {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")), c => c.charCodeAt(0));
}
async function validSession(token: string, secret: string) {
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0].length > 2048 || parts[1].length > 128) return false;
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
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const signing = Deno.env.get("PCC_GATE_SIGNING_KEY");
  if (!signing || signing.length < 32) return json({ error: "PCC_SESSION_UNAVAILABLE" }, 503);
  const session = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!await validSession(session, signing)) return json({ error: "ENTRY_REQUIRED" }, 401);
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) return json({ error: "JSON_REQUIRED" }, 415);
  let input: { persona_id?: string; surface?: string; office_id?: string };
  try { input = await request.json(); } catch { return json({ error: "INVALID_REQUEST" }, 400); }
  const persona = input.persona_id || "", surface = input.surface || "";
  const office = surface === "PCC_OFFICE_PILOT" && input.office_id === persona;
  const room = ["PCC_BOARD_ROOM", "PCC_WAR_ROOM"].includes(surface);
  const nace = persona === "NACE" && surface === "PCC_ENTRY";
  if (!/^[A-Z][A-Z0-9_]{2,60}$/.test(persona) || !(office || room || nace))
    return json({ error: "SURFACE_PERSONA_DENIED" }, 403);

  const url = Deno.env.get("SUPABASE_URL"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return json({ error: "VOICE_RESOLVER_UNAVAILABLE" }, 503);
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const resolved = await admin.rpc(room || nace ? "pcc_voice_bank_resolve_surface" : "pcc_voice_bank_resolve",
    { p_persona_id: persona, p_surface: surface });
  const binding = resolved.data as { provider?: string; provider_voice_ref?: string; binding_id?: string } | null;
  if (resolved.error || !binding) return json({ error: "VOICE_IDENTITY_NOT_ACTIVE" }, 404);
  if (binding.provider !== "elevenlabs" || !/^[A-Za-z0-9]{20}$/.test(binding.provider_voice_ref || ""))
    return json({ error: "ELEVENLABS_VOICE_NOT_ACTIVE_FOR_SURFACE" }, 409);

  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  let agents: Record<string, string>;
  try { agents = JSON.parse(Deno.env.get("ELEVENLABS_PCC_AGENT_IDS") || "{}"); }
  catch { return json({ error: "ELEVENLABS_AGENT_CONFIG_INVALID" }, 503); }
  const agent = agents[`${persona}:${surface}`];
  if (!apiKey || !agent || !/^[A-Za-z0-9_]{16,80}$/.test(agent))
    return json({ error: "ELEVENLABS_CONVERSATION_NOT_CONFIGURED" }, 503);
  const voiceId = binding.provider_voice_ref as string;
  const lookup = await fetch(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
    headers: { "xi-api-key": apiKey, Accept: "application/json" },
  }).catch(() => null);
  if (!lookup?.ok) return json({ error: "PROVIDER_VOICE_LOOKUP_FAILED" }, 502);
  let metadata: { voice_id?: string };
  try { metadata = await lookup.json(); } catch { return json({ error: "PROVIDER_RESPONSE_UNREADABLE" }, 502); }
  if (metadata.voice_id !== voiceId) return json({ error: "PROVIDER_VOICE_ID_MISMATCH" }, 502);

  // A dedicated agent has its voice fixed in provider configuration. A browser
  // override cannot change persona or voice after PCC authorization.
  const agentRead = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(agent)}`, {
    headers: { "xi-api-key": apiKey, Accept: "application/json" },
  }).catch(() => null);
  if (!agentRead?.ok) return json({ error: "CONVERSATION_AGENT_UNAVAILABLE" }, 502);
  let agentConfig: { agent_id?: string; conversation_config?: { tts?: { voice_id?: string } } };
  try { agentConfig = await agentRead.json(); } catch { return json({ error: "PROVIDER_RESPONSE_UNREADABLE" }, 502); }
  if (agentConfig.agent_id !== agent || agentConfig.conversation_config?.tts?.voice_id !== voiceId)
    return json({ error: "CONVERSATION_AGENT_VOICE_MISMATCH" }, 409);

  const provider = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(agent)}`, {
    headers: { "xi-api-key": apiKey, Accept: "application/json" },
  }).catch(() => null);
  if (!provider?.ok) return json({ error: "CONVERSATION_TOKEN_FAILED" }, 502);
  let token: { token?: string };
  try { token = await provider.json(); } catch { return json({ error: "PROVIDER_RESPONSE_UNREADABLE" }, 502); }
  if (!token.token) return json({ error: "CONVERSATION_TOKEN_MISSING" }, 502);
  return json({ conversation_token: token.token, persona_id: persona, surface, provider: "elevenlabs",
    provider_voice_ref: voiceId, binding_id: binding.binding_id || null,
    command_execution: false });
});
