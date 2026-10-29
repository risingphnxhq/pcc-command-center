import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { runAnimationScriptwriter } from "../_shared/animation-scriptwriter-v1.mjs";
import { resolveProductionIntent, validateHandoffSource } from "../_shared/animation-handoff-v1.mjs";
import { postHeldAnimationHandoff } from "../_shared/pcc-pmf-bridge-v1.mjs";
import { buildReviewerNotificationReceipt } from "../_shared/reviewer-notice-v1.mjs";
import { validateAnimationPolicyRegistration, validateResolvedAnimationPolicy } from "../_shared/animation-channel-policy-v1.mjs";

const ALLOWED_ORIGIN = "https://command.risingphoenixhq.com";
const MAX_BODY_BYTES = 64_000;
// This server allowlist is the currently verified PMF channel registry snapshot.
// Keep user-supplied arbitrary keys from entering the PCC queue until live registry lookup is wired.
const KNOWN_CHANNEL_KEYS = new Set(["goldmind", "goldwords", "phnx_kids", "phnx_kitchen", "phnx_sports", "phnx_studio", "phnx_faceless", "rpe", "shadow", "valarian"]);
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

function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length <= max ? normalized : null;
}

function rolesFor(user: { app_metadata?: Record<string, unknown> }): Set<string> {
  const source = user.app_metadata?.pcc_animation_access;
  return new Set(Array.isArray(source) ? source.filter((v): v is string => typeof v === "string") : []);
}

