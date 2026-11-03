import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveOutputRoute } from "./output-route-resolver.mjs";
import { validateReviewDecision } from "./review-adjudication.mjs";
import { validateDispatchAttempt } from "./dispatch-ledger.mjs";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "pcc-workspace-intake";
const ACTOR = "RPE-MASON-HQ";
const LANES = new Set(["PRIME_MASON_ACCOUNT", "NEW_MASON_ACCOUNT"]);
const KINDS = new Set(["BOOK","AD","REEL","SHORT","EPISODE","SERIES","IMAGE","VIDEO","AUDIO","DOCUMENT","CONCEPT","OTHER"]);
const MIMES = new Set(["image/png","image/jpeg","image/webp","image/gif","audio/mpeg","audio/wav","audio/mp4","audio/ogg","audio/webm","video/mp4","video/webm","application/pdf","text/plain","application/json","application/zip","application/x-zip-compressed","application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const reply = (status:number, data:Record<string,unknown>) => new Response(JSON.stringify(data),{status,headers:cors});
const text = (v:unknown,n:number) => typeof v === "string" ? v.slice(0,n) : "";
async function hash(data:Uint8Array|string):Promise<string>{
  const bytes=typeof data==="string"?new TextEncoder().encode(data):data;
  const result=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(result)).map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function bindingForEmail(email:string){
 const {data:rows,error}=await admin.schema("pcc_institutional").from("auth_actor_bindings").select("auth_subject,actor_id,binding_class,status,valid_from,valid_until,metadata").eq("actor_id",ACTOR).eq("status","ACTIVE");
 if(error)throw Error("AUTHORITY_LOOKUP_FAILED");const now=Date.now();
 const b=(rows||[]).find((x:any)=>LANES.has(x.metadata?.runtime_lane)&&String(x.metadata?.auth_email||"").toLowerCase()===email.toLowerCase()&&["DIRECT_ACTOR","DELEGATED_RUNTIME"].includes(x.binding_class)&&Date.parse(x.valid_from)<=now&&(!x.valid_until||Date.parse(x.valid_until)>=now));
 if(!b)throw Error("WORKSPACE_BINDING_REQUIRED");return b;
}
async function bindingForSubject(subject:string,lane:string){
 const {data:rows,error}=await admin.schema("pcc_institutional").from("auth_actor_bindings").select("actor_id,binding_class,status,valid_from,valid_until,metadata").eq("auth_subject",subject).eq("actor_id",ACTOR).eq("status","ACTIVE");
 if(error)throw Error("AUTHORITY_LOOKUP_FAILED");const now=Date.now();
 const b=(rows||[]).find((x:any)=>LANES.has(x.metadata?.runtime_lane)&&x.metadata?.runtime_lane===lane&&["DIRECT_ACTOR","DELEGATED_RUNTIME"].includes(x.binding_class)&&Date.parse(x.valid_from)<=now&&(!x.valid_until||Date.parse(x.valid_until)>=now));
 if(!b)throw Error("WORKSPACE_BINDING_REQUIRED");return b;
}
async function authorize(req:Request){
 const header=req.headers.get("authorization")||"";const token=header.startsWith("Bearer ")?header.slice(7).trim():"";if(!token)throw Error("UNAUTHENTICATED");
 if(token.startsWith("pccwi_")){
  const digest=await hash(token);
  const {data:k,error}=await admin.from("pcc_workspace_ingest_keys_v1").select("key_id,created_by_auth_subject,actor_id,runtime_lane,status,expires_at").eq("token_sha256",digest).eq("status","ACTIVE").maybeSingle();
  if(error||!k)throw Error("UNAUTHENTICATED");if(Date.parse(k.expires_at)<=Date.now()){await admin.from("pcc_workspace_ingest_keys_v1").update({status:"EXPIRED"}).eq("key_id",k.key_id);throw Error("UNAUTHENTICATED");}
  await bindingForSubject(k.created_by_auth_subject,k.runtime_lane);
  await admin.from("pcc_workspace_ingest_keys_v1").update({last_used_at:new Date().toISOString()}).eq("key_id",k.key_id);
  return{subject:k.created_by_auth_subject,actor:k.actor_id,lane:k.runtime_lane,authMode:"ACTION_KEY",keyId:k.key_id};
 }
 const userClient=createClient(URL,ANON,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:"Bearer "+token}}});
 const {data,error}=await userClient.auth.getUser(token);if(error||!data.user?.id||!data.user.email)throw Error("UNAUTHENTICATED");
 const b=await bindingForEmail(data.user.email);
 return{subject:data.user.id,actor:ACTOR,lane:b.metadata.runtime_lane,authMode:"USER_JWT"};
}
function randomToken(){
 const bytes=crypto.getRandomValues(new Uint8Array(32));
 return "pccwi_"+btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
}
async function createActionKey(b:any,w:any){
 if(w.authMode!=="USER_JWT")return reply(403,{error:"USER_SIGN_IN_REQUIRED_TO_CREATE_KEY"});
 const label=text(b.key_label,100).trim();if(!label)return reply(400,{error:"KEY_LABEL_REQUIRED"});
 const token=randomToken(),digest=await hash(token),expires=new Date(Date.now()+90*24*60*60*1000).toISOString();
 const {data,error}=await admin.from("pcc_workspace_ingest_keys_v1").insert({created_by_auth_subject:w.subject,actor_id:w.actor,runtime_lane:w.lane,key_label:label,token_sha256:digest,expires_at:expires}).select("key_id,key_label,status,created_at,expires_at").single();
 if(error)throw Error("KEY_CREATE_FAILED");
 return reply(200,{key_id:data.key_id,key_label:data.key_label,status:data.status,created_at:data.created_at,expires_at:data.expires_at,api_key:token,shown_once:true,scope:["pcc-workspace-ingest-v1:submit","pcc-workspace-ingest-v1:finalize"],warning:"Copy this key into this GPT Action's Bearer API key now. It cannot be read again."});
}
async function listActionKeys(w:any){
 if(w.authMode!=="USER_JWT")return reply(403,{error:"USER_SIGN_IN_REQUIRED"});
 const {data,error}=await admin.from("pcc_workspace_ingest_keys_v1").select("key_id,key_label,status,created_at,expires_at,last_used_at").eq("created_by_auth_subject",w.subject).eq("runtime_lane",w.lane).order("created_at",{ascending:false});
 if(error)throw Error("KEY_LIST_FAILED");return reply(200,{keys:data||[]});
}
async function revokeActionKey(b:any,w:any){
 if(w.authMode!=="USER_JWT")return reply(403,{error:"USER_SIGN_IN_REQUIRED"});
 const id=text(b.key_id,64);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return reply(400,{error:"INVALID_KEY_ID"});
 const {data,error}=await admin.from("pcc_workspace_ingest_keys_v1").update({status:"REVOKED",revoked_at:new Date().toISOString()}).eq("key_id",id).eq("created_by_auth_subject",w.subject).eq("runtime_lane",w.lane).eq("status","ACTIVE").select("key_id,status").maybeSingle();
 if(error)throw Error("KEY_REVOKE_FAILED");if(!data)return reply(404,{error:"ACTIVE_KEY_NOT_FOUND"});return reply(200,{key_id:data.key_id,status:data.status});
}
function idemOk(v:unknown):v is string{return typeof v==="string"&&v.length>=8&&v.length<=128&&/^[A-Za-z0-9._:-]+$/.test(v);}
async function issueTickets(items:any[]){
  const out=[];
  for(const a of items){
    if(a.status==="VERIFIED") continue;
    const {data,error}=await admin.storage.from(BUCKET).createSignedUploadUrl(a.object_path,{upsert:false});
    if(error||!data) throw new Error("UPLOAD_TICKET_FAILED");
    out.push({asset_id:a.asset_id,file_name:a.file_name,mime_type:a.mime_type,expected_size_bytes:a.expected_size_bytes,expected_sha256:a.expected_sha256,bucket:BUCKET,object_path:a.object_path,signed_upload_url:data.signedUrl,upload_token:data.token});
  }
  return out;
}

