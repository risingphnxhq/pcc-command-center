import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const allowedOrigin = "https://command.risingphoenixhq.com";
const cors = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Max-Age": "600",
  Vary: "Origin",
};
function reply(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
const encoder = new TextEncoder();
function b64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function unb64url(value: string) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (letter) => letter.charCodeAt(0));
}
async function key(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function equalSecrets(a: string, b: string) {
  const aHash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(a)));
  const bHash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(b)));
  let diff = 0;
  for (let i = 0; i < aHash.length; i++) diff |= aHash[i] ^ bHash[i];
  return diff === 0;
}
async function issue(secret: string) {
  const data = b64url(encoder.encode(JSON.stringify({ scope: "PCC_REGISTERED_READ", exp: Date.now() + 10 * 60_000, nonce: crypto.randomUUID() })));
  const signature = b64url(new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(data))));
  return data + "." + signature;
}
async function valid(token: string, secret: string) {
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0].length > 1024 || parts[1].length > 128) return false;
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(secret), unb64url(parts[1]), encoder.encode(parts[0]));
    if (!ok) return false;
    const payload = JSON.parse(new TextDecoder().decode(unb64url(parts[0])));
    return payload.scope === "PCC_REGISTERED_READ" && Number.isFinite(payload.exp) && payload.exp > Date.now() && payload.exp < Date.now() + 10 * 60_000;
  } catch { return false; }
}
Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (origin !== allowedOrigin) return reply({ error: "ORIGIN_DENIED" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const url = new URL(request.url);
  const path = url.pathname.split("/").pop();
  const gateSecret = Deno.env.get("PCC_GATE_PASSPHRASE");
  const signingKey = Deno.env.get("PCC_GATE_SIGNING_KEY");
  if (!gateSecret || !signingKey || gateSecret.length < 20 || signingKey.length < 32) return reply({ error: "GATE_NOT_CONFIGURED" }, 503);
  if (path === "authorize" && request.method === "POST") {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const corporateUrl = Deno.env.get("SUPABASE_URL");
    if (!serviceKey || !corporateUrl) return reply({ error: "GATE_NOT_CONFIGURED" }, 503);
    const requestAddress = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await key(signingKey), encoder.encode(requestAddress)));
    const fingerprint = [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const admin = createClient(corporateUrl, serviceKey, { auth: { persistSession: false } });
    const { data: allowed, error: limitError } = await admin.rpc("pcc_entry_attempt_allowed", { p_fingerprint: fingerprint });
    if (limitError) return reply({ error: "GATE_NOT_CONFIGURED" }, 503);
    if (!allowed) return reply({ error: "ENTRY_RATE_LIMITED" }, 429);
    if (Number(request.headers.get("Content-Length") || 0) > 1024) return reply({ error: "REQUEST_TOO_LARGE" }, 413);
    let passphrase: unknown;
    try { passphrase = (await request.json()).passphrase; } catch { return reply({ error: "INVALID_REQUEST" }, 400); }
    if (typeof passphrase !== "string" || passphrase.length > 256 || !await equalSecrets(passphrase, gateSecret)) {
      return reply({ error: "ENTRY_DENIED" }, 401);
    }
    return reply({ session: await issue(signingKey), expires_in: 600 }, 200);
  }
  const isReadRoute = request.method === "GET" && ["snapshot", "mission"].includes(path || "");
  const isCommandBeaconRoute = request.method === "POST" && path === "command-beacon";
  if (!isReadRoute && !isCommandBeaconRoute) return reply({ error: "ROUTE_NOT_FOUND" }, 404);
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!await valid(token, signingKey)) return reply({ error: "ENTRY_REQUIRED" }, 401);
  const corporateUrl = Deno.env.get("SUPABASE_URL");
  const publishable = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const password = Deno.env.get("PCC_MACHINE_AUTH_PASSWORD");
  if (!corporateUrl || !publishable || !password) return reply({ error: "MACHINE_AUTH_NOT_CONFIGURED" }, 503);
  const expectedSubject = "d95ef35a-b6bc-4133-a8ff-0ee618b2b665";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return reply({ error: "MACHINE_AUTH_NOT_CONFIGURED" }, 503);
  const admin = createClient(corporateUrl, serviceKey, { auth: { persistSession: false } });
  const { data: expected, error: lookupError } = await admin.auth.admin.getUserById(expectedSubject);
  if (lookupError || !expected.user) return reply({ error: "MACHINE_SUBJECT_UNAVAILABLE" }, 503);
  const machineEmail = expected.user.email;
  if (!machineEmail) return reply({ error: "MACHINE_SUBJECT_UNAVAILABLE" }, 503);
  const machine = createClient(corporateUrl, publishable, { auth: { persistSession: false } });
  const { data: login, error: loginError } = await machine.auth.signInWithPassword({ email: machineEmail, password });
  if (loginError || !login.session?.access_token) return reply({ error: "MACHINE_CREDENTIALS_REJECTED" }, 503);
  if (login.user?.id !== expectedSubject) return reply({ error: "MACHINE_IDENTITY_MISMATCH" }, 503);
  const client = createClient(corporateUrl, publishable, {
    global: { headers: { Authorization: "Bearer " + login.session.access_token } },
    auth: { persistSession: false },
  });
  if (isCommandBeaconRoute) {
    if (Number(request.headers.get("Content-Length") || 0) > 1024) return reply({ error: "REQUEST_TOO_LARGE" }, 413);
    let command: { operation?: unknown; message?: unknown };
    try { command = await request.json(); } catch { return reply({ error: "INVALID_REQUEST" }, 400); }
    const operation = typeof command.operation === "string" ? command.operation.trim().toUpperCase() : "";
    const message = typeof command.message === "string" ? command.message.trim() : null;
    if (!["SET_ACTIVE", "SET_STANDBY", "ROLLBACK_LAST"].includes(operation)) {
      return reply({ error: "OPERATION_NOT_ALLOWED" }, 400);
    }
    if (operation !== "ROLLBACK_LAST" && (!message || message.length > 240)) {
      return reply({ error: "MESSAGE_REQUIRED" }, 400);
    }
    const { data, error } = await client.rpc("pcc_corporate_command_beacon", {
      p_operation: operation,
      p_message: message,
    });
    if (error) {
      const authorityFailure = error.code === "42501";
      return reply({ error: authorityFailure ? "COMMAND_AUTHORITY_REQUIRED" : error.message || "COMMAND_FAILED" }, authorityFailure ? 403 : 409);
    }
    return reply(data, 200);
  }

  const missionId = url.searchParams.get("mission_id");
  if (path === "mission" && (!missionId || !/^[A-Z0-9][A-Z0-9_-]{0,127}$/.test(missionId))) return reply({ error: "INVALID_MISSION_ID" }, 400);
  const { data, error } = path === "mission"
    ? await client.rpc("pcc_corporate_mission_detail", { p_mission_id: missionId })
    : await client.rpc("pcc_corporate_command_snapshot");
  if (error) return reply({ error: error.code === "42501" ? "PCC_READ_AUTHORITY_REQUIRED" : "CORPORATE_SOURCE_UNAVAILABLE" }, error.code === "42501" ? 403 : 503);
  return reply(data, 200);
});
