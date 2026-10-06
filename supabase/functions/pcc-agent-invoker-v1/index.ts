import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const ALLOWED_ORIGIN = "https://command.risingphoenixhq.com";
const OPENAI_AGENT_ENDPOINT = "https://api.openai.com/v1/agents/sessions";
const GITHUB_CAPABILITY = "PCC_GITHUB_EXECUTOR";

function headers() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}
function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: headers() });
}
function safeError(value: unknown) {
  return value instanceof Error ? value.message : String(value ?? "UNKNOWN_ERROR");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers() });
  if (req.method !== "POST") return json(405, { ok: false, error: "METHOD_NOT_ALLOWED" });

  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return json(401, { ok: false, error: "BEARER_TOKEN_REQUIRED" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(503, { ok: false, error: "INVOKER_DATABASE_CONFIGURATION_MISSING" });
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authorization.slice(7).trim();
  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData.user) {
    return json(401, { ok: false, error: "AUTHENTICATED_RUNTIME_REQUIRED" });
  }
  const runtimeSubject = userData.user.id;

  let body: { action?: string; execution_id?: string; work_order_id?: string };
  try { body = await req.json(); }
  catch { return json(400, { ok: false, error: "INVALID_JSON" }); }

  const action = String(body.action ?? "").trim().toUpperCase();
  const apiKey = Deno.env.get("PCC_OPENAI_API_KEY") ?? "";
  const model = Deno.env.get("PCC_AGENT_MODEL") ?? "";

  if (action === "READINESS") {
    const { data, error } = await db.rpc("pcc_workforce_adapter_v1", {
      p_auth_subject: runtimeSubject, p_action: "HEALTH", p_payload: {},
    });
    if (error) return json(403, { ok: false, error: "PCC_IDENTITY_GATE_DENIED" });
    return json(200, {
      ok: true, invoker: "PCC_AGENT_INVOKER_V1", version: 3,
      identity_gate: data,
      openai_api_configured: Boolean(apiKey),
      agent_model_configured: Boolean(model),
      execution_environment: "PCC_GOVERNED_CAPABILITY_ENVELOPE",
      launch_ready: Boolean(apiKey && model),
      supported_actions: ["READINESS", "DISPATCH", "LAUNCH"],
      capability_classes: [GITHUB_CAPABILITY],
    });
  }

  if (action !== "DISPATCH" && action !== "LAUNCH") {
    return json(400, { ok: false, error: "UNSUPPORTED_ACTION" });
  }
  if (!apiKey || !model) {
    return json(503, {
      ok: false, error: "AGENT_RUNTIME_CONFIGURATION_MISSING",
      required_managed_configuration: [
        !apiKey ? "PCC_OPENAI_API_KEY" : null,
        !model ? "PCC_AGENT_MODEL" : null,
      ].filter(Boolean),
    });
  }

  let executionId = String(body.execution_id ?? "").trim();
  let dispatchReceipt: Record<string, unknown> | null = null;

  if (action === "DISPATCH") {
    const workOrderId = String(body.work_order_id ?? "").trim();
    if (!workOrderId) return json(400, { ok: false, error: "WORK_ORDER_ID_REQUIRED" });

    const { data, error } = await db.rpc("pcc_agent_dispatch_v1", {
      p_auth_subject: runtimeSubject,
      p_work_order_id: workOrderId,
      p_provider: "OPENAI_AGENT_API",
    });
    if (error) {
      const message = String(error.message ?? "AGENT_DISPATCH_FAILED");
      const forbidden = message.includes("ACTIVE_ACTOR_BINDING_REQUIRED") ||
        message.includes("MASON_SYSTEMS_COMMAND_REQUIRED") ||
        message.includes("CLAIMED_RUNTIME_REQUIRED") ||
        message.includes("ACTOR_MISMATCH");
      const conflict = message.includes("EXPIRED") || message.includes("NOT_DISPATCHABLE");
      return json(forbidden ? 403 : conflict ? 409 : 400, {
        ok: false, error: message.replace(/^.*?:\s*/, ""),
      });
    }
    dispatchReceipt = data as Record<string, unknown>;
    executionId = String(data?.execution_id ?? "").trim();
  }

  if (!executionId) return json(400, { ok: false, error: "EXECUTION_ID_REQUIRED" });

  const { data: contextResult, error: contextError } = await db.rpc("pcc_workforce_adapter_v1", {
    p_auth_subject: runtimeSubject,
    p_action: "READ_AGENT_EXECUTION",
    p_payload: { execution_id: executionId },
  });
  if (contextError || contextResult?.status !== "FOUND") {
    return json(403, { ok: false, error: "AGENT_EXECUTION_CONTEXT_DENIED" });
  }

  const context = contextResult.execution_context;
  const execution = context?.execution;
  if (execution?.runtime_subject !== runtimeSubject) {
    return json(403, { ok: false, error: "REGISTERED_RUNTIME_REQUIRED" });
  }
  if (execution?.status === "ACTIVE" && execution?.provider_conversation_ref) {
    return json(200, {
      ok: true, invoker: "PCC_AGENT_INVOKER_V1", version: 3,
      status: "ACTIVE", idempotent: true, execution_id: executionId,
      provider: execution.provider,
      provider_session_ref: execution.provider_conversation_ref,
      model_route: execution.model_route,
      capability_classes: [GITHUB_CAPABILITY],
      dispatch_receipt: dispatchReceipt,
    });
  }
  if (execution?.status !== "REGISTERED") {
    return json(409, {
      ok: false, error: "AGENT_EXECUTION_NOT_REGISTERED", status: execution?.status,
    });
  }

  const instructions = [
    "You are a replaceable RPE Systems workforce execution lane governed by Phoenix Command Center.",
    "PCC, PSC, BOAS, Build Control, the work order, and the supplied authority envelope—not the model provider—define identity, role, mission, and authority.",
    "Do not invent missing Canon, source, runtime state, authorization, completion, testing, or certification.",
    "Unknown means retrieve or report blocked. It does not mean rebuild.",
    "Infrastructure actions are permitted only through PCC-governed capability adapters explicitly present in the execution authority envelope.",
    "Never request, expose, persist, or directly use infrastructure credentials. Capability adapters own credentials and enforce target policy.",
    "GitHub execution, when authorized, must use the PCC governed GitHub executor with bounded repository, ref, path, operation, BOAS and Build Control policy.",
    "No direct-main autonomous mutation, no Gate 4 or Gate 5 self-authorization, and no self-audit or self-certification.",
    "Every material action must terminate in physical readback and durable PCC evidence or receipt.",
    "Return material progress, evidence, blockers, and required capability calls for durable PCC checkpointing.",
  ].join("\n");

  const input = [
    "PCC AGENT EXECUTION ACTIVATION",
    "Treat the following bounded PCC context as the controlling work envelope for this session.",
    JSON.stringify({
      institution: "RPE",
      execution_id: executionId,
      actor_id: execution.actor_id,
      runtime_subject: execution.runtime_subject,
      stream: context.stream,
      work_order: context.work_order,
      latest_checkpoint: context.latest_checkpoint,
      capability_envelope: {
        default: "DENY",
        available_capability_classes: [GITHUB_CAPABILITY],
        authority_source: "PCC_WORK_ORDER_BOAS_BUILD_CONTROL",
        credential_access: "DENIED_TO_AGENT",
        gate4: "DENIED",
        gate5: "DENIED",
      },
    }),
  ].join("\n\n");

  let providerResponse: Response;
  try {
    providerResponse = await fetch(OPENAI_AGENT_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "OpenAI-Beta": "agents=v1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agent: { model, instructions },
        environment: { type: "none" },
        input,
        stream: false,
      }),
    });
  } catch (error) {
    return json(502, { ok: false, error: "OPENAI_AGENT_TRANSPORT_FAILED", detail: safeError(error) });
  }

  const providerBody = await providerResponse.json().catch(() => ({}));
  if (!providerResponse.ok) {
    return json(502, {
      ok: false, error: "OPENAI_AGENT_SESSION_REJECTED",
      provider_status: providerResponse.status,
      provider_error: providerBody?.error?.code ?? providerBody?.error?.type ?? "UNSPECIFIED",
      execution_id: executionId, dispatch_receipt: dispatchReceipt,
    });
  }

  const sessionId = String(providerBody?.id ?? providerBody?.session_id ?? "").trim();
  if (!sessionId) {
    return json(502, { ok: false, error: "OPENAI_AGENT_SESSION_ID_MISSING", execution_id: executionId });
  }

  const { data: activationResult, error: activationError } = await db.rpc("pcc_workforce_adapter_v1", {
    p_auth_subject: runtimeSubject,
    p_action: "ACTIVATE_AGENT_EXECUTION",
    p_payload: { execution_id: executionId, provider_conversation_ref: sessionId, model_route: model },
  });
  if (activationError) {
    return json(502, {
      ok: false, error: "PCC_AGENT_ACTIVATION_RECEIPT_FAILED",
      provider_session_created: true, execution_id: executionId,
    });
  }

  const { data: checkpointResult, error: checkpointError } = await db.rpc("pcc_workforce_adapter_v1", {
    p_auth_subject: runtimeSubject,
    p_action: "WRITE_CHECKPOINT",
    p_payload: {
      stream_id: execution.stream_id,
      work_order_id: execution.work_order_id,
      checkpoint_type: "AGENT_RUNTIME_ACTIVATION",
      state: "AGENT_RUNTIME_ACTIVE",
      summary: "PCC Agent runtime launched with a fail-closed governed capability envelope.",
      evidence: {
        execution_id: executionId,
        provider: "OPENAI_AGENTS_API",
        provider_session_ref: sessionId,
        model_route: model,
        capability_classes: [GITHUB_CAPABILITY],
        credential_access: "DENIED_TO_AGENT",
        activation_receipt_id: activationResult?.receipt_id ?? null,
      },
    },
  });
  if (checkpointError) {
    return json(502, {
      ok: false, error: "PCC_AGENT_CHECKPOINT_RECEIPT_FAILED",
      provider_session_created: true, execution_id: executionId,
      activation_receipt: activationResult,
    });
  }

  return json(200, {
    ok: true, invoker: "PCC_AGENT_INVOKER_V1", version: 3,
    status: "ACTIVE", execution_id: executionId,
    provider: "OPENAI_AGENT_API", provider_session_ref: sessionId,
    model_route: model, capability_classes: [GITHUB_CAPABILITY],
    dispatch_receipt: dispatchReceipt,
    activation_receipt: activationResult, checkpoint_receipt: checkpointResult,
  });
});