async function hasWorkspaceReviewAuthority(w:any){
 if(w.authMode!=="USER_JWT")return false;
 const {data:bindings,error:bErr}=await admin.schema("pcc_institutional").from("auth_actor_bindings")
  .select("actor_id,binding_class,status,valid_from,valid_until,metadata")
  .eq("auth_subject",w.subject).eq("actor_id",ACTOR).eq("status","ACTIVE");
 if(bErr)throw Error("REVIEW_AUTHORITY_LOOKUP_FAILED");
 const now=Date.now();
 const binding=(bindings||[]).find((b:any)=>b.binding_class==="DIRECT_ACTOR"
   &&b.metadata?.runtime_lane==="PRIME_MASON_ACCOUNT"
   &&Date.parse(b.valid_from)<=now&&(!b.valid_until||Date.parse(b.valid_until)>=now));
 if(!binding)return false;
 const {data:assignments,error:aErr}=await admin.schema("pcc_institutional").from("authority_assignments")
  .select("authority_code,capabilities,status,valid_from,valid_until")
  .eq("actor_id",ACTOR).eq("authority_code","RPE-CSE").eq("status","ACTIVE");
 if(aErr)throw Error("REVIEW_AUTHORITY_LOOKUP_FAILED");
 return (assignments||[]).some((a:any)=>Array.isArray(a.capabilities)&&a.capabilities.includes("VERIFICATION")
   &&Date.parse(a.valid_from)<=now&&(!a.valid_until||Date.parse(a.valid_until)>=now));
}
async function reviewQueue(w:any){
 if(!await hasWorkspaceReviewAuthority(w))return reply(403,{error:"WORKSPACE_REVIEW_AUTHORITY_REQUIRED"});
 const {data,error}=await admin.from("pcc_workspace_intake_v1")
  .select("intake_id,created_at,runtime_lane,content_kind,title,body_text,content_document,target_system,target_channel,source_metadata,asset_manifest,payload_sha256,status,review_state,receipt")
  .eq("status","PENDING_PCC_TRIAGE").eq("review_state","UNREVIEWED")
  .order("created_at",{ascending:true}).limit(50);
 if(error)throw Error("WORKSPACE_REVIEW_QUEUE_FAILED");
 return reply(200,{items:data||[],count:(data||[]).length,decision_scope:"TRIAGE_ONLY",execution_eligible:false});
}
async function reviewDecision(b:any,w:any){
 if(!await hasWorkspaceReviewAuthority(w))return reply(403,{error:"WORKSPACE_REVIEW_AUTHORITY_REQUIRED"});
 let decision:any;
 try{decision=validateReviewDecision(b);}catch(e){return reply(400,{error:e instanceof Error?e.message:"REVIEW_DECISION_INVALID"});}
 const {data,error}=await admin.rpc("pcc_workspace_review_intake_v1",{
  p_intake_id:decision.intake_id,p_reviewer_subject:w.subject,p_review_action_id:decision.review_action_id,
  p_decision:decision.decision,p_reason:decision.reason
 });
 if(error)throw Error("WORKSPACE_REVIEW_WRITE_FAILED");
 const result=data as Record<string,unknown>;
 if(result?.ok!==true){
  const code=typeof result?.error==="string"?result.error:"WORKSPACE_REVIEW_FAILED";
  const status=code==="WORKSPACE_REVIEW_AUTHORITY_REQUIRED"?403:
   code==="INTAKE_NOT_FOUND"?404:
   code==="INTAKE_NOT_REVIEWABLE"||code==="REVIEW_IDEMPOTENCY_MISMATCH"?409:400;
  return reply(status,{error:code});
 }
 return reply(200,{...result,decision_scope:"TRIAGE_ONLY",execution_eligible:false});
}


