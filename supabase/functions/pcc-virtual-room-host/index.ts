import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const origin = "https://command.risingphoenixhq.com";
const cors = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  Vary: "Origin",
};
function reply(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: {
    ...cors, "Content-Type": "application/json", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
Deno.serve(async (request) => {
  if (request.headers.get("Origin") !== origin) return reply({ error: "ORIGIN_DENIED" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST" || new URL(request.url).pathname.split("/").pop() !== "draft") {
    return reply({ error: "ROUTE_NOT_FOUND" }, 404);
  }
  if (Number(request.headers.get("Content-Length") || 0) > 2048) return reply({ error: "REQUEST_TOO_LARGE" }, 413);
  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!bearer || bearer.length > 8192) return reply({ error: "HOST_AUTH_REQUIRED" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key || !service) return reply({ error: "HOST_ROUTE_NOT_CONFIGURED" }, 503);
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data: { user }, error: authError } = await client.auth.getUser(bearer);
  if (authError || !user || user.is_anonymous) return reply({ error: "HOST_AUTH_REQUIRED" }, 401);
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return reply({ error: "INVALID_REQUEST" }, 400); }
  const mission = input.mission_ref, title = input.title, starts = input.starts_at, ends = input.ends_at;
  if (typeof mission !== "string" || !/^[A-Z0-9][A-Z0-9_-]{0,159}$/.test(mission) ||
      typeof title !== "string" || title.length < 1 || title.length > 200 ||
      typeof starts !== "string" || typeof ends !== "string" ||
      !Number.isFinite(Date.parse(starts)) || !Number.isFinite(Date.parse(ends))) {
    return reply({ error: "INVALID_REQUEST" }, 400);
  }
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc("pcc_virtual_war_room_meeting_draft", {
    p_host_auth_subject: user.id, p_mission_ref: mission, p_title: title,
    p_starts_at: starts, p_ends_at: ends,
  });
  if (error) return reply({ error: error.code === "42501" ? "MEETING_HOST_AUTHORITY_REQUIRED" : "MEETING_DRAFT_FAILED" }, error.code === "42501" ? 403 : 400);
  return reply({ state: "DRAFT", meeting_id: data, guest_access: "DENIED" }, 201);
});
