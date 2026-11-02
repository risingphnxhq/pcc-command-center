import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { executeAnimationWriteLifecycle } from "../_shared/animation-write-lifecycle-v1.mjs";
import { resolveProductionIntent, validateHandoffSource } from "../_shared/animation-handoff-v1.mjs";
import { postHeldAnimationHandoff, readPmfAnimationProductionReadiness, readRunPodAnimationConnection, requestPmfAnimationReviewUrl, resolveCanonicalAnimationPolicyId, resolveVerifiedAnimationPolicySource, searchRunPodGpuAvailability, readLatestRunPodAvailabilitySnapshot, invokePmfProductionRuntime } from "../_shared/pcc-pmf-bridge-v1.mjs";
import { validateAnimationPolicyRegistration } from "../_shared/animation-channel-policy-v1.mjs";
import { resolveTrustedAnimationPolicy } from "../_shared/animation-channel-policy-runtime-v1.mjs";

// These JavaScript boundary modules validate their inputs at runtime. Keep the
// edge function's adapter types explicit because Deno otherwise infers overly
// narrow Supabase RPC generics from this project's generated database client.
const resolveTrustedAnimationPolicyTyped = resolveTrustedAnimationPolicy as unknown as (input: {
  request: { channel_key: string; output_type: string; production_intent: string; source_scope?: Record<string, string> };
  expectedSnapshot?: Record<string, unknown>;
  resolveRegisteredPolicy: (match: Record<string, unknown>) => Promise<unknown>;
  verifySource: (policy: Record<string, unknown>) => Promise<Record<string, unknown>>;
}) => Promise<{ policy: Record<string, unknown>; snapshot: Record<string, unknown>; verification: Record<string, unknown> }>;
const resolveVerifiedAnimationPolicySourceTyped = resolveVerifiedAnimationPolicySource as unknown as (input: {
  url: string; secret: string; keyId: string; policy: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;
const resolveCanonicalAnimationPolicyIdTyped = resolveCanonicalAnimationPolicyId as unknown as (input: {
  url: string; secret: string; keyId: string; approvalPscId: string;
}) => Promise<string>;
const invokePmfProductionRuntimeTyped = invokePmfProductionRuntime as unknown as (input: {
  url: string; secret: string; keyId: string; runtimeAction: string; packet: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;
const executeAnimationWriteLifecycleTyped = executeAnimationWriteLifecycle as unknown as (input: {
  job: Record<string, any>; trustedPolicy: Record<string, any>; canReview: boolean;
  model: { complete(input: { system: string; user: string }): Promise<string> };
  saveScript: (payload: Record<string, unknown>) => Promise<{ data?: unknown; error?: unknown }>;
}) => Promise<{ saved: { data: unknown }; result: { state: string } }>;

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


async function resolveLiveAnimationPolicy(
  service: any,
  subject: string,
  request: { channel_key: string; output_type: string; production_intent: string; source_scope?: Record<string, string> },
  expectedSnapshot?: Record<string, unknown>,
) {
  const bridgeUrl = Deno.env.get("PCC_PMF_BRIDGE_URL") ?? "https://oyjmpbuxvfxusmbouldi.supabase.co/functions/v1/pcc-animation-bridge-v1";
  const bridgeSecret = Deno.env.get("PCC_PMF_BRIDGE_HMAC_SECRET");
  const bridgeKeyId = "pcc-animation-v1";
  if (!bridgeUrl || !bridgeSecret) throw new Error("ANIMATION_POLICY_SOURCE_RESOLVER_NOT_CONFIGURED");
  return await resolveTrustedAnimationPolicyTyped({
    request,
    expectedSnapshot,
    resolveRegisteredPolicy: async (match: Record<string, unknown>) => {
      const { data, error } = await service.rpc("pcc_animation_channel_policy_control_v1", {
        p_action: "RESOLVE", p_subject: subject, p_payload: match,
      });
      if (error) throw new Error("REGISTERED_CHANNEL_POLICY_REQUIRED");
      return data;
    },
    verifySource: (policy: Record<string, unknown>) => resolveVerifiedAnimationPolicySourceTyped({
      url: bridgeUrl, secret: bridgeSecret, keyId: bridgeKeyId, policy,
    }),
  });
}

function policyErrorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "ANIMATION_POLICY_SOURCE_RESOLVER_UNAVAILABLE";
  if (/^(?:ANIMATION_POLICY_[A-Z0-9_]{1,72}|REGISTERED_CHANNEL_POLICY_REQUIRED|REGISTERED_CHANNEL_POLICY_MISMATCH|POLICY_SOURCE_SCOPE_MISMATCH|PSC_SOURCE_READ_FAILED|BOAS_REGISTRY_READ_FAILED|PCC_PMF_BRIDGE_AUTHENTICATION_FAILED|PCC_PMF_BRIDGE_NOT_CONFIGURED)$/.test(code)) {
    const status = /(?:NOT_CONFIGURED|READ_FAILED)$/.test(code) ? 503 : 409;
    return { status, error: code };
  }
  if (code === "ANIMATION_POLICY_RESOLVER_BINDINGS_REQUIRED") return { status: 400, error: code };
  if (code === "ANIMATION_POLICY_SOURCE_RESOLVER_NOT_CONFIGURED" || code === "PMF_BRIDGE_CONFIGURATION_INVALID") {
    return { status: 503, error: "ANIMATION_POLICY_SOURCE_RESOLVER_NOT_CONFIGURED" };
  }
  return { status: 503, error: "ANIMATION_POLICY_SOURCE_RESOLVER_UNAVAILABLE" };
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
  // Animation permissions reuse PCC's centrally managed Founder binding.
  // Authorization stays server-side and revocable through the trusted identity registry.
  if (!roles.has("ADMIN")) {
    const roleAuthority = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: isFounder, error: founderError } = await roleAuthority.rpc(
      "pcc_founder_private_subject",
      { p_subject: userData.user.id },
    );
    if (!founderError && isFounder === true) roles.add("ADMIN");
  }
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
    const bridgeUrl = Deno.env.get("PCC_PMF_BRIDGE_URL") ?? "https://oyjmpbuxvfxusmbouldi.supabase.co/functions/v1/pcc-animation-bridge-v1";
    const bridgeSecret = Deno.env.get("PCC_PMF_BRIDGE_HMAC_SECRET");
    const bridgeKeyId = "pcc-animation-v1";
    if (!bridgeUrl || !bridgeSecret) return json(503, { error: "ANIMATION_POLICY_SOURCE_RESOLVER_NOT_CONFIGURED" });
    try {
      registeredPolicy.policy_id = await resolveCanonicalAnimationPolicyIdTyped({
        url: bridgeUrl,
        secret: bridgeSecret,
        keyId: bridgeKeyId,
        approvalPscId: registeredPolicy.approval_psc_id as string,
      });
    } catch (error) {
      const failure = policyErrorResponse(error);
      return json(failure.status, { error: failure.error });
    }
    const candidate = { ...registeredPolicy, approved: true, revoked: false };
    try {
      await resolveTrustedAnimationPolicy({
        request: {
          channel_key: registeredPolicy.channel_key,
          output_type: registeredPolicy.output_type,
          production_intent: registeredPolicy.production_intent,
          source_scope: (registeredPolicy.output_spec as Record<string, unknown> | undefined)?.scope as Record<string, string> ?? {},
        },
        resolveRegisteredPolicy: async () => candidate,
        verifySource: (policy: Record<string, unknown>) => resolveVerifiedAnimationPolicySourceTyped({ url: bridgeUrl, secret: bridgeSecret, keyId: bridgeKeyId, policy }),
      });
    } catch (error) {
      const failure = policyErrorResponse(error);
      return json(failure.status, { error: failure.error });
    }
    const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await service.rpc("pcc_animation_channel_policy_control_v1", {
      p_action: "REGISTER", p_subject: userData.user.id, p_payload: registeredPolicy,
    });
    if (error || !data) return json(409, { error: "ANIMATION_POLICY_REGISTER_FAILED", code: error?.code ?? "UNKNOWN" });
    return json(201, { ok: true, policy: data, source_validation: "VERIFIED" });
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

  if (action === "RUNPOD_AVAILABILITY_SEARCH") {
    if (!roles.has("REQUEST") && !roles.has("REVIEW") && !roles.has("HANDOFF") && !roles.has("ADMIN")) {
      return json(403, { error: "ANIMATION_REQUEST_ROLE_REQUIRED" });
    }
    const bridgeUrl = Deno.env.get("PCC_PMF_BRIDGE_URL") ?? "https://oyjmpbuxvfxusmbouldi.supabase.co/functions/v1/pcc-animation-bridge-v1";
    const bridgeSecret = Deno.env.get("PCC_PMF_BRIDGE_HMAC_SECRET");
    const bridgeKeyId = "pcc-animation-v1";
    if (!bridgeUrl || !bridgeSecret) return json(503, { error: "RUNPOD_AVAILABILITY_NOT_CONFIGURED" });
    const scheduled = payload.scheduled === true;
    try {
      const result = await searchRunPodGpuAvailability({
        url: bridgeUrl, secret: bridgeSecret, keyId: bridgeKeyId, scheduled,
      });
      return json(200, { ok: true, availability: result, dispatch: "READ_ONLY_NO_RESERVATION_NO_START" });
    } catch {
      return json(503, { error: "RUNPOD_AVAILABILITY_SEARCH_UNAVAILABLE", dispatch: "READ_ONLY_NO_RESERVATION_NO_START" });
    }
  }

  if (action === "RUNPOD_AVAILABILITY_LATEST") {
    if (!roles.has("REQUEST") && !roles.has("REVIEW") && !roles.has("HANDOFF") && !roles.has("ADMIN")) {
      return json(403, { error: "ANIMATION_REQUEST_ROLE_REQUIRED" });
    }
    const bridgeUrl = Deno.env.get("PCC_PMF_BRIDGE_URL") ?? "https://oyjmpbuxvfxusmbouldi.supabase.co/functions/v1/pcc-animation-bridge-v1";
    const bridgeSecret = Deno.env.get("PCC_PMF_BRIDGE_HMAC_SECRET");
    const bridgeKeyId = "pcc-animation-v1";
    if (!bridgeUrl || !bridgeSecret) return json(503, { error: "RUNPOD_AVAILABILITY_NOT_CONFIGURED" });
    try {
      const availability = await readLatestRunPodAvailabilitySnapshot({
        url: bridgeUrl, secret: bridgeSecret, keyId: bridgeKeyId,
      });
      return json(200, { ok: true, availability, dispatch: "READ_ONLY_NO_RESERVATION_NO_START" });
    } catch {
      return json(503, { error: "RUNPOD_AVAILABILITY_SNAPSHOT_UNAVAILABLE", dispatch: "READ_ONLY_NO_RESERVATION_NO_START" });
    }
  }

  if (action === "RUNPOD_CONNECTION_STATUS") {
    if (!roles.has("REQUEST") && !roles.has("REVIEW") && !roles.has("HANDOFF") && !roles.has("ADMIN")) {
      return json(403, { error: "ANIMATION_REQUEST_ROLE_REQUIRED" });
    }
    const bridgeUrl = Deno.env.get("PCC_PMF_BRIDGE_URL") ?? "https://oyjmpbuxvfxusmbouldi.supabase.co/functions/v1/pcc-animation-bridge-v1";
    const bridgeSecret = Deno.env.get("PCC_PMF_BRIDGE_HMAC_SECRET");
    const bridgeKeyId = "pcc-animation-v1";
    if (!bridgeUrl || !bridgeSecret) {
      return json(503, { error: "RUNPOD_CONNECTION_CHECK_NOT_CONFIGURED", render_ready: false });
    }
    try {
      const connection = await readRunPodAnimationConnection({
        url: bridgeUrl, secret: bridgeSecret, keyId: bridgeKeyId,
      });
      return json(200, { ok: true, connection, dispatch: "READ_ONLY" });
    } catch {
      return json(503, { error: "RUNPOD_CONNECTION_STATUS_UNAVAILABLE", render_ready: false });
    }
  }


  if (action === "PMF_PRODUCTION_RUNTIME") {
    if (!roles.has("ADMIN")) return json(403, { error: "ANIMATION_PRODUCTION_ADMIN_REQUIRED" });
    const runtimeAction = text(payload.runtime_action, 32)?.toUpperCase() ?? "";
    if (!["REGISTER","READ"].includes(runtimeAction)) return json(400, { error: "PMF_PRODUCTION_RUNTIME_ACTION_INVALID" });
    const packet = payload.packet && !Array.isArray(payload.packet) && typeof payload.packet === "object"
      ? { ...(payload.packet as Record<string, unknown>) } : null;
    if (!packet) return json(400, { error: "PMF_PRODUCTION_RUNTIME_PACKET_REQUIRED" });
    if (runtimeAction === "REGISTER") packet.operator_subject = userData.user.id;
    if (runtimeAction === "READ") {
      const executionId = text(packet.execution_id, 36);
      if (!executionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(executionId)) {
        return json(400, { error: "PMF_PRODUCTION_EXECUTION_ID_REQUIRED" });
      }
      packet.execution_id = executionId;
    }
    const bridgeUrl = Deno.env.get("PCC_PMF_BRIDGE_URL") ?? "https://oyjmpbuxvfxusmbouldi.supabase.co/functions/v1/pcc-animation-bridge-v1";
    const bridgeSecret = Deno.env.get("PCC_PMF_BRIDGE_HMAC_SECRET");
    if (!bridgeUrl || !bridgeSecret) return json(503, { error: "PCC_PMF_BRIDGE_NOT_CONFIGURED" });
    try {
      const result = await invokePmfProductionRuntimeTyped({
        url: bridgeUrl, secret: bridgeSecret, keyId: "pcc-animation-v1",
        runtimeAction, packet,
      });
      return json(runtimeAction === "REGISTER" ? 202 : 200, { ok: true, runtime: result, dispatch: "GATED_BY_SYSTEMS_ADMISSION" });
    } catch (error) {
      const code = error instanceof Error && /^PMF_[A-Z0-9_]{1,96}$/.test(error.message)
        ? error.message : "PMF_PRODUCTION_RUNTIME_UNAVAILABLE";
      return json(409, { error: code, dispatch: "GATED_BY_SYSTEMS_ADMISSION" });
    }
  }

  if (action === "PMF_PRODUCTION_READINESS") {
    if (!roles.has("REQUEST") && !roles.has("REVIEW") && !roles.has("HANDOFF") && !roles.has("ADMIN")) return json(403, { error: "ANIMATION_REQUEST_ROLE_REQUIRED" });
    const bridgeUrl = Deno.env.get("PCC_PMF_BRIDGE_URL") ?? "https://oyjmpbuxvfxusmbouldi.supabase.co/functions/v1/pcc-animation-bridge-v1";
    const bridgeSecret = Deno.env.get("PCC_PMF_BRIDGE_HMAC_SECRET");
    const bridgeKeyId = "pcc-animation-v1";
    if (!bridgeUrl || !bridgeSecret) {
      return json(503, { error: "PMF_PRODUCTION_READINESS_NOT_CONFIGURED", render_dispatch: "DISABLED" });
    }
    try {
      const result = await readPmfAnimationProductionReadiness({
        url: bridgeUrl, secret: bridgeSecret, keyId: bridgeKeyId,
      });
      return json(200, {
        ok: true,
        readiness: result.readiness,
        contract: result.contract,
        dispatch: "READ_ONLY",
      });
    } catch {
      return json(503, { error: "PMF_PRODUCTION_READINESS_UNAVAILABLE", render_dispatch: "DISABLED" });
    }
  }

  if (action === "RENDER_REVIEW_URL") {
    if (!roles.has("REVIEW") && !roles.has("ADMIN")) return json(403, { error: "ANIMATION_RENDER_REVIEW_ROLE_REQUIRED" });
    const jobId = text(payload.job_id, 36);
    if (!jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
      return json(400, { error: "ANIMATION_JOB_ID_INVALID" });
    }
    const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: job, error } = await service.rpc("pcc_animation_job_control_v1", {
      p_action: "READ", p_subject: userData.user.id, p_payload: { job_id: jobId, can_review: true },
    });
    if (error || !job) return json(404, { error: "ANIMATION_JOB_NOT_FOUND" });
    const receipt = job.artifact_manifest?.pmf_render_receipt;
    const artifact = job.artifact_manifest?.artifact;
    if (job.status !== "QA" || job.artifact_manifest?.review_state !== "REVIEW_REQUIRED"
        || job.artifact_manifest?.private !== true || !receipt
        || receipt.pcc_request_id !== job.job_id || receipt.execution_id !== job.render_execution_id
        || receipt.state !== "ANIMATION_RECORDED_REVIEW_REQUIRED"
        || receipt.quality_approved !== false || receipt.distribution_performed !== false
        || artifact?.mime_type !== "video/mp4" || !/^[a-f0-9]{64}$/i.test(artifact?.sha256 ?? "")) {
      return json(409, { error: "ANIMATION_RENDER_NOT_READY_FOR_REVIEW" });
    }
    const bridgeUrl = Deno.env.get("PCC_PMF_BRIDGE_URL") ?? "https://oyjmpbuxvfxusmbouldi.supabase.co/functions/v1/pcc-animation-bridge-v1";
    const bridgeSecret = Deno.env.get("PCC_PMF_BRIDGE_HMAC_SECRET");
    const bridgeKeyId = "pcc-animation-v1";
    if (!bridgeUrl || !bridgeSecret) return json(503, { error: "PMF_REVIEW_PREVIEW_NOT_CONFIGURED" });
    try {
      const preview = await requestPmfAnimationReviewUrl({
        url: bridgeUrl, secret: bridgeSecret, keyId: bridgeKeyId,
        pccRequestId: job.job_id,
        executionId: job.render_execution_id,
        resultReceiptId: receipt.result_receipt_id,
        artifactSha256: artifact.sha256,
      });
      const { data: previewReceipt, error: previewError } = await service.rpc("pcc_animation_record_render_preview_v1", {
        p_subject: userData.user.id,
        p_payload: {
          job_id: job.job_id, execution_id: job.render_execution_id,
          result_receipt_id: receipt.result_receipt_id,
          artifact_sha256: artifact.sha256, expires_at: preview.expires_at,
        },
      });
      if (previewError || !previewReceipt
          || previewReceipt.reviewer_subject !== userData.user.id
          || previewReceipt.execution_id !== job.render_execution_id
          || previewReceipt.artifact_sha256 !== artifact.sha256) {
        return json(409, { error: "PCC_RENDER_PREVIEW_RECEIPT_FAILED" });
      }
      return json(200, { ok: true, preview, preview_receipt: previewReceipt });
    } catch {
      return json(503, { error: "PMF_REVIEW_PREVIEW_UNAVAILABLE" });
    }
  }

  if (action === "RENDER_REVIEW_DECISION") {
    if (!roles.has("REVIEW") && !roles.has("ADMIN")) return json(403, { error: "ANIMATION_RENDER_REVIEW_ROLE_REQUIRED" });
    const jobId = text(payload.job_id, 36);
    const decision = text(payload.decision, 32)?.toUpperCase();
    const notes = text(payload.notes, 2000);
    if (!jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)
        || !["APPROVE", "REQUEST_REVISION"].includes(decision ?? "") || !notes) {
      return json(400, { error: "PCC_RENDER_REVIEW_ARGUMENT_INVALID" });
    }
    const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await service.rpc("pcc_animation_record_render_decision_v1", {
      p_subject: userData.user.id,
      p_payload: { job_id: jobId, decision, notes },
    });
    if (error || !data) return json(409, { error: error?.message?.includes("PREVIEW_REQUIRED")
      ? "PCC_RENDER_REVIEW_PREVIEW_REQUIRED" : "PCC_RENDER_REVIEW_SAVE_FAILED" });
    return json(200, { ok: true, review_receipt: data, distribution_performed: false });
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
    const writingContextInput = sourceContext.writing_context;
    const writingContext: Record<string, string | number> = {};
    const writingContextFields = ["saga_id", "audience", "book_id", "book_number", "book_title", "volume_or_story_scope", "chapter_number", "chapter_title", "chapter_goal", "scene_number", "scene_goal", "point_of_view"];
    let writingContextInvalid = false;
    if (writingContextInput !== undefined && (!writingContextInput || Array.isArray(writingContextInput) || typeof writingContextInput !== "object")) writingContextInvalid = true;
    if (writingContextInput && !Array.isArray(writingContextInput) && typeof writingContextInput === "object") {
      for (const field of writingContextFields) {
        const value = (writingContextInput as Record<string, unknown>)[field];
        if (value === undefined || value === null || value === "") continue;
        if (typeof value === "string" && value.trim().length > 0 && value.length <= 4_000) writingContext[field] = value.trim();
        else if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) writingContext[field] = value;
        else writingContextInvalid = true;
      }
    }
    const seriesContext = optionalText(sourceContext.series_context, 160);
    const sourceSeriesId = optionalText(sourceContext.source_series_id, 160);
    const sourceEpisodeId = optionalText(sourceContext.source_episode_id, 160);
    const contextNotes = optionalText(sourceContext.context_notes, 6_000);
    const desiredEnding = optionalText(sourceContext.desired_ending_or_action, 4_000);
    const sourceScope = {
      ...(sourceSeriesId ? { series_id: sourceSeriesId } : {}),
      ...(sourceEpisodeId ? { episode_id: sourceEpisodeId } : {}),
      ...(writingContext.saga_id ? { saga_id: String(writingContext.saga_id) } : {}),
      ...(writingContext.book_id ? { book_id: String(writingContext.book_id) } : {}),
      ...(writingContext.book_number ? { book_number: String(writingContext.book_number) } : {}),
      ...(writingContext.chapter_number ? { chapter_number: String(writingContext.chapter_number) } : {}),
      ...(writingContext.scene_number ? { scene_number: String(writingContext.scene_number) } : {}),
    };
    const requestPayload = { intake: "PCC_ANIMATION_ENGINE_V1", series_context: seriesContext, source_scope: sourceScope, writing_context: writingContext, context_notes: contextNotes, desired_ending_or_action: desiredEnding };
    if (!idempotencyKey || idempotencyKey.length < 8 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)
      || !channelKey || !/^[a-z][a-z0-9_]{1,63}$/.test(channelKey)
      || !["EPISODE", "SERIES_EPISODE", "ANIMATION", "AD", "REEL", "MICRO_DRAMA", "NOVEL", "BOOK_MANUSCRIPT", "BOOK_CHAPTER", "BOOK_SCENE", "CORPORATE_MARKETING", "CORPORATE_JINGLE", "TV_SPOT", "TV_COMMERCIAL", "SOCIAL_MEDIA_CAMPAIGN", "OTHER"].includes(outputType ?? "")
      || !title
      || !idea
      || seriesContext === null || sourceSeriesId === null || sourceEpisodeId === null
      || (!!sourceSeriesId !== !!sourceEpisodeId)
      || contextNotes === null || desiredEnding === null || writingContextInvalid
      || !rawRequestPayload || Array.isArray(rawRequestPayload) || typeof rawRequestPayload !== "object") {
      return json(400, { error: "ANIMATION_REQUEST_INVALID" });
    }

    const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    let resolvedPolicy: Awaited<ReturnType<typeof resolveLiveAnimationPolicy>>;
    try {
      resolvedPolicy = await resolveLiveAnimationPolicy(service, userData.user.id, {
        channel_key: channelKey, output_type: outputType!, production_intent: productionIntent!, source_scope: sourceScope,
      });
    } catch (error) {
      const failure = policyErrorResponse(error);
      return json(failure.status, { error: failure.error, channel_key: channelKey, output_type: outputType });
    }
    const boundRequestPayload = {
      ...requestPayload,
      approved_channel_policy_snapshot: resolvedPolicy.snapshot,
      policy_source_verification: resolvedPolicy.verification,
    };
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
        request_payload: boundRequestPayload,
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

    let trustedPolicy: Awaited<ReturnType<typeof resolveLiveAnimationPolicy>>;
    try {
      const snapshot = job.request_payload?.approved_channel_policy_snapshot;
      if (!snapshot) return json(409, { error: "ANIMATION_POLICY_SNAPSHOT_REQUIRED" });
      trustedPolicy = await resolveLiveAnimationPolicy(service, userData.user.id, {
        channel_key: job.channel_key, output_type: job.output_type, production_intent: job.production_intent,
        source_scope: job.request_payload?.source_scope ?? {},
      }, snapshot);
    } catch (error) {
      const failure = policyErrorResponse(error);
      return json(failure.status, { error: failure.error, channel_key: job.channel_key, output_type: job.output_type });
    }
    const claimed = await service.rpc("pcc_animation_job_control_v1", {
      p_action: "CLAIM_SCRIPT",
      p_subject: userData.user.id,
      p_payload: { job_id: job.job_id, can_review: mayReview },
    });
    if (claimed.error || !claimed.data) return json(409, { error: "ANIMATION_SCRIPT_ALREADY_CLAIMED_OR_UNAVAILABLE" });

    try {
      const lifecycle = await executeAnimationWriteLifecycleTyped({
        job,
        trustedPolicy,
        canReview: mayReview,
        model: createScriptModel(modelKey, modelName),
        saveScript: async (savePayload: Record<string, unknown>) => await service.rpc("pcc_animation_job_control_v1", {
          p_action: "SAVE_SCRIPT",
          p_subject: userData.user.id,
          p_payload: savePayload,
        }),
      });
      return json(200, { ok: true, job: lifecycle.saved.data, script_state: lifecycle.result.state, dispatch: "NOT_CONNECTED" });
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
    let trustedPolicy: Awaited<ReturnType<typeof resolveLiveAnimationPolicy>>;
    try {
      const snapshot = job.request_payload?.approved_channel_policy_snapshot;
      if (!snapshot) return json(409, { error: "ANIMATION_POLICY_SNAPSHOT_REQUIRED" });
      trustedPolicy = await resolveLiveAnimationPolicy(service, userData.user.id, {
        channel_key: job.channel_key, output_type: job.output_type, production_intent: job.production_intent,
        source_scope: job.request_payload?.source_scope ?? {},
      }, snapshot);
    } catch (error) {
      const failure = policyErrorResponse(error);
      return json(failure.status, { error: failure.error });
    }
    const policy = trustedPolicy.policy as Record<string, unknown>;
    if (job.channel_policy_id !== policy.policy_id
        || job.channel_policy_revision !== policy.policy_revision
        || job.channel_policy_approval_psc_id !== policy.approval_psc_id
        || job.boas_id !== policy.boas_id || job.boas_revision !== policy.boas_revision
        || job.boas_psc_id !== policy.boas_psc_id || job.knoas_id !== policy.knoas_id
        || job.knoas_revision !== policy.knoas_revision || job.knoas_psc_id !== policy.knoas_psc_id) {
      return json(409, { error: "ANIMATION_SCRIPT_POLICY_LINEAGE_MISMATCH" });
    }
    let packet: Record<string, unknown>;
    try { packet = validateHandoffSource(job); }
    catch (error) { return json(409, { error: error instanceof Error ? error.message : "ANIMATION_HANDOFF_SOURCE_INVALID" }); }
    const { data, error } = await service.rpc("pcc_animation_job_control_v1", {
      p_action: "STAGE_HANDOFF", p_subject: userData.user.id,
      p_payload: { job_id: jobId, can_stage: true, packet },
    });
    if (error || !data) return json(409, { error: "ANIMATION_HANDOFF_STAGE_FAILED", code: error?.code ?? "UNKNOWN" });

    const bridgeUrl = Deno.env.get("PCC_PMF_BRIDGE_URL") ?? "https://oyjmpbuxvfxusmbouldi.supabase.co/functions/v1/pcc-animation-bridge-v1";
    const bridgeSecret = Deno.env.get("PCC_PMF_BRIDGE_HMAC_SECRET");
    const bridgeKeyId = "pcc-animation-v1";
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
    const { data: alerts, error: alertError } = await service.rpc("pcc_animation_replenishment_read_v1", {
      p_subject: userData.user.id,
    });
    return json(200, {
      ok: true,
      jobs: data,
      alerts: alertError || !Array.isArray(alerts) ? [] : alerts,
      alerts_available: !alertError && Array.isArray(alerts),
    });
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
