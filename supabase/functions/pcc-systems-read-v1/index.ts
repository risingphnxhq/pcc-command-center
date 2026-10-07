import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const corsHeaders={"access-control-allow-origin":"https://command.risingphoenixhq.com","access-control-allow-headers":"authorization, apikey, content-type","access-control-allow-methods":"POST, OPTIONS","content-type":"application/json","cache-control":"no-store"};
const response=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers:corsHeaders});
const scopes=new Set(["REGISTRY","EXECUTION","NHCE","CONTINUITY"]);
const limitOf=(v:unknown)=>Math.min(Math.max(Number(v)||25,1),100);
const FOREMAN_PSC="PCC-CSE-PSC-STREAM-FOREMAN-V0-PCC-CONSTRUCTION-CONTINUITY-2026-10-05-001";
const PCC_STREAM="ORG-PCC-006";
const PCC_BOAS="BOAS-ROOT-ORG-PCC-006";
const PCC_BUILD="PCC-BCR-PCC-RECONCILIATION-000001";

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:corsHeaders});
 if(req.method!=="POST")return response({error:"POST_REQUIRED"},405);
 const authorization=req.headers.get("authorization")??"";
 const publishableKey=req.headers.get("apikey")??"";
 if(!authorization.startsWith("Bearer ")||!publishableKey)return response({error:"AUTHENTICATION_REQUIRED"},401);
 const url=Deno.env.get("SUPABASE_URL"),serviceRole=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!serviceRole)return response({error:"PCC_RUNTIME_CONFIGURATION_MISSING"},503);
 const caller=createClient(url,publishableKey,{global:{headers:{Authorization:authorization}}});
 const {data:userData,error:userError}=await caller.auth.getUser();
 if(userError||!userData.user)return response({error:"AUTHENTICATED_SUBJECT_REQUIRED"},401);
 const service=createClient(url,serviceRole);
 const {data:scope,error:bindingError}=await service.rpc("pcc_audit_testing_gateway_v1",{p_auth_subject:userData.user.id,p_action:"HEALTH",p_payload:{}});\n const binding=scope&&["PRIME_BUILD_RUNTIME","READY"].includes(String(scope.status??""))?{actor_id:"RPE-MASON-HQ",status:"ACTIVE",metadata:{runtime_lane:String(scope.runtime_lane??"PRIME_MASON_ACCOUNT")}}:null;
 if(bindingError)return response({error:"SYSTEMS_READ_AUTHORITY_DENIED",reason:"BINDING_LOOKUP_FAILED",code:bindingError.code??"UNKNOWN"},403);
 if(!binding)return response({error:"SYSTEMS_READ_AUTHORITY_DENIED",reason:"ACTIVE_BINDING_NOT_FOUND"},403);
 const body=await req.json().catch(()=>({}));
 const scope=String(body.scope??"").toUpperCase(),limit=limitOf(body.limit);
 if(!scopes.has(scope))return response({error:"READ_SCOPE_NOT_PERMITTED"},403);
 const q=async(schema:string,table:string,select:string,order?:string)=>{
   let query=(schema==="public"?service:service.schema(schema)).from(table).select(select).limit(limit);
   if(order)query=query.order(order,{ascending:false});
   const {data,error}=await query;if(error)throw new Error(table+":"+error.message);return data??[];
 };
 try{
  let data:Record<string,unknown>;
  if(scope==="REGISTRY")data={
   systems:await q("public","pcc_systems","pcc_system_id,system_name,canon_id,system_class,status,governance_enabled,updated_at","updated_at"),
   versions:await q("public","pcc_versions","version_id,pcc_system_id,version_name,version_number,revision_number,status,is_active,created_at","created_at"),
   targets:await q("public","pcc_target_registry","target_key,connector,target_type,allowed_actions,validation_method,verify_method,test_method,rollback_method,risk_level"),
   streams:await q("pcc_institutional","system_stream_registry","system_stream_id,system_code,system_name,system_class,boas_root_id,lifecycle_state,boas_state,pcc_registration_status,version_status,updated_at","updated_at"),
   boas:await q("pcc_institutional","boas_registry","boas_root_id,system_stream_id,system_code,system_name,version,build_control_id,audit_state,certification_state,registry_state,updated_at","updated_at")
  };
  else if(scope==="EXECUTION")data={
   receipts:await q("public","pcc_execution_receipts","receipt_id,command_id,action,system,status,created_at,condition,source_route,severity,platform","created_at"),
   validations:await q("public","pcc_validation_runs","validation_id,created_at,packet_id,target_id,status,result","created_at"),
   tests:await q("public","pcc_test_runs","test_id,created_at,packet_id,target_id,status,result","created_at"),
   agent_executions:await q("pcc_workforce","agent_executions","execution_id,stream_id,work_order_id,actor_id,provider,provider_account_lane,status,latest_receipt_id,latest_output_status,latest_output_at,started_at,ended_at","updated_at")
  };
  else if(scope==="NHCE")data={
   incidents:await q("public","pcc_incidents","incident_id,created_at,updated_at,severity,incident_type,title,message,source_route,status","updated_at"),
   intelligence:await q("public","pcc_intelligence_events","event_id,created_at,updated_at,event_type,severity,title,message_operator,source_route,condition,repair_state,rerun_state,status","updated_at"),
   advisories:await q("public","pcc_advisory_outputs","advisory_id,created_at,updated_at,condition,severity,recommendation,priority_level,confidence_score,action_blocked,status","updated_at"),
   strategies:await q("public","pcc_strategy_outputs","strategy_id,created_at,updated_at,system_scope,condition,severity,detected_pattern,strategic_recommendation,risk_level,urgency,status","updated_at"),
   repairs:await q("public","pcc_repair_receipts","repair_id,created_at,mismatch_type,mismatch_code,severity,repairable,repair_action,repair_state,rerun_eligible,rerun_state","created_at")
  };
  else {
   if(binding.actor_id!=="RPE-MASON-HQ")return response({error:"CONTINUITY_AUTHORITY_DENIED"},403);
   const foreman=await service.from("phoenix_canon_records").select("psc_id,canon_state,current_build_position,next_authorized_step").eq("psc_id",FOREMAN_PSC).maybeSingle();
   const stream=await service.schema("pcc_institutional").from("system_stream_registry").select("system_stream_id,system_code,system_name,boas_root_id,lifecycle_state").eq("system_stream_id",PCC_STREAM).maybeSingle();
   const boas=await service.schema("pcc_institutional").from("boas_registry").select("boas_root_id,system_stream_id,system_code,system_name,version,build_control_id,registry_state").eq("boas_root_id",PCC_BOAS).maybeSingle();
   const build=await service.schema("pcc_institutional").from("build_control_records").select("build_control_id,state,build_owner_actor_id,assurance_runtime_lane,system_stream_id,boas_root_id,system_code,version,protocol_psc_id").eq("build_control_id",PCC_BUILD).maybeSingle();
   const gates=await service.schema("pcc_institutional").from("build_control_gates").select("gate_code,gate_name,state").eq("build_control_id",PCC_BUILD).order("gate_code",{ascending:true});
   const sync=await service.schema("pcc_institutional").from("workforce_sync_state").select("actor_id,state_version,sync_state,last_memory_sync_at,next_memory_sync_due_at,last_context_fingerprint").eq("actor_id",binding.actor_id).maybeSingle();
   const failure=foreman.error||stream.error||boas.error||build.error||gates.error||sync.error;
   if(failure)throw new Error("CONTINUITY_READ_FAILED");
   const complete=[foreman.data,stream.data,boas.data,build.data,sync.data].every(Boolean);
   data={continuity_state:complete?"RECONCILIATION_REQUIRED":"CONTEXT_REHYDRATION_REQUIRED",acknowledged:false,foreman:foreman.data,stream:stream.data,boas:boas.data,build_control:build.data,gates:gates.data??[],psc_d:sync.data,next_action:complete?"RECONCILE_THEN_ACK_VIA_PCC_WORKFORCE_SYNC_V1":"RECOVER_MISSING_CONTINUITY_EVIDENCE"};
  };
  return response({ok:true,scope,authenticated_subject:userData.user.id,actor_id:binding.actor_id,runtime_lane:String((binding.metadata as Record<string,unknown> | null)?.runtime_lane ?? "UNSPECIFIED"),source:"SYSTEMS_SUPABASE_AUTHORITY",read_at:new Date().toISOString(),data});
 }catch(e){return response({error:"SYSTEMS_READ_FAILED",detail:e instanceof Error?e.message:"UNKNOWN"},500);}
});