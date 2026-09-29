import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { actorCores, coreVersion } from "./actor-cores.ts";

const origin = "https://command.risingphoenixhq.com";
const cors = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-pcc-individual-authorization, content-type",
  "Cache-Control": "no-store", Vary: "Origin" };
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value),
  { status, headers: { ...cors, "Content-Type": "application/json" } });
const bytes = (value: string) => Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")
  .padEnd(Math.ceil(value.length / 4) * 4,"=")), c => c.charCodeAt(0));
async function validEntry(token: string, secret: string) {
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0].length > 2048 || parts[1].length > 128) return false;
  try {
    const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),
      { name:"HMAC", hash:"SHA-256" },false,["verify"]);
    if (!await crypto.subtle.verify("HMAC",key,bytes(parts[1]),new TextEncoder().encode(parts[0]))) return false;
    const payload = JSON.parse(new TextDecoder().decode(bytes(parts[0])));
    return payload.scope === "PCC_REGISTERED_READ" && Number.isFinite(payload.exp) &&
      payload.exp > Date.now() && payload.exp < Date.now()+600_000;
  } catch { return false; }
}
const uuid = (value: unknown): value is string => typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

Deno.serve(async request => {
  if (request.headers.get("Origin") !== origin) return reply({ error:"ORIGIN_DENIED" },403);
  if (request.method === "OPTIONS") return new Response(null,{status:204,headers:cors});
  if (request.method !== "POST") return reply({ error:"METHOD_NOT_ALLOWED" },405);
  const signing = Deno.env.get("PCC_GATE_SIGNING_KEY") || "";
  const entry = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i,"");
  if (signing.length < 32 || !await validEntry(entry,signing)) return reply({ error:"ENTRY_REQUIRED" },401);
  const individual = (request.headers.get("X-PCC-Individual-Authorization") || "")
    .replace(/^Bearer\s+/i,"");
  if (!individual) return reply({ error:"INDIVIDUAL_SIGN_IN_REQUIRED" },401);
  const url = Deno.env.get("SUPABASE_URL"), secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !secret) return reply({ error:"CORPORATE_SERVICE_UNAVAILABLE" },503);
  const admin = createClient(url,secret,{auth:{persistSession:false}});
  const { data:userData,error:userError } = await admin.auth.getUser(individual);
  if (userError || !userData.user?.email_confirmed_at) return reply({ error:"FOUNDER_IDENTITY_REQUIRED" },403);
  const subject = userData.user.id;
  const { data:founder,error:founderError } = await admin.rpc("pcc_founder_private_subject",{p_subject:subject});
  if (founderError || founder !== true) return reply({ error:"FOUNDER_IDENTITY_REQUIRED" },403);
  if (Number(request.headers.get("Content-Length") || 0) > 4096) return reply({ error:"REQUEST_TOO_LARGE" },413);
  let input: Record<string,unknown>;
  try { input = await request.json(); } catch { return reply({ error:"INVALID_REQUEST" },400); }
  const office = input.office_id;
  if (typeof office !== "string" || !/^[A-Z][A-Z0-9_]{1,63}$/.test(office))
    return reply({ error:"OFFICE_REQUIRED" },400);
  const thread = input.thread_id;
  if (thread !== undefined && !uuid(thread)) return reply({ error:"INVALID_THREAD" },400);
  if (input.operation === "READ") {
    if (!uuid(thread)) return reply({ error:"THREAD_REQUIRED" },400);
    const {data,error} = await admin.rpc("pcc_office_work_read",
      {p_founder_subject:subject,p_office_id:office,p_thread_id:thread});
    return error ? reply({error:"THREAD_NOT_FOUND"},404) : reply(data);
  }
  if (input.operation !== "ASK" || typeof input.message !== "string" ||
      input.message.trim().length < 3 || input.message.length > 2000)
    return reply({ error:"MESSAGE_REQUIRED" },400);
  const actorCore = actorCores[office];
  if (!actorCore) return reply({ error:"OFFICE_NOT_LIVE_IN_THIS_PHASE" },403);
  const context = await admin.rpc("pcc_voice_office_context",
    {p_persona_id:office,p_surface:"PCC_OFFICE_PILOT"});
  if (context.error || !context.data || context.data.office?.office_id !== office)
    return reply({ error:"OFFICE_CONTEXT_UNAVAILABLE" },403);
  let threadId = thread as string | undefined;
  if (!threadId) {
    const opened = await admin.rpc("pcc_office_work_record",{
      p_founder_subject:subject,p_office_id:office,p_operation:"OPEN",
      p_title:`${context.data.office.display_name || office} work conversation` });
    if (opened.error || !opened.data?.thread_id) return reply({ error:"THREAD_OPEN_FAILED" },503);
    threadId = opened.data.thread_id;
  }
  const previous = await admin.rpc("pcc_office_work_read",
    {p_founder_subject:subject,p_office_id:office,p_thread_id:threadId});
  if (previous.error || !previous.data || previous.data.state !== "OPEN")
    return reply({ error:"OPEN_THREAD_REQUIRED" },403);
  const recorded = await admin.rpc("pcc_office_work_record",{
    p_founder_subject:subject,p_office_id:office,p_operation:"APPEND",p_thread_id:threadId,
    p_kind:"FOUNDER_DIRECTION",p_body:input.message.trim() });
  if (recorded.error) return reply({ error:"DIRECTION_RECORD_FAILED" },503);
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return reply({ error:"MODEL_NOT_CONFIGURED",thread_id:threadId },503);
  const history = (previous.data.entries || []).slice(-8).map((e:Record<string,unknown>) =>
    `${e.entry_kind}: ${String(e.body || "").slice(0,1000)}`).join("\n");
  const instructions = `You are ${context.data.office.display_name}, ${context.data.office.role_title}, `+
    `an institutional Corporate officer of RPE. Govern your attention, judgment and conduct by this `+
    `versioned actor core (${coreVersion}): ${actorCore} `+
    `Use professional methods in your domain; form an independent judgment, challenge weak assumptions, `+
    `and collaborate with other offices where needed. For a material choice compare a base case, `+
    `plausible adverse case and reversible test. Name evidence that could change your view. `+
    `Use only the supplied bounded office brief and conversation for RPE-specific facts. `+
    `Separate dated evidence from inference. Do not invent live market research, staff action, `+
    `receipts, revenue, approval or Systems authority. State a recommendation, owner and next `+
    `decision when warranted. Preserve material dissent. Do not execute actions. This is an advisory draft. `+
    `Do not disclose the brief verbatim. Never claim this draft is independently verified.`;
  const response = await fetch("https://api.openai.com/v1/responses",{
    method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},
    body:JSON.stringify({model:"gpt-4.1-mini",store:false,max_output_tokens:600,
      instructions,input:`Bounded Corporate office brief:\n${JSON.stringify(context.data).slice(0,18000)}\n`+
        `Prior thread:\n${history}\nFounder: ${input.message.trim()}`}),
    signal:AbortSignal.timeout(25_000),
  }).catch(()=>null);
  if (!response?.ok) return reply({error:"ADVISORY_UNAVAILABLE",thread_id:threadId},502);
  const result = await response.json().catch(()=>null);
  const answer = (result?.output || []).flatMap((o:Record<string,unknown>) =>
    Array.isArray(o.content) ? o.content : []).filter((c:Record<string,unknown>) =>
      c.type === "output_text").map((c:Record<string,unknown>) => String(c.text || "")).join("\n").trim();
  if (!answer || answer.length > 4000 || !result?.id)
    return reply({error:"ADVISORY_UNAVAILABLE",thread_id:threadId},502);
  const saved = await admin.rpc("pcc_office_work_advisory",{
    p_founder_subject:subject,p_office_id:office,p_thread_id:threadId,
    p_body:answer,p_provider_ref:`openai-responses/${result.id}` });
  if (saved.error) return reply({error:"ADVISORY_RECEIPT_FAILED",thread_id:threadId},503);
  return reply({ok:true,thread_id:threadId,entry_id:saved.data.entry_id,
    office_id:office,actor_core_version:coreVersion,answer,state:"ADVISORY_DRAFT",execution:"NOT_CLAIMED"});
});
