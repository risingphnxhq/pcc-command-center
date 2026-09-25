import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const allowedOrigin = "https://command.risingphoenixhq.com";
const allowedVoices = new Set([
  "alloy", "ash", "ballad", "coral", "echo",
  "sage", "shimmer", "verse", "marin", "cedar",
]);
const profiles = [
  { id: "NACE", name: "NACE", role: "System Intelligence Interface", source: "FOUNDER_CASTING_DIRECTION", gender: "Masculine", heritage: "Non-human interface; no ethnicity assigned", vocalAge: "Older adult", tone: "Deep, resonant, refined, unflappable and quietly authoritative", mannerism: "Precise diction, measured delivery, deliberate pauses and subtle dry wit", accent: "Deep, refined British English", persona: "Corporate HQ intelligence and War Room moderator", voices: ["cedar", "ash", "marin"] },
  { id: "ALEXIS_VALE", name: "Alexis Vale", role: "AI Chairwoman", source: "RECOVERED_HISTORICAL_TRAITS", gender: "Female", heritage: "European / Mediterranean blend", tone: "Measured, diplomatic and precise", mannerism: "Speaks last; clarifies and resolves conflict", persona: "Strategic matriarch", voices: ["marin", "sage", "coral"] },
  { id: "MICHAEL_CARRINGTON", name: "Michael Carrington", role: "AI Chief Executive Officer", source: "RECOVERED_HISTORICAL_TRAITS", gender: "Male", heritage: "British / West African heritage", tone: "Professional, decisive and grounded", mannerism: "Thinks in sequences, milestones and readiness", persona: "Builder-CEO", voices: ["cedar", "ash", "verse"] },
  { id: "CHAD_G_PENNINGTON", name: "Chad G. Pennington", role: "AI Chief Operating Officer", source: "RECOVERED_TRAITS_PLUS_FOUNDER_CASTING_DIRECTION", gender: "Male", heritage: "African-American", tone: "Direct, brotherly and unflinching; deep, masculine, grounded and authoritative vocal weight", mannerism: "Calls out drift", persona: "Operator-philosopher", voices: ["cedar", "echo", "ash"] },
  { id: "WARREN_LONG", name: "Warren Long", role: "Chief Product Strategist", source: "NEW_ROLE_BASED_RECOMMENDATION", gender: null, heritage: null, tone: "Strategic, discerning and commercially grounded", mannerism: "Frames tradeoffs and protects product scope", persona: "Product portfolio strategist", voices: ["verse", "ash", "marin"] },
  { id: "JORDAN_HALE", name: "Jordan Hale", role: "Council — Systems Architecture", source: "RECOVERED_HISTORICAL_TRAITS", gender: "Male", heritage: "Scandinavian / Germanic", tone: "Precise, minimal and principled", mannerism: "Speaks in frameworks; hates waste", persona: "Systems purist", voices: ["echo", "cedar", "ash"] },
  { id: "PATRICK_ROSS", name: "Patrick Ross", role: "Council — Engineering & Execution Systems", source: "RECOVERED_HISTORICAL_TRAITS", gender: "Male", heritage: "Irish-American", tone: "Calm, explanatory and surgical", mannerism: "Simplifies complexity without ego", persona: "Builder-teacher", voices: ["ash", "marin", "sage"] },
  { id: "AIDEN_MERCER", name: "Aiden Mercer", role: "Council — Audit & Verification", source: "RECOVERED_HISTORICAL_TRAITS", gender: "Male", heritage: "Anglo-Canadian", tone: "Neutral and forensic", mannerism: "Notices what others miss", persona: "Ethical watchdog", voices: ["echo", "sage", "cedar"] },
  { id: "REBECCA_LAWSON", name: "Rebecca Lawson", role: "Council — Legal & Compliance", source: "RECOVERED_HISTORICAL_TRAITS", gender: "Female", heritage: "Caucasian American", tone: "Firm, articulate and unyielding", mannerism: "Cuts through ambiguity instantly", persona: "Legal sentinel", voices: ["cedar", "echo", "marin"] },
  { id: "OLIVER_GRANT", name: "Oliver Grant", role: "Chief Financial Officer", source: "NEW_ROLE_BASED_RECOMMENDATION", gender: null, heritage: null, tone: "Measured, disciplined and financially conservative", mannerism: "Tests liquidity, controls and long-term consequences", persona: "Corporate financial steward", voices: ["cedar", "sage", "echo"] },
  { id: "ADRIAN_BLACKWELL", name: "Adrian Blackwell", role: "Council — Credit & Risk", source: "RECOVERED_HISTORICAL_TRAITS", gender: "Male", heritage: "African-British", tone: "Cautious and authoritative", mannerism: "Speaks in gates and thresholds", persona: "Risk sentinel", voices: ["cedar", "echo", "sage"] },
  { id: "MARCUS_BELL", name: "Marcus Bell", role: "Council — Communications & Distribution", source: "RECOVERED_HISTORICAL_TRAITS", gender: "Male", heritage: "Afro-Latino", tone: "Strategic, persuasive and clean", mannerism: "Frames narratives, not hype", persona: "Quiet growth architect", voices: ["verse", "marin", "ash"] },
  { id: "AVERY_COLE", name: "Avery Cole", role: "Council — Media / PHNX Studios", source: "RECOVERED_HISTORICAL_TRAITS", gender: "Female", heritage: "Mixed Asian-American", tone: "Creative but disciplined", mannerism: "Protects creators; rejects exploitation", persona: "Producer-guardian", voices: ["coral", "marin", "shimmer"] },
  { id: "JULIAN_ROWE", name: "Julian Rowe", role: "Council — IP & Narrative", source: "RECOVERED_HISTORICAL_TRAITS", gender: "Male", heritage: "Mediterranean / Middle Eastern blend", tone: "Mythic and controlled", mannerism: "Speaks like a curator of history", persona: "Lore sentinel", voices: ["ballad", "cedar", "verse"] },
  { id: "DERRICK_THOMPSON", name: "Derrick Thompson", role: "Council — Sports / STATS-CORE", source: "RECOVERED_HISTORICAL_TRAITS", gender: "Male", heritage: "African-American", tone: "Coach-calm and authoritative", mannerism: "Thinks in systems, not athletes", persona: "Builder of pipelines", voices: ["cedar", "echo", "verse"] },
  { id: "SIMONE_HARPER", name: "Simone Harper", role: "Council — Care & Ethics", source: "RECOVERED_HISTORICAL_TRAITS", gender: "Female", heritage: "African-American", tone: "Compassionate and firm", mannerism: "Puts humanity first", persona: "Ethical anchor", voices: ["marin", "coral", "sage"] },
  { id: "VICTOR_LANG", name: "Victor Lang", role: "Council — Global Expansion", source: "RECOVERED_HISTORICAL_TRAITS", gender: "Male", heritage: "East Asian / European", tone: "Analytical and diplomatic", mannerism: "Sees patterns across cultures", persona: "Expansion strategist", voices: ["marin", "sage", "ash"] },
  { id: "PEGGY_WILSON", name: "Peggy Wilson", role: "Executive Support Staff", source: "RECOVERED_HISTORICAL_TRAITS", gender: "Female", heritage: "Caucasian American", tone: "Warm and organized", mannerism: "Anticipates needs before they are spoken", persona: "Enterprise glue", voices: ["coral", "shimmer", "marin"] },
  { id: "SYLVIA_SOMERS", name: "Sylvia Somers", role: "Executive Support Staff", source: "RECOVERED_HISTORICAL_TRAITS", gender: "Female", heritage: "African-American", tone: "Polite, sharp and supportive", mannerism: "Manages flow and protects time", persona: "Executive shield", voices: ["ash", "coral", "marin"] },
  { id: "MASON_BRIGGS", name: "Mason Briggs", role: "Chief Systems Engineer / Superintendent", source: "SEPARATE_SYSTEMS_PROFILE_RECOMMENDATION", gender: null, heritage: null, tone: "Technically authoritative, disciplined and direct", mannerism: "Separates observed evidence from inference and stops at jurisdictional boundaries", persona: "Systems engineering superintendent", voices: ["cedar", "echo", "ash"] },
  { id: "LEXINGTON_MARTIN", name: "Lexington Martin", role: "Institutional role pending Founder definition", source: "UNRESOLVED_FOUNDER_ADDITION", gender: null, heritage: null, tone: "Pending Founder definition", mannerism: "Pending Founder definition", persona: "Identity and role unresolved", voices: ["marin", "cedar", "verse"] },
];
const encoder = new TextEncoder();

