import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (request.headers.get("Origin")) return json({ error: "SERVER_WORKER_ONLY" }, 403);
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) return json({ error: "JSON_REQUIRED" }, 415);
  if (Number(request.headers.get("Content-Length") || 0) > 4096) return json({ error: "REQUEST_TOO_LARGE" }, 413);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const publishable = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !serviceKey || !publishable) return json({ error: "SERVICE_UNAVAILABLE" }, 503);
  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return json({ error: "WORKER_AUTH_REQUIRED" }, 401);
  const auth = createClient(url, publishable, { auth: { persistSession: false } });
  const { data: identity, error: identityError } = await auth.auth.getUser(bearer);
  if (identityError || !identity.user) return json({ error: "WORKER_AUTH_REQUIRED" }, 401);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return json({ error: "INVALID_REQUEST" }, 400); }
  const assignmentId = input.assignment_id;
  if (typeof assignmentId !== "string" || !/^[A-Z0-9][A-Z0-9_-]{0,127}$/.test(assignmentId)) return json({ error: "ASSIGNMENT_REQUIRED" }, 400);
  const { data: route, error: routeError } = await admin.rpc("pcc_resolve_corporate_worker", { p_assignment_id: assignmentId });
  if (routeError || route?.worker_subject !== identity.user.id) return json({ error: "BOUND_CORPORATE_WORKER_REQUIRED" }, 403);
  const category = input.category, priority = input.priority, contact = input.requested_contact;
  const subject = input.subject, reason = input.reason_and_requested_outcome, source = input.source_or_evidence_ref;
  const confidentiality = input.confidentiality_scope;
  const due = input.due_at;
  const permittedCategory = route.office_id === 'PEGGY_WILSON' ? 'BUSINESS' :
    route.office_id === 'PATRICK_ROSS' ? 'SYSTEMS' : null;
  if (category !== permittedCategory || !['ROUTINE','TIME_SENSITIVE','URGENT'].includes(String(priority)) ||
      !['CONVERSATION','MEETING','DECISION','REVIEW'].includes(String(contact)) ||
      !['FOUNDER_PRIVATE','CORPORATE_RESTRICTED'].includes(String(confidentiality)) ||
      typeof subject !== 'string' || subject.length < 3 || subject.length > 160 ||
      typeof reason !== 'string' || reason.length < 10 || reason.length > 2000 ||
      typeof source !== 'string' || source.length < 3 || source.length > 240 ||
      (due != null && (typeof due !== 'string' || !Number.isFinite(Date.parse(due)))) ||
      (priority === 'URGENT' && due == null)) return json({ error: "INVALID_ATTENTION_REQUEST" }, 400);
  const { data, error } = await admin.rpc("pcc_officer_attention_store", { p_request: {
    requesting_office: route.office_id, category, priority, subject,
    reason_and_requested_outcome: reason, source_or_evidence_ref: source,
    confidentiality_scope: confidentiality, requested_contact: contact,
    related_mission_or_decision: typeof input.related_mission_or_decision === 'string' ? input.related_mission_or_decision.slice(0,240) : null,
    due_at: due || null, verified_worker_subject: identity.user.id, verified_at: new Date().toISOString(),
  } });
  if (error) return json({ error: error.code === '23505' ? 'ACTIVE_REQUEST_ALREADY_EXISTS' : 'ATTENTION_STORE_UNAVAILABLE' }, error.code === '23505' ? 409 : 503);
  return json({ request_id: data, status: "REQUESTED" }, 201);
});
