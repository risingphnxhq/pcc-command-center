import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const ALLOWED_ORIGIN = "https://command.risingphoenixhq.com";
const MAX_BODY_BYTES = 64_000;
const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= max ? normalized : null;
}

function rolesFor(user: { app_metadata?: Record<string, unknown> }): Set<string> {
  const source = user.app_metadata?.pcc_animation_access;
  return new Set(Array.isArray(source) ? source.filter((v): v is string => typeof v === "string") : []);
}

async function readBoundedBody(req: Request, maxBytes: number): Promise<string | null> {
  const declared = req.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST_REQUIRED" });

  const authorization = req.headers.get("authorization") ?? "";
  const publishableKey = req.headers.get("apikey") ?? "";
  if (!authorization.startsWith("Bearer ") || !publishableKey) {
    return json(401, { error: "AUTHENTICATION_REQUIRED" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json(503, { error: "PCC_RUNTIME_CONFIGURATION_MISSING" });

  const caller = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) return json(401, { error: "AUTHENTICATED_SUBJECT_REQUIRED" });

  const roles = rolesFor(userData.user);
  let bodyText: string | null;
  try {
    bodyText = await readBoundedBody(req, MAX_BODY_BYTES);
  } catch {
    return json(400, { error: "UTF8_JSON_REQUIRED" });
  }
  if (bodyText === null) return json(413, { error: "REQUEST_TOO_LARGE" });

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(bodyText);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: "JSON_OBJECT_REQUIRED" });
  }

  const action = typeof body.action === "string" ? body.action.toUpperCase() : "";
  const payload = body.payload && !Array.isArray(body.payload) && typeof body.payload === "object"
    ? body.payload as Record<string, unknown>
    : {};

  if (action === "CREATE") {
    if (!roles.has("REQUEST") && !roles.has("ADMIN")) return json(403, { error: "ANIMATION_REQUEST_ROLE_REQUIRED" });

    const idempotencyKey = text(payload.idempotency_key, 128);
    const channelKey = text(payload.channel_key, 64);
    const outputType = text(payload.output_type, 32)?.toUpperCase();
    const title = text(payload.title, 200);
    const idea = text(payload.idea, 12_000);
    const requestPayload = payload.request_payload ?? {};
    if (!idempotencyKey || idempotencyKey.length < 8 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)
      || !channelKey || !/^[a-z][a-z0-9_]{1,63}$/.test(channelKey)
      || !["EPISODE", "AD", "REEL", "MICRO_DRAMA", "BOOK_SCENE", "OTHER"].includes(outputType ?? "")
      || !idea
      || !requestPayload || Array.isArray(requestPayload) || typeof requestPayload !== "object") {
      return json(400, { error: "ANIMATION_REQUEST_INVALID" });
    }

    const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await service.rpc("pcc_animation_job_control_v1", {
      p_action: "CREATE",
      p_subject: userData.user.id,
      p_payload: {
        idempotency_key: idempotencyKey,
        channel_key: channelKey,
        output_type: outputType,
        title: title ?? outputType,
        idea,
        request_payload: requestPayload,
      },
    });
    if (error) return json(400, { error: "ANIMATION_JOB_CREATE_FAILED", code: error.code ?? "UNKNOWN" });
    return json(202, { ok: true, job: data, dispatch: "NOT_CONNECTED" });
  }

  if (action === "LIST") {
    if (!roles.has("REQUEST") && !roles.has("REVIEW") && !roles.has("ADMIN")) return json(403, { error: "ANIMATION_REQUEST_ROLE_REQUIRED" });
    const canReview = roles.has("REVIEW") || roles.has("ADMIN");
    const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await service.rpc("pcc_animation_job_control_v1", {
      p_action: "LIST",
      p_subject: userData.user.id,
      p_payload: { can_review: canReview },
    });
    if (error) return json(400, { error: "ANIMATION_JOB_LIST_FAILED", code: error.code ?? "UNKNOWN" });
    return json(200, { ok: true, jobs: data });
  }

  if (action === "READ") {
    const jobId = text(payload.job_id, 36);
    if (!jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
      return json(400, { error: "ANIMATION_JOB_ID_INVALID" });
    }
    const canReview = roles.has("REVIEW") || roles.has("ADMIN");
    const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await service.rpc("pcc_animation_job_control_v1", {
      p_action: "READ",
      p_subject: userData.user.id,
      p_payload: { job_id: jobId, can_review: canReview },
    });
    if (error) return json(404, { error: "ANIMATION_JOB_NOT_FOUND" });
    return json(200, { ok: true, job: data });
  }

  return json(403, { error: "ANIMATION_ACTION_NOT_ALLOWED" });
});