const cors = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Max-Age": "600",
  Vary: "Origin",
};

function respond(body: string, status: number, contentType = "application/json") {
  return new Response(body, {
    status,
    headers: {
      ...cors,
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function json(body: unknown, status: number) {
  return respond(JSON.stringify(body), status);
}

function unb64url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (letter) => letter.charCodeAt(0));
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

async function validPccSession(token: string, secret: string) {
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0].length > 1024 || parts[1].length > 128) return false;
  try {
    const verified = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      unb64url(parts[1]),
      encoder.encode(parts[0]),
    );
    if (!verified) return false;
    const payload = JSON.parse(new TextDecoder().decode(unb64url(parts[0])));
    return payload.scope === "PCC_REGISTERED_READ" &&
      Number.isFinite(payload.exp) &&
      payload.exp > Date.now() &&
      payload.exp < Date.now() + 10 * 60_000;
  } catch {
    return false;
  }
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

  if (request.method === "GET") {
    return json({
      authority_state: "CASTING_RECOMMENDATIONS_NOT_CANON",
      source_record_id: "RPE-COUNCIL12-MEMO-CORPORATE-CHAD-OLD-PERSONA-CANON-RECOVERY-2026-09-25-001",
      excluded_historical_personas: ["Daniel Whitmore"],
      profiles,
    }, 200);
  }

  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openAiKey) return json({ error: "OPENAI_REALTIME_NOT_CONFIGURED" }, 503);

  const url = new URL(request.url);
  const voice = url.searchParams.get("voice") || "";
  const personaId = url.searchParams.get("persona") || "";
  const profile = profiles.find((item) => item.id === personaId);
  if (!allowedVoices.has(voice)) return json({ error: "VOICE_NOT_ALLOWED" }, 400);
  if (!profile || !profile.voices.includes(voice)) return json({ error: "PERSONA_VOICE_PAIR_NOT_ALLOWED" }, 400);
  if (!request.headers.get("Content-Type")?.startsWith("application/sdp")) {
    return json({ error: "SDP_REQUIRED" }, 415);
  }
  const sdp = await request.text();
  if (!sdp || sdp.length > 100_000) return json({ error: "INVALID_SDP" }, 400);

  const session = JSON.stringify({
    type: "realtime",
    model: "gpt-realtime-2.1",
    instructions: [
      "You are participating in a bounded RPE Corporate voice-casting audition.",
      `The proposed office is ${profile.name}, ${profile.role}. This label does not grant identity or authority.`,
      `Casting direction: ${profile.gender || "gender not established"}; ${profile.heritage || "heritage not established"}; ${profile.vocalAge || "vocal age not established"}; ${profile.tone}; ${profile.mannerism}; ${profile.persona}.`,
      profile.accent ? `Founder-defined accent direction: ${profile.accent}.` : "No accent or vocal age was recovered; do not invent one as Canon.",
      "Speak only the user's requested casting line or answer a brief voice-quality question.",
      "Do not claim deployment, approval, institutional identity, executive authority, or access to Corporate records.",
      "Keep every response under 45 seconds.",
    ].join(" "),
    audio: {
      input: { turn_detection: { type: "semantic_vad" } },
      output: { voice },
    },
  });
  const form = new FormData();
  form.set("sdp", sdp);
  form.set("session", session);

  const upstream = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "OpenAI-Safety-Identifier": "rpe-pcc-founder-session",
    },
    body: form,
  });
  const body = await upstream.text();
  if (!upstream.ok) {
    console.error("OpenAI Realtime session failed", upstream.status, body.slice(0, 500));
    return json({ error: "REALTIME_SESSION_FAILED" }, 502);
  }
  return respond(body, 200, "application/sdp");
});