async function approveExecution(b:any,w:any){
 if(w.authMode!=="USER_JWT")return reply(403,{error:"USER_SIGN_IN_REQUIRED_FOR_EXECUTION_APPROVAL"});
 if(!await hasWorkspaceReviewAuthority(w))return reply(403,{error:"WORKSPACE_EXECUTION_APPROVAL_AUTHORITY_REQUIRED"});
 const intake_id=text(b.intake_id,64),approval_id=text(b.approval_id,64),reason=text(b.reason,2000).trim();
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 if(!uuid.test(intake_id)||!uuid.test(approval_id)||!reason)return reply(400,{error:"EXECUTION_APPROVAL_REQUEST_INVALID"});
 const {data,error}=await admin.rpc("pcc_workspace_approve_execution_v1",{p_intake_id:intake_id,p_approval_id:approval_id,p_approver_subject:w.subject,p_reason:reason});
 if(error)throw Error("WORKSPACE_EXECUTION_APPROVAL_WRITE_FAILED");
 const result=data as Record<string,unknown>;
 if(result?.ok!==true){const code=typeof result?.error==="string"?result.error:"WORKSPACE_EXECUTION_APPROVAL_FAILED";const status=code==="WORKSPACE_EXECUTION_APPROVAL_AUTHORITY_REQUIRED"?403:code==="INTAKE_NOT_FOUND"?404:409;return reply(status,{error:code});}
 return reply(200,{...result,approval_scope:"WRITER_AND_HELD_HANDOFF",render_dispatch:"DISABLED",publication_eligible:false});
}

async function signWorkspaceBridge(secret:string,timestamp:number,nonce:string,raw:string){
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(`${timestamp}\n${nonce}\n${raw}`))),b=>b.toString(16).padStart(2,"0")).join("");
}
function routeHold(result:any,reason:string){return reply(200,{ok:true,dispatch_eligible:false,dispatch_scope:"HELD_RECEIPT_ONLY",producer_job_created:false,block_reasons:[reason],dispatch_receipt:result?.dispatch_receipt??null});}

