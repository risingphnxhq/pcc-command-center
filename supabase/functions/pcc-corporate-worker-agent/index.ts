import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest = /^[0-9a-f]{64}$/;
const workerActor = "corporate-patrick-ross-worker";
const commanderSubject = "d95ef35a-b6bc-4133-a8ff-0ee618b2b665";

// This route is for Patrick's distinct authenticated worker principal. HQ Founder
// sessions and the service-role key are never accepted as a worker credential.
Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const bearer = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer || bearer.startsWith("sb_") || bearer.split(".").length !== 3) {
    return json({ error: "WORKER_SIGN_IN_REQUIRED" }, 401);
  }
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "WORKER_ROUTE_NOT_CONFIGURED" }, 503);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: identity, error: identityError } = await admin.auth.getUser(bearer);
  const worker = identity.user;
  if (identityError || !worker?.email_confirmed_at ||
      worker.app_metadata?.rpe_actor_id !== workerActor ||
      worker.app_metadata?.rpe_identity_class !== "CORPORATE_SERVICE_WORKER") {
    return json({ error: "BOUND_WORKER_REQUIRED" }, 403);
  }
  if (Number(request.headers.get("Content-Length") || 0) > 4096) return json({ error: "REQUEST_TOO_LARGE" }, 413);
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return json({ error: "INVALID_REQUEST" }, 400); }
  const operation = typeof input.operation === "string" ? input.operation.trim().toUpperCase() : "";
  const taskId = typeof input.task_id === "string" ? input.task_id.trim() : "";
  if (!uuid.test(taskId) || !["CLAIM_TASK", "START_TASK", "SUBMIT_EVIDENCE", "COMPLETE_TASK"].includes(operation)) {
    return json({ error: "WORKER_OPERATION_AND_TASK_ID_REQUIRED" }, 400);
  }
  const { data: route, error: routeError } = await admin.rpc("pcc_resolve_corporate_task_worker", { p_task_id: taskId });
  if (routeError || route?.worker_subject !== worker.id || route?.actor_id !== workerActor) {
    return json({ error: "TASK_NOT_ASSIGNED_TO_WORKER" }, 403);
  }
  const outputSummary = typeof input.output_summary === "string" ? input.output_summary.trim() : null;
  const sourceRef = typeof input.source_ref === "string" ? input.source_ref.trim() : null;
  const outputDigest = typeof input.digest_sha256 === "string" ? input.digest_sha256.trim().toLowerCase() : null;
  if (operation === "SUBMIT_EVIDENCE" &&
      (!outputSummary || outputSummary.length < 20 || outputSummary.length > 2000 ||
       !sourceRef || sourceRef.length < 5 || sourceRef.length > 500 ||
       !outputDigest || !digest.test(outputDigest))) {
    return json({ error: "MATERIAL_OUTPUT_EVIDENCE_REQUIRED" }, 400);
  }
  const params = operation === "CLAIM_TASK" ? {
    p_commander_subject: commanderSubject, p_operation: operation,
    p_task_id: taskId, p_worker_subject: worker.id,
  } : {
    p_commander_subject: commanderSubject, p_operation: operation,
    p_task_id: taskId, p_worker_subject: worker.id,
    p_output_summary: outputSummary, p_source_ref: sourceRef, p_digest_sha256: outputDigest,
  };
  const { data, error } = await admin.rpc(operation === "CLAIM_TASK"
    ? "pcc_corporate_worker_command" : "pcc_corporate_worker_execution", params);
  if (error) return json({ error: error.code === "42501" ? "BOUND_WORKER_REQUIRED" : "WORKER_TRANSITION_REJECTED" }, error.code === "42501" ? 403 : 409);
  return json(data);
});
