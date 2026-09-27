import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const origin = "https://command.risingphoenixhq.com";
const headers = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Cache-Control": "no-store",
  Vary: "Origin",
};
function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...headers, "Content-Type": "application/json", "X-Content-Type-Options": "nosniff" },
  });
}

Deno.serve(async (request) => {
  if (request.headers.get("Origin") !== origin) return json({ error: "ORIGIN_DENIED" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const url = new URL(request.url);
  if (url.pathname.split("/").pop() !== "check") return json({ error: "ROUTE_NOT_FOUND" }, 404);
  const meetingId = url.searchParams.get("meeting_id") || "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(meetingId)) {
    return json({ error: "INVALID_MEETING" }, 400);
  }
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || token.length > 8192) return json({ error: "GUEST_AUTH_REQUIRED" }, 401);
  const base = Deno.env.get("SUPABASE_URL");
  const publishable = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !publishable || !service) return json({ error: "ROOM_ACCESS_NOT_CONFIGURED" }, 503);

  // getUser validates this request's Auth token with the Auth server. The old
  // PCC_REGISTERED_READ gate token is not a Supabase user session.
  const auth = createClient(base, publishable, { auth: { persistSession: false } });
  const { data: { user }, error: authError } = await auth.auth.getUser(token);
  if (authError || !user || user.is_anonymous) return json({ error: "GUEST_AUTH_REQUIRED" }, 401);

  // The private tables have no anon/authenticated access. This service-only
  // RPC returns a boolean for the verified Auth subject and selected meeting.
  const admin = createClient(base, service, { auth: { persistSession: false } });
  const { data: allowed, error } = await admin.rpc("pcc_virtual_war_room_guest_check", {
    p_guest_auth_subject: user.id, p_meeting_id: meetingId,
  });
  if (error) return json({ error: "ROOM_ACCESS_UNAVAILABLE" }, 503);
  if (allowed !== true) return json({ access: "DENIED" }, 403);
  // This is an access decision, not a media credential or protected content.
  return json({ access: "ALLOWED", room: "WAR_ROOM", meeting_id: meetingId }, 200);
});