async function dispatchAttempt(b:any,w:any){
 if(w.authMode!=="USER_JWT")return reply(403,{error:"USER_SIGN_IN_REQUIRED_FOR_DISPATCH"});
 if(!await hasWorkspaceReviewAuthority(w))return reply(403,{error:"WORKSPACE_REVIEW_AUTHORITY_REQUIRED"});
 let request:any;
 try{request=validateDispatchAttempt(b);}catch(e){return reply(400,{error:e instanceof Error?e.message:"DISPATCH_REQUEST_INVALID"});}
 const {data:dispatchData,error:dispatchError}=await admin.rpc("pcc_workspace_dispatch_intake_v1",{
   p_intake_id:request.intake_id,p_dispatch_action_id:request.dispatch_action_id,p_reviewer_subject:w.subject
 });
 if(dispatchError)throw Error("WORKSPACE_DISPATCH_WRITE_FAILED");
 const dispatch=dispatchData as Record<string,any>;
 if(dispatch?.ok!==true){const code=typeof dispatch?.error==="string"?dispatch.error:"WORKSPACE_DISPATCH_FAILED";const status=code==="WORKSPACE_REVIEW_AUTHORITY_REQUIRED"?403:code==="INTAKE_NOT_FOUND"?404:409;return reply(status,{error:code,dispatch_eligible:false});}
 const prior=dispatch.dispatch_receipt;
 if(prior?.state==="DISPATCHED"&&prior?.producer_job_id)return reply(200,{ok:true,duplicate:true,dispatch_eligible:true,dispatch_scope:"WRITER_AND_HELD_HANDOFF",producer_job_created:true,dispatch_receipt:prior});
 const reasons=Array.isArray(prior?.block_reasons)?prior.block_reasons:[];
 if(reasons.length)return routeHold(dispatch,reasons[0]);
 const {data:intake,error:intakeError}=await admin.from("pcc_workspace_intake_v1")
  .select("intake_id,auth_subject,runtime_lane,content_kind,title,body_text,content_document,target_system,target_channel,source_metadata,asset_manifest,payload_sha256,review_state,approved_for_execution,receipt")
  .eq("intake_id",request.intake_id).maybeSingle();
 if(intakeError)throw Error("WORKSPACE_DISPATCH_INTAKE_READ_FAILED");
 if(!intake||intake.review_state!=="ACCEPTED"||intake.approved_for_execution!==true)return routeHold(dispatch,"EXECUTION_APPROVAL_REQUIRED");
 const approval=intake.receipt?.execution_approval,review=intake.receipt?.review,route=intake.receipt?.route_resolution;
 if(!approval||approval.approved!==true||approval.payload_sha256!==intake.payload_sha256||!review||review.decision!=="ACCEPTED"||review.payload_sha256!==intake.payload_sha256)return routeHold(dispatch,"APPROVAL_PROVENANCE_MISMATCH");
 if(!route||route.resolution_status!=="RESOLVED_HELD"||route.execution_eligible!==false||route.publication_eligible!==false||!Array.isArray(route.producer_chain))return routeHold(dispatch,"ROUTE_NOT_RESOLVED");
 if(Array.isArray(intake.asset_manifest)&&intake.asset_manifest.length>0)return routeHold(dispatch,"ASSET_BRIDGE_NOT_CONNECTED");
 const doc=intake.content_document&&typeof intake.content_document==="object"&&!Array.isArray(intake.content_document)?intake.content_document:{};
 const writer=doc.writer_request&&typeof doc.writer_request==="object"&&!Array.isArray(doc.writer_request)?doc.writer_request:{};
 const surfaces=Array.isArray(route.intended_viewing_surfaces)?route.intended_viewing_surfaces:Array.isArray(route.placements)?route.placements:[];
 const surface=surfaces[0]??{};
 const destination=String(surface.destination_id??"").toLowerCase();
 let outputType=typeof writer.output_type==="string"?writer.output_type.trim().toUpperCase():"";
 if(intake.content_kind==="BOOK"&&!["BOOK_MANUSCRIPT","BOOK_CHAPTER","BOOK_SCENE","NOVEL"].includes(outputType))return routeHold(dispatch,"BOOK_WRITER_OUTPUT_TYPE_REQUIRED");
 if(intake.content_kind==="EPISODE"){
   const expected=destination==="phnx_phanimation"?"SERIES_EPISODE":"EPISODE";
   if(outputType&&outputType!==expected)return routeHold(dispatch,"EPISODE_OUTPUT_TYPE_DESTINATION_MISMATCH");
   outputType=expected;
 }
 if(intake.content_kind==="AD")outputType="AD";
 if(intake.content_kind==="REEL")outputType="REEL";
 if(intake.content_kind==="VIDEO"&&!["ANIMATION","MICRO_DRAMA","TV_SPOT","TV_COMMERCIAL","CORPORATE_MARKETING"].includes(outputType))return routeHold(dispatch,"VIDEO_WRITER_OUTPUT_TYPE_REQUIRED");
 if(!outputType)return routeHold(dispatch,"WRITER_OUTPUT_TYPE_UNRESOLVED");
 const producerChain=Array.isArray(route.producer_chain)?route.producer_chain:[];
 const privateWritingRoute=producerChain.includes("PCC_WRITING_ROOM");
 const writingDraftTypes=new Set(["BOOK","BOOK_MANUSCRIPT","BOOK_CHAPTER","BOOK_SCENE","NOVEL","SERIES","SERIES_BIBLE"]);
 if(privateWritingRoute&&!writingDraftTypes.has(outputType))return routeHold(dispatch,"PCC_WRITING_ROOM_OUTPUT_TYPE_UNSUPPORTED");
 const channelKey=String(writer.channel_key||surface.channel_key||(destination!=="draft"?destination:"")||intake.target_channel||"").trim().toLowerCase();
 if(!privateWritingRoute&&!/^[a-z][a-z0-9_]{1,63}$/.test(channelKey))return routeHold(dispatch,"CHANNEL_POLICY_KEY_REQUIRED");
 const title=String(intake.title??"").trim().slice(0,200);
 const idea=String(writer.idea??intake.body_text??"").trim().slice(0,12000);
 if(!title||!idea)return routeHold(dispatch,"WRITER_TITLE_AND_IDEA_REQUIRED");
 if(["BOOK_MANUSCRIPT","BOOK_CHAPTER","BOOK_SCENE","NOVEL"].includes(outputType)){
   const writingContext=writer.writing_context??doc.writing_context;
   if(!writingContext||typeof writingContext!=="object"||Array.isArray(writingContext))return routeHold(dispatch,"BOOK_WRITING_CONTEXT_REQUIRED");
   writer.writing_context=writingContext;
 }
 const {data:userResult,error:userError}=await admin.auth.admin.getUserById(w.subject);
 if(userError||!userResult?.user?.email||!userResult.user.email_confirmed_at)return routeHold(dispatch,"CONFIRMED_WORKSPACE_EMAIL_REQUIRED");
 const secret=Deno.env.get("PCC_PMF_BRIDGE_HMAC_SECRET");
 if(!secret||secret.length<32)return routeHold(dispatch,"PCC_WRITER_BRIDGE_NOT_CONFIGURED");
 const requestPayload={
   source_system_subject:w.subject,source_email:userResult.user.email.toLowerCase(),
   intake_id:intake.intake_id,dispatch_action_id:request.dispatch_action_id,payload_sha256:intake.payload_sha256,
   review_action_id:review.review_action_id,triage_decision:"ACCEPTED",triage_payload_sha256:review.payload_sha256,
   execution_approval:approval,route_resolution:route,channel_key:channelKey,output_type:outputType,
   production_intent:writer.production_intent??null,title,idea,
   request_payload:{
     ...(writer.request_payload&&typeof writer.request_payload==="object"&&!Array.isArray(writer.request_payload)?writer.request_payload:{}),
     writing_context:writer.writing_context??doc.writing_context??{},
     series_context:writer.series_context??doc.series_context??"",
     context_notes:writer.context_notes??doc.context_notes??"",
     desired_ending_or_action:writer.desired_ending_or_action??doc.desired_ending_or_action??"",
     source_scope:writer.source_scope??doc.source_scope??{},
     provenance_metadata:{
       source_metadata:intake.source_metadata&&typeof intake.source_metadata==="object"&&!Array.isArray(intake.source_metadata)?intake.source_metadata:{},
       content_document:{
         book_title:doc.book_title??null,chapter_title:doc.chapter_title??null,
         source_author:doc.source_author??null,source_classification:doc.source_classification??null,
         canon_status:doc.canon_status??null
       }
     }
   }
 };
 const raw=JSON.stringify({protocol:"pcc-workspace-producer/v1",action:"WRITE_APPROVED",payload:requestPayload});
 if(new TextEncoder().encode(raw).byteLength>60_000)return routeHold(dispatch,"PCC_WRITER_REQUEST_SIZE_LIMIT");
 const timestamp=Date.now(),nonce=crypto.randomUUID(),signature=await signWorkspaceBridge(secret,timestamp,nonce,raw);
 const endpoint="https://ttkceizmjeckrorhkhfr.supabase.co/functions/v1/pcc-animation-control-v1";
 let response:Response;
 try{response=await fetch(endpoint,{method:"POST",redirect:"error",headers:{"content-type":"application/json","x-pcc-bridge-key-id":"pcc-animation-v1","x-pcc-bridge-timestamp":String(timestamp),"x-pcc-bridge-nonce":nonce,"x-pcc-bridge-signature":signature},body:raw,signal:AbortSignal.timeout(120_000)});}
 catch{return reply(502,{ok:false,error:"PCC_WRITER_BRIDGE_REQUEST_FAILED",dispatch_scope:"HELD_RECEIPT_ONLY",producer_job_created:false});}
 let pcc:Record<string,any>;
 try{const parsed=await response.json();pcc=parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed:{};}catch{return reply(502,{ok:false,error:"PCC_WRITER_BRIDGE_RESPONSE_INVALID"});}
 const writingDraftReceipt=pcc.script_state==="BOOK_DRAFT_STORED"&&privateWritingRoute&&pcc.writing_draft_id===pcc.producer_job_id&&pcc.canon_status==="UNAPPROVED"&&pcc.render_dispatch==="DISABLED"&&pcc.publication_eligible===false;
 const animationScriptReceipt=["SCRIPT_REVIEW_PASSED","SCRIPT_REVIEW_NEEDS_ATTENTION"].includes(pcc.script_state);
 if(!response.ok||pcc.ok!==true||pcc.intake_id!==intake.intake_id||pcc.dispatch_action_id!==request.dispatch_action_id
    ||pcc.payload_sha256!==intake.payload_sha256||typeof pcc.producer_job_id!=="string"
    ||(!animationScriptReceipt&&!writingDraftReceipt)){
   return reply(409,{ok:false,error:typeof pcc.error==="string"?pcc.error:"PCC_PRODUCER_RECEIPT_INVALID",dispatch_scope:"HELD_RECEIPT_ONLY",producer_job_created:Boolean(pcc.producer_job_id)});
 }
 const receipt={intake_id:intake.intake_id,dispatch_action_id:request.dispatch_action_id,payload_sha256:intake.payload_sha256,
   producer_job_id:pcc.producer_job_id,script_state:pcc.script_state,pmf_receipt:pcc.pmf_receipt??null,
   writing_draft_id:writingDraftReceipt?pcc.writing_draft_id:null,canon_status:writingDraftReceipt?pcc.canon_status:null,
   source_preparation:pcc.source_preparation??null,render_dispatch:"DISABLED",publication_eligible:false};
 const {data:completed,error:completionError}=await admin.rpc("pcc_workspace_dispatch_complete_v1",{
   p_intake_id:intake.intake_id,p_dispatch_action_id:request.dispatch_action_id,p_reviewer_subject:w.subject,
   p_producer_job_id:pcc.producer_job_id,p_pcc_receipt:receipt
 });
 if(completionError)throw Error("WORKSPACE_DISPATCH_COMPLETION_WRITE_FAILED");
 const completion=completed as Record<string,unknown>;
 if(completion?.ok!==true)return reply(502,{ok:false,error:typeof completion?.error==="string"?completion.error:"WORKSPACE_DISPATCH_COMPLETION_FAILED",producer_job_id:pcc.producer_job_id});
 return reply(200,{...completion,dispatch_eligible:true,dispatch_scope:"WRITER_AND_HELD_HANDOFF",producer_job_created:true,script_state:pcc.script_state,render_dispatch:"DISABLED",publication_eligible:false});
}

