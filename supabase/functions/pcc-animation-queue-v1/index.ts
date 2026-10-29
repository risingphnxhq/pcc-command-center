import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const ALLOWED_ORIGIN = "https://command.risingphoenixhq.com";
const headers = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json(405, { ok: false, error: "METHOD_NOT_ALLOWED" });

  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return json(401, { ok: false, error: "AUTHENTICATION_REQUIRED" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return json(503, { ok: false, error: "PCC_RUNTIME_CONFIGURATION_MISSING" });
  }

  const caller = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) {
    return json(401, { ok: false, error: "AUTHENTICATED_PCC_SUBJECT_REQUIRED" });
  }

  let body: { action?: unknown; payload?: unknown };
  try { body = await req.json(); }
  catch { return json(400, { ok: false, error: "INVALID_JSON" }); }
  const action = typeof body.action === "string" ? body.action.trim().toUpperCase() : "";
  const allowed = new Set(["CREATE", "LIST", "READ", "CANCEL", "READINESS"]);
  if (!allowed.has(action)) return json(403, { ok: false, error: "ANIMATION_ACTION_NOT_PERMITTED" });
  const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
    ? body.payload
    : {};

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: founder, error: founderError } = await admin.rpc("pcc_founder_private_subject", {
    p_subject: userData.user.id,
  });
  if (founderError || founder !== true) {
    return json(403, { ok: false, error: "PCC_FOUNDER_AUTHORIZATION_REQUIRED" });
  }

  const service = admin;
  const { data, error } = await service.rpc("pcc_animation_queue_v1", {
    p_auth_subject: userData.user.id,
    p_action: action,
    p_payload: payload,
  });
  if (error) return json(500, { ok: false, error: "ANIMATION_QUEUE_RPC_FAILED" });

  const result = data as Record<string, unknown>;
  const status = result.status === "DENIED" ? 403 :
    result.status === "INVALID" ? 400 :
    result.status === "NOT_FOUND" || result.status === "NOT_FOUND_OR_NOT_CANCELLABLE" ? 404 : 200;
  return json(status, { ok: status < 400, ...result });
});
