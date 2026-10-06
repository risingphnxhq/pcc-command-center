import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const corsHeaders={"access-control-allow-origin":"https://command.risingphoenixhq.com","access-control-allow-headers":"authorization, apikey, content-type","access-control-allow-methods":"POST, OPTIONS","content-type":"application/json","cache-control":"no-store"};
const response=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers:corsHeaders});
const scopes=new Set(["REGISTRY","EXECUTION","NHCE","CONTINUITY"]);
const limitOf=(v:unknown)=>Math.min(Math.max(Number(v)||25,1),100);\nconst FOREMAN_PSC="PCC-CSE-PSC-STREAM-FOREMAN-V0-PCC-CONSTRUCTION-CONTINUITY-2026-10-05-001";\nconst PCC_STREAM="ORG-PCC-006";\nconst PCC_BOAS="BOAS-ROOT-ORG-PCC-006";\nconst PCC_BUILD="PCC-BCR-PCC-RECONCILIATION-000001";

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
 const {data:binding,error:bindingError}=await service.schema("pcc_institutional").from("auth_actor_bindings").select("actor_id,status,metadata").eq("auth_subject",userData.user.id).eq("status","ACTIVE").maybeSingle();
 if(bindingError||!binding)return response({error:"SYSTEMS_READ_AUTHORITY_DENIED"},403);
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
  else data={
   incidents:await q("public","pcc_incidents","incident_id,created_at,updated_at,severity,incident_type,title,message,source_route,status","updated_at"),
   intelligence:await q("public","pcc_intelligence_events","event_id,created_at,updated_at,event_type,severity,title,message_operator,source_route,condition,repair_state,rerun_state,status","updated_at"),
   advisories:await q("public","pcc_advisory_outputs","advisory_id,created_at,updated_at,condition,severity,recommendation,priority_level,confidence_score,action_blocked,status","updated_at"),
   strategies:await q("public","pcc_strategy_outputs","strategy_id,created_at,updated_at,system_scope,condition,severity,detected_pattern,strategic_recommendation,risk_level,urgency,status","updated_at"),
   repairs:await q("public","pcc_repair_receipts","repair_id,created_at,mismatch_type,mismatch_code,severity,repairable,repair_action,repair_state,rerun_eligible,rerun_state","created_at")
  };
  return response({ok:true,scope,authenticated_subject:userData.user.id,actor_id:binding.actor_id,runtime_lane:String((binding.metadata as Record<string,unknown> | null)?.runtime_lane ?? "UNSPECIFIED"),source:"SYSTEMS_SUPABASE_AUTHORITY",read_at:new Date().toISOString(),data});
 }catch(e){return response({error:"SYSTEMS_READ_FAILED",detail:e instanceof Error?e.message:"UNKNOWN"},500);}
});