async function submit(b:any,who:any){
  if(!idemOk(b.idempotency_key)) return reply(400,{error:"INVALID_IDEMPOTENCY_KEY"});
  if(!KINDS.has(b.content_kind)) return reply(400,{error:"INVALID_CONTENT_KIND"});
  const title=text(b.title,500).trim(), bodyText=text(b.body_text,250000);
  if(!title) return reply(400,{error:"TITLE_REQUIRED"});
  const doc=b.content_document&&typeof b.content_document==="object"&&!Array.isArray(b.content_document)?b.content_document:{};
  const source=b.source_metadata&&typeof b.source_metadata==="object"&&!Array.isArray(b.source_metadata)?b.source_metadata:{};
  const rawReferences=Array.isArray(b.artifact_references)?b.artifact_references:[];
  if(rawReferences.length>10) return reply(413,{error:"TOO_MANY_ARTIFACT_REFERENCES"});
  const artifactReferences=[];
  for(const item of rawReferences){
    const rawUrl=text(item?.url,2048).trim();
    let parsed:URL;
    try{parsed=new URL(rawUrl);}catch{return reply(400,{error:"INVALID_ARTIFACT_REFERENCE"});}
    if(parsed.protocol!=="https:"||parsed.username||parsed.password)return reply(400,{error:"INVALID_ARTIFACT_REFERENCE"});
    artifactReferences.push({url:parsed.toString(),label:text(item?.label,255).trim()||null,role:text(item?.role,100).trim()||null,transfer_state:"REFERENCE_ONLY",fetched:false});
  }
  const sourceWithReferences=artifactReferences.length?{...source,artifact_references:artifactReferences}:source;
  const assets=Array.isArray(b.assets)?b.assets:[];
  if(assets.length>10) return reply(413,{error:"TOO_MANY_ASSETS"});
  let total=0;
  for(const a of assets){
    if(!a||typeof a.file_name!=="string"||!a.file_name.trim()||a.file_name.length>255||!MIMES.has(a.mime_type)||
      !Number.isInteger(a.size_bytes)||a.size_bytes<1||a.size_bytes>20971520||typeof a.sha256!=="string"||!/^[a-f0-9]{64}$/.test(a.sha256)) return reply(400,{error:"INVALID_ASSET_MANIFEST"});
    total+=a.size_bytes;
  }
  if(total>52428800) return reply(413,{error:"ASSET_TOTAL_EXCEEDS_LIMIT"});
  const routeResolution=resolveOutputRoute({content_kind:b.content_kind,requested_operation:b.requested_operation,placements:b.placements});
  const normalized={content_kind:b.content_kind,title,body_text:bodyText,content_document:doc,target_system:text(b.target_system,120)||null,target_channel:text(b.target_channel,160)||null,source_metadata:sourceWithReferences,
    requested_operation:routeResolution.requested_operation,placements:routeResolution.placements,route_resolution:routeResolution,
    assets:assets.map((a:any)=>({file_name:a.file_name,mime_type:a.mime_type,size_bytes:a.size_bytes,sha256:a.sha256,role:text(a.role,100)||null}))};
  const canonical=JSON.stringify(normalized);
  if(new TextEncoder().encode(canonical).length>350000) return reply(413,{error:"PAYLOAD_EXCEEDS_LIMIT"});
  const payloadHash=await hash(canonical);
  const {data:old,error:lookErr}=await admin.from("pcc_workspace_intake_v1").select("intake_id,payload_sha256,status,receipt")
    .eq("auth_subject",who.subject).eq("runtime_lane",who.lane).eq("idempotency_key",b.idempotency_key).maybeSingle();
  if(lookErr) throw new Error("IDEMPOTENCY_LOOKUP_FAILED");
  if(old){
    if(old.payload_sha256!==payloadHash) return reply(409,{error:"IDEMPOTENCY_KEY_CONTENT_MISMATCH"});
    const {data:files,error}=await admin.from("pcc_workspace_intake_assets_v1").select("*").eq("intake_id",old.intake_id);
    if(error) throw new Error("ASSET_LOOKUP_FAILED");
    const upload_targets=old.status==="AWAITING_ASSET_UPLOAD"?await issueTickets(files||[]):[];
    return reply(200,{intake_id:old.intake_id,status:old.status,payload_sha256:payloadHash,duplicate:true,upload_targets,receipt:old.receipt});
  }
  const intakeId=crypto.randomUUID();
  const rows=assets.map((a:any)=>{
    const assetId=crypto.randomUUID(), ext=a.file_name.includes(".")?a.file_name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,10):"bin";
    return {asset_id:assetId,intake_id:intakeId,object_path:ACTOR+"/"+intakeId+"/"+assetId+"."+(ext||"bin"),file_name:a.file_name.slice(0,255),mime_type:a.mime_type,expected_size_bytes:a.size_bytes,expected_sha256:a.sha256,asset_role:text(a.role,100)||null};
  });
  const status=rows.length?"AWAITING_ASSET_UPLOAD":"PENDING_PCC_TRIAGE";
  const receipt={intake_id:intakeId,actor_id:who.actor,runtime_lane:who.lane,authenticated_subject:who.subject,received_at:new Date().toISOString(),payload_sha256:payloadHash,asset_count:rows.length,route_resolution:routeResolution,approval_state:"NOT_APPROVED",execution_eligible:false};
  const {error:insertErr}=await admin.from("pcc_workspace_intake_v1").insert({intake_id:intakeId,actor_id:who.actor,runtime_lane:who.lane,auth_subject:who.subject,idempotency_key:b.idempotency_key,content_kind:normalized.content_kind,title,body_text:bodyText,content_document:doc,target_system:normalized.target_system,target_channel:normalized.target_channel,source_metadata:sourceWithReferences,asset_manifest:normalized.assets,payload_sha256:payloadHash,status,receipt});
  if(insertErr) throw new Error("INTAKE_INSERT_FAILED");
  if(rows.length){const {error}=await admin.from("pcc_workspace_intake_assets_v1").insert(rows);if(error) throw new Error("ASSET_MANIFEST_INSERT_FAILED");}
  const upload_targets=rows.length?await issueTickets(rows):[];
  return reply(200,{intake_id:intakeId,status,payload_sha256:payloadHash,duplicate:false,upload_targets,receipt});
}
async function finalize(b:any,who:any){
  const id=text(b.intake_id,64);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return reply(400,{error:"INVALID_INTAKE_ID"});
  const {data:p,error}=await admin.from("pcc_workspace_intake_v1").select("intake_id,actor_id,runtime_lane,auth_subject,status,payload_sha256,receipt").eq("intake_id",id).eq("auth_subject",who.subject).eq("actor_id",who.actor).eq("runtime_lane",who.lane).maybeSingle();
  if(error) throw new Error("INTAKE_LOOKUP_FAILED"); if(!p) return reply(404,{error:"INTAKE_NOT_FOUND"});
  const {data:files,error:ferr}=await admin.from("pcc_workspace_intake_assets_v1").select("*").eq("intake_id",id);
  if(ferr) throw new Error("ASSET_LOOKUP_FAILED");
  for(const a of files||[]){
    if(a.status==="VERIFIED") continue;
    if(a.status==="REJECTED") return reply(422,{error:"ASSET_PREVIOUSLY_REJECTED",status:"REJECTED"});
    const {data:blob,error}=await admin.storage.from(BUCKET).download(a.object_path);
    if(error||!blob) return reply(409,{error:"ASSET_NOT_UPLOADED",asset_id:a.asset_id});
    const bytes=new Uint8Array(await blob.arrayBuffer()), mime=(blob.type||"").split(";")[0].trim().toLowerCase(), digest=await hash(bytes);
    if(bytes.byteLength!==a.expected_size_bytes||bytes.byteLength>20971520||digest!==a.expected_sha256||(mime&&mime!==a.mime_type)){
      await admin.from("pcc_workspace_intake_assets_v1").update({status:"REJECTED",rejection_code:"ASSET_INTEGRITY_MISMATCH"}).eq("asset_id",a.asset_id);
      await admin.from("pcc_workspace_intake_v1").update({status:"REJECTED",receipt:{...p.receipt,integrity_state:"REJECTED",rejection_code:"ASSET_INTEGRITY_MISMATCH"}}).eq("intake_id",id);
      return reply(422,{error:"ASSET_INTEGRITY_MISMATCH",asset_id:a.asset_id,status:"REJECTED"});
    }
    const {error:uerr}=await admin.from("pcc_workspace_intake_assets_v1").update({status:"VERIFIED",verified_size_bytes:bytes.byteLength,verified_sha256:digest,rejection_code:null}).eq("asset_id",a.asset_id);
    if(uerr) throw new Error("ASSET_VERIFY_WRITE_FAILED");
  }
  const receipt={...p.receipt,assets_verified:true,finalized_at:new Date().toISOString(),approval_state:"NOT_APPROVED",execution_eligible:false};
  const {error:finishErr}=await admin.from("pcc_workspace_intake_v1").update({status:"PENDING_PCC_TRIAGE",receipt}).eq("intake_id",id);
  if(finishErr) throw new Error("FINALIZE_WRITE_FAILED");
  return reply(200,{intake_id:id,status:"PENDING_PCC_TRIAGE",payload_sha256:p.payload_sha256,asset_count:(files||[]).length,assets_verified:true,approval_state:"NOT_APPROVED",execution_eligible:false,receipt});
}
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
  if(req.method!=="POST") return reply(405,{error:"METHOD_NOT_ALLOWED"});
  if(Number(req.headers.get("content-length")||"0")>500000) return reply(413,{error:"REQUEST_TOO_LARGE"});
  try{
    const b=await req.json();
    if(!b||typeof b!=="object"||Array.isArray(b)) return reply(400,{error:"INVALID_JSON_OBJECT"});
    const who=await authorize(req);
    if(b.operation==="submit") return await submit(b,who);
    if(b.operation==="finalize") return await finalize(b,who);
    if(b.operation==="create_action_key") return await createActionKey(b,who);
    if(b.operation==="list_action_keys") return await listActionKeys(who);
    if(b.operation==="revoke_action_key") return await revokeActionKey(b,who);
    if(b.operation==="review_queue") return await reviewQueue(who);
    if(b.operation==="review_decision") return await reviewDecision(b,who);
    if(b.operation==="approve_execution") return await approveExecution(b,who);
    if(b.operation==="dispatch_attempt") return await dispatchAttempt(b,who);
    return reply(400,{error:"UNKNOWN_OPERATION"});
  }catch(e){
    const msg=e instanceof Error?e.message:"INTERNAL_ERROR";
    if(msg==="UNAUTHENTICATED") return reply(401,{error:msg});
    if(msg==="WORKSPACE_BINDING_REQUIRED") return reply(403,{error:msg});
    console.error("pcc-workspace-ingest-v1",msg);
    return reply(500,{error:msg});
  }
});
