import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "access-control-allow-origin": "https://command.risingphoenixhq.com",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "content-type": "application/json",
  "cache-control": "no-store",
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "POST_REQUIRED" }, 405);

  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return response({ error: "AUTHORIZATION_REQUIRED" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) return response({ error: "PCC_RUNTIME_CONFIGURATION_MISSING" }, 503);

  const callerClient = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: authorization } } });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) return response({ error: "AUTHENTICATED_SUBJECT_REQUIRED" }, 401);

  const body = await req.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action.toUpperCase() : "";
  const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload : {};
  const allowedActions = new Set(["LIST","READ","CREATE","START_GATE","RECORD_EVIDENCE","SET_GATE_OUTCOME"]);
  if (!allowedActions.has(action)) return response({ error: "BUILD_CONTROL_ACTION_NOT_PERMITTED" }, 403);

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const rpcName = ["LIST","READ","CREATE"].includes(action) ? "pcc_build_control_v2" : "pcc_build_control_gate_v2";
  const { data, error } = await serviceClient.rpc(rpcName, {
    p_auth_subject: userData.user.id,
    p_action: action,
    p_payload: payload,
  });

  if (error) return response({ error: "BUILD_CONTROL_RPC_FAILED", detail: error.message }, 500);
  const result = data as Record<string, unknown>;
  const status = result.status === "DENIED" ? 403 : result.status === "NOT_FOUND" ? 404 : 200;
  return response(result, status);
});
