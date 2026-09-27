import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const origin = "https://command.risingphoenixhq.com";
const headers = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Cache-Control": "no-store",
  Vary: "Origin",
  "X-Content-Type-Options": "nosniff",
};
function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...headers, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.headers.get("Origin") !== origin) return json({ error: "ORIGIN_DENIED" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const url = new URL(request.url);
  if (url.pathname.split("/").pop() !== "meeting") return json({ error: "ROUTE_NOT_FOUND" }, 404);
  const meetingId = url.searchParams.get("meeting_id") || "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(meetingId)) {
    return json({ error: "INVALID_MEETING" }, 400);
  }
  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!bearer || bearer.length > 8192) return json({ error: "USER_AUTH_REQUIRED" }, 401);
  const base = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key || !service) return json({ error: "ROOM_CONTENT_NOT_CONFIGURED" }, 503);

  const auth = createClient(base, key, { auth: { persistSession: false } });
  const { data: { user }, error: authError } = await auth.auth.getUser(bearer);
  if (authError || !user || user.is_anonymous) return json({ error: "USER_AUTH_REQUIRED" }, 401);

  const admin = createClient(base, service, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc("pcc_virtual_war_room_room_view", {
    p_auth_subject: user.id, p_meeting_id: meetingId,
  });
  if (error) return json({ error: "ROOM_CONTENT_UNAVAILABLE" }, 503);
  if (!data) return json({ error: "ROOM_ACCESS_DENIED" }, 403);
  return json(data, 200);
});
