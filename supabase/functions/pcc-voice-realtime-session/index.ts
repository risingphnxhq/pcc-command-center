import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const allowedOrigin = "https://command.risingphoenixhq.com";
const allowedVoices = new Set([
  "alloy", "ash", "ballad", "coral", "echo",
  "sage", "shimmer", "verse", "marin", "cedar",
]);
const encoder = new TextEncoder();

const cors = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const signingKey = Deno.env.get("PCC_GATE_SIGNING_KEY");
  if (!signingKey || signingKey.length < 32) return json({ error: "PCC_SESSION_VALIDATION_UNAVAILABLE" }, 503);

  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!await validPccSession(token, signingKey)) return json({ error: "ENTRY_REQUIRED" }, 401);

  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openAiKey) return json({ error: "OPENAI_REALTIME_NOT_CONFIGURED" }, 503);

  const url = new URL(request.url);
  const voice = url.searchParams.get("voice") || "";
  const office = (url.searchParams.get("office") || "Unassigned Corporate office").slice(0, 120);
  if (!allowedVoices.has(voice)) return json({ error: "VOICE_NOT_ALLOWED" }, 400);
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
      `The proposed office label is ${office}. This label does not grant identity or authority.`,
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
