import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const origin = "https://command.risingphoenixhq.com";
const voiceId = "H1GhCI6GEKiSXZcwmUkc";
const encoder = new TextEncoder();
const headers = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type", Vary: "Origin", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body),
  { status, headers: { ...headers, "Content-Type": "application/json" } });
const decode = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), c => c.charCodeAt(0));
async function valid(token: string, secret: string) {
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0].length > 2048 || parts[1].length > 128) return false;
  try {
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!await crypto.subtle.verify("HMAC", key, decode(parts[1]), encoder.encode(parts[0]))) return false;
    const p = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    return p.scope === "PCC_REGISTERED_READ" && Number.isFinite(p.exp) && p.exp > Date.now() && p.exp < Date.now() + 600_000;
  } catch { return false; }
}
type Work = { title?: string; priority?: string; linked_mission_id?: string };
type Office = { office_id?: string; display_name?: string; workstreams?: Work[]; missions?: unknown[] };
function buildBrief(snapshot: { state_class?: string; offices?: Office[]; office_count?: number; unlinked_workstream_count?: number }) {
  if (snapshot.state_class !== "REGISTERED_NOT_RUNTIME_CERTIFIED" || !Array.isArray(snapshot.offices)) throw Error("SOURCE_UNVERIFIED");
  const offices = snapshot.offices;
  const missions = offices.reduce((n, o) => n + (o.missions?.length || 0), 0);
  const priority = offices.flatMap(o => (o.workstreams || [])
    .filter(w => w.priority === "PRIORITY_ZERO" && w.linked_mission_id && w.title)
    .map(w => ({ name: String(o.display_name || o.office_id || "").slice(0, 80), work: String(w.title).slice(0, 120) })))
    .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 2);
  const count = Number(snapshot.office_count);
  const missing = Number(snapshot.unlinked_workstream_count);
  return [
    "Phoenix King, NACE here. Your entry is verified.",
    `The Corporate registry currently shows ${Number.isSafeInteger(count) && count >= 0 ? count : offices.length} offices and ${missions} missions. These are registered records, not a live operational health check.`,
    ...priority.map(p => `I suggest speaking with ${p.name} about ${p.work}.`),
    ...(Number.isSafeInteger(missing) && missing > 0 ? [`${missing} workstreams are not linked to a mission and need review.`] : []),
    "I do not have a verified live Systems health feed or complete company performance feed in this briefing. Ask me for a specific Corporate source or enter the Command Floor for registered detail.",
  ].join(" ").slice(0, 1100);
}
Deno.serve(async request => {
  if (request.headers.get("Origin") !== origin) return json({ error: "ORIGIN_DENIED" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST" || new URL(request.url).pathname.split("/").pop() !== "briefing") return json({ error: "ROUTE_NOT_FOUND" }, 404);
  const signing = Deno.env.get("PCC_GATE_SIGNING_KEY");
  if (!signing || signing.length < 32) return json({ error: "ENTRY_VALIDATION_UNAVAILABLE" }, 503);
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!await valid(token, signing)) return json({ error: "ENTRY_REQUIRED" }, 401);
  const source = await fetch("https://ttkceizmjeckrorhkhfr.supabase.co/functions/v1/pcc-entry-gateway/snapshot",
    { headers: { Origin: origin, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000) }).catch(() => null);
  if (!source?.ok) return json({ error: source?.status === 401 ? "ENTRY_REQUIRED" : "CORPORATE_SOURCE_UNAVAILABLE" }, source?.status === 401 ? 401 : 503);
  let snapshot: Record<string, unknown>;
  try { snapshot = await source.json(); } catch { return json({ error: "CORPORATE_SOURCE_UNAVAILABLE" }, 503); }
  let text: string;
  try { text = buildBrief(snapshot); } catch { return json({ error: "CORPORATE_SOURCE_UNVERIFIED" }, 503); }
  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) return json({ error: "VOICE_SERVICE_UNAVAILABLE", text }, 503);
  const rendered = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`, {
    method: "POST", headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: "eleven_flash_v2_5" }), signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!rendered?.ok) return json({ error: "VOICE_RENDER_FAILED", text }, 502);
  const audio = new Uint8Array(await rendered.arrayBuffer());
  if (audio.length > 2_000_000) return json({ error: "VOICE_RESPONSE_TOO_LARGE", text }, 502);
  let binary = "";
  for (let i = 0; i < audio.length; i += 8192) binary += String.fromCharCode(...audio.subarray(i, i + 8192));
  return json({ persona: "NACE", surface: "PCC_ENTRY", text, as_of: snapshot.as_of,
    source_state: snapshot.state_class, audio_base64: btoa(binary) });
});
