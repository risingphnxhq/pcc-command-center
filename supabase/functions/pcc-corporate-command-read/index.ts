import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const allowedOrigin = "https://command.risingphoenixhq.com";
const cors = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Vary": "Origin",
};
function respond(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.headers.get("origin") && req.headers.get("origin") !== allowedOrigin) {
    return respond({ error: "ORIGIN_DENIED" }, 403);
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return respond({ error: "METHOD_NOT_ALLOWED" }, 405);

  const auth = req.headers.get("authorization") || "";
  if (!/^Bearer\s+[^\s]+$/i.test(auth)) return respond({ error: "AUTH_REQUIRED" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) return respond({ error: "CONFIGURATION_UNAVAILABLE" }, 503);

  const client = createClient(url, key, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const token = auth.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) return respond({ error: "AUTH_INVALID" }, 401);

  const path = new URL(req.url).pathname;
  if (path.endsWith("/identity")) {
    return respond({
      authenticated_subject: userData.user.id,
      institutional_binding: "UNVERIFIED",
      source: "SUPABASE_AUTH_GET_USER",
    }, 200);
  }

  const missionId = new URL(req.url).searchParams.get("mission_id");
  if (missionId && !/^[A-Z0-9][A-Z0-9_-]{0,127}$/.test(missionId)) {
    return respond({ error: "INVALID_MISSION_ID" }, 400);
  }
  const { data, error } = missionId
    ? await client.rpc("pcc_corporate_mission_detail", { p_mission_id: missionId })
    : await client.rpc("pcc_corporate_command_snapshot");
  if (error) {
    if (error.code === "42501") return respond({ error: "OFFICE_BINDING_REQUIRED" }, 403);
    return respond({ error: "COMMAND_STATE_UNAVAILABLE" }, 503);
  }
  return respond(data, 200);
});
