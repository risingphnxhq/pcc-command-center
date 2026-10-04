import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const EXECUTOR = "PCC_PRIME_SYSTEMS_EXECUTOR_V1";
const PRINCIPAL = "PCC_PRIME_SYSTEMS_EXECUTOR";
const KEY_NAME = "pcc-prime-systems-executor";
const READ_ONLY = new Set(["STATUS", "READ"]);
const MUTATIONS = new Set(["START_GATE", "RECORD_EVIDENCE", "SET_GATE_OUTCOME"]);

function json(status:number, body:Record<string,unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {"content-type":"application/json","cache-control":"no-store"}
  });
}

export default {
  fetch: withSupabase({ auth: "secret:pcc-prime-systems-executor" }, async (req, ctx) => {
    if (req.method !== "POST") return json(405,{ok:false,executor:EXECUTOR,error:"POST_REQUIRED"});
    let body: { action?: string; payload?: Record<string,unknown> };
    try { body = await req.json(); }
    catch { return json(400,{ok:false,executor:EXECUTOR,error:"INVALID_JSON"}); }

    const action = String(body.action ?? "").trim().toUpperCase();
    const payload = body.payload ?? {};
    if (!action) return json(400,{ok:false,executor:EXECUTOR,error:"ACTION_REQUIRED"});

    if (READ_ONLY.has(action)) {
      return json(200,{
        ok:true, executor:EXECUTOR, service_principal_id:PRINCIPAL,
        auth_mode:ctx.authMode, credential_scope:KEY_NAME, action,
        state:"GOVERNED_EXECUTOR_ACTIVE", build_control_mutation:true,
        allowed_gate_codes:["0","1","2","3"], gate4:"DENIED", gate5:"DENIED"
      });
    }

    if (!MUTATIONS.has(action)) {
      return json(403,{ok:false,executor:EXECUTOR,action,error:"SERVICE_ACTION_NOT_AUTHORIZED"});
    }

    const { data, error } = await ctx.supabase.rpc("pcc_build_control_service_gate_v1", {
      p_service_principal_id: PRINCIPAL,
      p_credential_scope: KEY_NAME,
      p_action: action,
      p_payload: payload
    });

    if (error) return json(500,{ok:false,executor:EXECUTOR,action,error:"GOVERNED_RPC_FAILURE"});
    const denied = data?.status === "DENIED" || data?.status === "NOT_FOUND";
    return json(denied ? 403 : 200,{
      ok:!denied, executor:EXECUTOR, auth_mode:ctx.authMode,
      credential_scope:KEY_NAME, action, result:data
    });
  })
};