function createScriptModel(apiKey: string, modelName: string) {
  return {
    async complete({ system, user }: { system: string; user: string }) {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelName,
          temperature: 0.4,
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        }),
      });
      if (!response.ok) throw new Error("SCRIPT_MODEL_REQUEST_FAILED");
      const result = await response.json();
      const content = result?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) throw new Error("SCRIPT_MODEL_RESPONSE_EMPTY");
      return content;
    },
  };
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

  if (action === "REGISTER_POLICY") {
    if (!roles.has("ADMIN")) return json(403, { error: "ANIMATION_POLICY_ADMIN_REQUIRED" });
    let registeredPolicy: Record<string, unknown>;
    try { registeredPolicy = validateAnimationPolicyRegistration(payload.policy); }
    catch (error) { return json(400, { error: error instanceof Error ? error.message : "ANIMATION_POLICY_INVALID" }); }
    const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await service.rpc("pcc_animation_channel_policy_control_v1", {
      p_action: "REGISTER", p_subject: userData.user.id, p_payload: registeredPolicy,
    });
    if (error || !data) return json(409, { error: "ANIMATION_POLICY_REGISTER_FAILED", code: error?.code ?? "UNKNOWN" });
    return json(201, { ok: true, policy: data });
  }

  if (action === "REVOKE_POLICY") {
    if (!roles.has("ADMIN")) return json(403, { error: "ANIMATION_POLICY_ADMIN_REQUIRED" });
    const policyId = text(payload.policy_id, 36);
    const reason = text(payload.reason, 1000);
    const authorityPscId = text(payload.authority_psc_id, 160);
    if (!policyId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(policyId)
      || !reason || !authorityPscId) return json(400, { error: "ANIMATION_POLICY_REVOCATION_INVALID" });
    const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await service.rpc("pcc_animation_channel_policy_control_v1", {
      p_action: "REVOKE", p_subject: userData.user.id,
      p_payload: { policy_id: policyId, reason, authority_psc_id: authorityPscId },
    });
    if (error || !data) return json(409, { error: "ANIMATION_POLICY_REVOKE_FAILED", code: error?.code ?? "UNKNOWN" });
    return json(200, { ok: true, revocation: data });
  }

  if (action === "CREATE") {
    if (!roles.has("REQUEST") && !roles.has("ADMIN")) return json(403, { error: "ANIMATION_REQUEST_ROLE_REQUIRED" });

    const idempotencyKey = text(payload.idempotency_key, 128);
    const channelKey = text(payload.channel_key, 64);
    const outputType = text(payload.output_type, 32)?.toUpperCase();
    const suppliedIntent = text(payload.production_intent, 16)?.toUpperCase() ?? null;
    let productionIntent: string | null;
    try { productionIntent = resolveProductionIntent(outputType ?? "", suppliedIntent); }
    catch (error) { return json(400, { error: error instanceof Error ? error.message : "PRODUCTION_INTENT_INVALID" }); }
    const title = text(payload.title, 200);
    const idea = text(payload.idea, 12_000);
    const rawRequestPayload = payload.request_payload ?? {};
    const sourceContext = rawRequestPayload && !Array.isArray(rawRequestPayload) && typeof rawRequestPayload === "object"
      ? rawRequestPayload as Record<string, unknown>
      : {};
    const seriesContext = optionalText(sourceContext.series_context, 160);
    const contextNotes = optionalText(sourceContext.context_notes, 6_000);
    const desiredEnding = optionalText(sourceContext.desired_ending_or_action, 4_000);
    const requestPayload = { intake: "PCC_ANIMATION_ENGINE_V1", series_context: seriesContext, context_notes: contextNotes, desired_ending_or_action: desiredEnding };
    if (!idempotencyKey || idempotencyKey.length < 8 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)
      || !channelKey || !/^[a-z][a-z0-9_]{1,63}$/.test(channelKey) || !KNOWN_CHANNEL_KEYS.has(channelKey)
      || !["EPISODE", "SERIES_EPISODE", "ANIMATION", "AD", "REEL", "MICRO_DRAMA", "NOVEL", "BOOK_MANUSCRIPT", "BOOK_CHAPTER", "BOOK_SCENE", "CORPORATE_MARKETING", "CORPORATE_JINGLE", "TV_SPOT", "TV_COMMERCIAL", "SOCIAL_MEDIA_CAMPAIGN", "OTHER"].includes(outputType ?? "")
      || !title
      || !idea
      || seriesContext === null || contextNotes === null || desiredEnding === null
      || !rawRequestPayload || Array.isArray(rawRequestPayload) || typeof rawRequestPayload !== "object") {
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
        production_intent: productionIntent,
        title,
        idea,
        request_payload: requestPayload,
      },
    });
    if (error) return json(400, { error: "ANIMATION_JOB_CREATE_FAILED", code: error.code ?? "UNKNOWN" });
    return json(202, { ok: true, job: data, dispatch: "NOT_CONNECTED" });
  }

  if (action === "WRITE_SCRIPT") {
    const mayRequest = roles.has("REQUEST") || roles.has("SCRIPT") || roles.has("ADMIN");
    if (!mayRequest) return json(403, { error: "ANIMATION_SCRIPT_ROLE_REQUIRED" });

    const jobId = text(payload.job_id, 36);
    if (!jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
      return json(400, { error: "ANIMATION_JOB_ID_INVALID" });
    }
    const modelKey = Deno.env.get("PCC_SCRIPT_MODEL_API_KEY");
    const modelName = Deno.env.get("PCC_SCRIPT_MODEL_NAME");
    if (!modelKey || !modelName) return json(503, { error: "SCRIPT_RUNTIME_CONFIGURATION_MISSING" });

    const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const mayReview = roles.has("SCRIPT") || roles.has("REVIEW") || roles.has("ADMIN");
    const { data: job, error: readError } = await service.rpc("pcc_animation_job_control_v1", {
      p_action: "READ",
      p_subject: userData.user.id,
      p_payload: { job_id: jobId, can_review: mayReview },
    });
    if (readError || !job) return json(404, { error: "ANIMATION_JOB_NOT_FOUND" });
    if (job.script_bundle) return json(409, { error: "ANIMATION_JOB_ALREADY_SCRIPTED" });
    if (job.status === "CANCELLED" || job.status === "FAILED") return json(409, { error: "ANIMATION_JOB_NOT_WRITABLE" });

    const { data: policyData, error: policyError } = await service.rpc("pcc_animation_channel_policy_control_v1", {
      p_action: "RESOLVE", p_subject: userData.user.id,
      p_payload: {
        channel_key: job.channel_key,
        output_type: job.output_type,
        production_intent: job.production_intent,
      },
    });
    if (policyError || !policyData || policyData.approved !== true) {
      return json(409, { error: "REGISTERED_CHANNEL_POLICY_REQUIRED", channel_key: job.channel_key, output_type: job.output_type });
    }
    let policy: Record<string, unknown>;
    try {
      policy = validateResolvedAnimationPolicy(policyData, {
        channel_key: job.channel_key,
        output_type: job.output_type,
        production_intent: job.production_intent,
      }) as Record<string, unknown>;
    } catch {
      return json(409, { error: "REGISTERED_CHANNEL_POLICY_REQUIRED", channel_key: job.channel_key, output_type: job.output_type });
    }

    const claimed = await service.rpc("pcc_animation_job_control_v1", {
      p_action: "CLAIM_SCRIPT",
      p_subject: userData.user.id,
      p_payload: { job_id: job.job_id, can_review: mayReview },
    });
    if (claimed.error || !claimed.data) return json(409, { error: "ANIMATION_SCRIPT_ALREADY_CLAIMED_OR_UNAVAILABLE" });

    try {
      const reviewerNotices: Record<string, unknown>[] = [];
      const result = await runAnimationScriptwriter({
        request_id: job.job_id,
        channel_key: job.channel_key,
        output_type: job.output_type,
        production_intent: job.production_intent,
        idea: job.idea,
        series_context: job.request_payload?.series_context ?? "",
        context_notes: job.request_payload?.context_notes ?? "",
        desired_ending_or_action: job.request_payload?.desired_ending_or_action ?? "",
        channel_policy: policy,
      }, {
        model: createScriptModel(modelKey, modelName),
        notify: async (notice: Record<string, unknown>) => { reviewerNotices.push(notice); },
      });
      const status = result.state === "SCRIPT_REVIEW_PASSED" ? "SCRIPT_REVIEW_PASSED" : "REVIEW";
      const saved = await service.rpc("pcc_animation_job_control_v1", {
        p_action: "SAVE_SCRIPT",
        p_subject: userData.user.id,
        p_payload: {
          job_id: job.job_id,
          boas_id: policy.boas_id,
          boas_revision: policy.boas_revision,
          boas_approved: true,
          boas_psc_id: policy.boas_psc_id,
          knoas_id: policy.knoas_id,
          knoas_revision: policy.knoas_revision,
          knoas_approved: true,
          knoas_psc_id: policy.knoas_psc_id,
          script_bundle: {
            ...result.script_package,
            binary_validation: result.binary_validation,
            repair_count: result.repair_count,
          },
          review_receipt: {
            state: result.state,
            receipts: result.review_receipts,
            unresolved_issues: result.review_receipts.at(-1)?.issues ?? [],
            notification_receipt: buildReviewerNotificationReceipt(reviewerNotices),
          },
          status,
          can_review: mayReview,
        },
      });
      if (saved.error) throw new Error("ANIMATION_SCRIPT_SAVE_FAILED");
      return json(200, { ok: true, job: saved.data, script_state: result.state, dispatch: "NOT_CONNECTED" });
    } catch (error) {
      const code = error instanceof Error ? error.message : "SCRIPT_GENERATION_FAILED";
      const failureCode = code.slice(0, 120) || "SCRIPT_GENERATION_FAILED";
      await service.rpc("pcc_animation_job_control_v1", {
        p_action: "FAIL_SCRIPT",
        p_subject: userData.user.id,
        p_payload: {
          job_id: job.job_id,
          failure_code: failureCode,
          review_receipt: { state: "SCRIPT_GENERATION_FAILED", failure_code: failureCode, retryable: true },
          can_review: mayReview,
        },
      });
      return json(502, { error: "SCRIPT_GENERATION_FAILED", code: failureCode });
    }
  }

  if (action === "STAGE_PMF_HANDOFF") {
    if (!roles.has("HANDOFF") && !roles.has("ADMIN")) return json(403, { error: "ANIMATION_HANDOFF_ROLE_REQUIRED" });
    const jobId = text(payload.job_id, 36);
    if (!jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
      return json(400, { error: "ANIMATION_JOB_ID_INVALID" });
    }
    const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: job, error: readError } = await service.rpc("pcc_animation_job_control_v1", {
      p_action: "READ", p_subject: userData.user.id,
      p_payload: { job_id: jobId, can_review: true },
    });
    if (readError || !job) return json(404, { error: "ANIMATION_JOB_NOT_FOUND" });
    let packet: Record<string, unknown>;
    try { packet = validateHandoffSource(job); }
    catch (error) { return json(409, { error: error instanceof Error ? error.message : "ANIMATION_HANDOFF_SOURCE_INVALID" }); }
    const { data, error } = await service.rpc("pcc_animation_job_control_v1", {
      p_action: "STAGE_HANDOFF", p_subject: userData.user.id,
      p_payload: { job_id: jobId, can_stage: true, packet },
    });
    if (error || !data) return json(409, { error: "ANIMATION_HANDOFF_STAGE_FAILED", code: error?.code ?? "UNKNOWN" });

    const bridgeUrl = Deno.env.get("PCC_PMF_BRIDGE_URL");
    const bridgeSecret = Deno.env.get("PCC_PMF_BRIDGE_HMAC_SECRET");
    const bridgeKeyId = Deno.env.get("PCC_PMF_BRIDGE_KEY_ID") ?? "pcc-animation-v1";
    if (!bridgeUrl || !bridgeSecret) {
      return json(200, { ok: true, job: data, handoff_state: data.handoff_state,
        pmf_intake_state: "NOT_CONFIGURED", render_dispatch: "DISABLED" });
    }

    let pmfReceipt: Record<string, unknown>;
    try {
      pmfReceipt = await postHeldAnimationHandoff({
        url: bridgeUrl,
        secret: bridgeSecret,
        keyId: bridgeKeyId,
        packet: data.handoff_packet ?? packet,
      });
    } catch {
      return json(502, { ok: false, error: "PMF_HELD_INTAKE_FAILED", pcc_staged: true,
        job_id: jobId, handoff_state: data.handoff_state, render_dispatch: "DISABLED" });
    }

    const recorded = await service.rpc("pcc_animation_record_pmf_receipt_v1", {
      p_subject: userData.user.id,
      p_payload: { job_id: jobId, pmf_receipt: pmfReceipt, can_stage: true, can_review: true },
    });
    if (recorded.error || !recorded.data) {
      return json(502, { ok: false, error: "PMF_RECEIPT_LOCAL_RECORD_FAILED", pmf_intake_succeeded: true,
        job_id: jobId, pmf_receipt: pmfReceipt, render_dispatch: "DISABLED" });
    }
    return json(202, { ok: true, job: recorded.data, handoff_state: recorded.data.handoff_state,
      pmf_intake_state: "HELD_PMF_ADMISSION_REQUIRED", render_dispatch: "DISABLED" });
  }

  if (action === "LIST") {
    if (!roles.has("REQUEST") && !roles.has("REVIEW") && !roles.has("ADMIN")) return json(403, { error: "ANIMATION_REQUEST_ROLE_REQUIRED" });
    const canReview = roles.has("SCRIPT") || roles.has("REVIEW") || roles.has("ADMIN");
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
