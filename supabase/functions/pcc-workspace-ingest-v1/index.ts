import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveOutputRoute } from "./output-route-resolver.mjs";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "pcc-workspace-intake";
const ACTOR = "RPE-MASON-HQ";
const LANES = new Set(["PRIME_MASON_ACCOUNT", "NEW_MASON_ACCOUNT"]);
const KINDS = new Set(["BOOK","AD","REEL","SHORT","EPISODE","SERIES","IMAGE","VIDEO","AUDIO","DOCUMENT","CONCEPT","OTHER"]);
const MIMES = new Set(["image/png","image/jpeg","image/webp","image/gif","audio/mpeg","audio/wav","audio/mp4","audio/ogg","audio/webm","video/mp4","video/webm","application/pdf","text/plain","application/json","application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
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
 const {data:rows,error}=await db.schema("pcc_institutional").from("auth_actor_bindings").select("auth_subject,actor_id,binding_class,status,valid_from,valid_until,metadata").eq("actor_id",ACTOR).eq("status","ACTIVE");
 if(error)throw Error("AUTHORITY_LOOKUP_FAILED");const now=Date.now();
 const b=(rows||[]).find((x:any)=>LANES.has(x.metadata?.runtime_lane)&&String(x.metadata?.auth_email||"").toLowerCase()===email.toLowerCase()&&["DIRECT_ACTOR","DELEGATED_RUNTIME"].includes(x.binding_class)&&Date.parse(x.valid_from)<=now&&(!x.valid_until||Date.parse(x.valid_until)>=now));
 if(!b)throw Error("WORKSPACE_BINDING_REQUIRED");return b;
}
async function bindingForSubject(subject:string,lane:string){
 const {data:rows,error}=await db.schema("pcc_institutional").from("auth_actor_bindings").select("actor_id,binding_class,status,valid_from,valid_until,metadata").eq("auth_subject",subject).eq("actor_id",ACTOR).eq("status","ACTIVE");
 if(error)throw Error("AUTHORITY_LOOKUP_FAILED");const now=Date.now();
 const b=(rows||[]).find((x:any)=>LANES.has(x.metadata?.runtime_lane)&&x.metadata?.runtime_lane===lane&&["DIRECT_ACTOR","DELEGATED_RUNTIME"].includes(x.binding_class)&&Date.parse(x.valid_from)<=now&&(!x.valid_until||Date.parse(x.valid_until)>=now));
 if(!b)throw Error("WORKSPACE_BINDING_REQUIRED");return b;
}
async function authorize(req:Request){
 const header=req.headers.get("authorization")||"";const token=header.startsWith("Bearer ")?header.slice(7).trim():"";if(!token)throw Error("UNAUTHENTICATED");
 if(token.startsWith("pccwi_")){
  const digest=await sha(token);
  const {data:k,error}=await db.from("pcc_workspace_ingest_keys_v1").select("key_id,created_by_auth_subject,actor_id,runtime_lane,status,expires_at").eq("token_sha256",digest).eq("status","ACTIVE").maybeSingle();
  if(error||!k)throw Error("UNAUTHENTICATED");if(Date.parse(k.expires_at)<=Date.now()){await db.from("pcc_workspace_ingest_keys_v1").update({status:"EXPIRED"}).eq("key_id",k.key_id);throw Error("UNAUTHENTICATED");}
  await bindingForSubject(k.created_by_auth_subject,k.runtime_lane);
  await db.from("pcc_workspace_ingest_keys_v1").update({last_used_at:new Date().toISOString()}).eq("key_id",k.key_id);
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
 const label=str(b.key_label,100).trim();if(!label)return reply(400,{error:"KEY_LABEL_REQUIRED"});
 const token=randomToken(),digest=await sha(token),expires=new Date(Date.now()+90*24*60*60*1000).toISOString();
 const {data,error}=await db.from("pcc_workspace_ingest_keys_v1").insert({created_by_auth_subject:w.subject,actor_id:w.actor,runtime_lane:w.lane,key_label:label,token_sha256:digest,expires_at:expires}).select("key_id,key_label,status,created_at,expires_at").single();
 if(error)throw Error("KEY_CREATE_FAILED");
 return reply(200,{key_id:data.key_id,key_label:data.key_label,status:data.status,created_at:data.created_at,expires_at:data.expires_at,api_key:token,shown_once:true,scope:["pcc-workspace-ingest-v1:submit","pcc-workspace-ingest-v1:finalize"],warning:"Copy this key into this GPT Action's Bearer API key now. It cannot be read again."});
}
async function listActionKeys(w:any){
 if(w.authMode!=="USER_JWT")return reply(403,{error:"USER_SIGN_IN_REQUIRED"});
 const {data,error}=await db.from("pcc_workspace_ingest_keys_v1").select("key_id,key_label,status,created_at,expires_at,last_used_at").eq("created_by_auth_subject",w.subject).eq("runtime_lane",w.lane).order("created_at",{ascending:false});
 if(error)throw Error("KEY_LIST_FAILED");return reply(200,{keys:data||[]});
}
async function revokeActionKey(b:any,w:any){
 if(w.authMode!=="USER_JWT")return reply(403,{error:"USER_SIGN_IN_REQUIRED"});
 const id=str(b.key_id,64);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return reply(400,{error:"INVALID_KEY_ID"});
 const {data,error}=await db.from("pcc_workspace_ingest_keys_v1").update({status:"REVOKED",revoked_at:new Date().toISOString()}).eq("key_id",id).eq("created_by_auth_subject",w.subject).eq("runtime_lane",w.lane).eq("status","ACTIVE").select("key_id,status").maybeSingle();
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
async function submit(b:any,who:any){
  if(!idemOk(b.idempotency_key)) return reply(400,{error:"INVALID_IDEMPOTENCY_KEY"});
  if(!KINDS.has(b.content_kind)) return reply(400,{error:"INVALID_CONTENT_KIND"});
  const title=text(b.title,500).trim(), bodyText=text(b.body_text,250000);
  if(!title) return reply(400,{error:"TITLE_REQUIRED"});
  const doc=b.content_document&&typeof b.content_document==="object"&&!Array.isArray(b.content_document)?b.content_document:{};
  const source=b.source_metadata&&typeof b.source_metadata==="object"&&!Array.isArray(b.source_metadata)?b.source_metadata:{};
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
  const normalized={content_kind:b.content_kind,title,body_text:bodyText,content_document:doc,target_system:text(b.target_system,120)||null,target_channel:text(b.target_channel,160)||null,source_metadata:source,
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
  const {error:insertErr}=await admin.from("pcc_workspace_intake_v1").insert({intake_id:intakeId,actor_id:who.actor,runtime_lane:who.lane,auth_subject:who.subject,idempotency_key:b.idempotency_key,content_kind:normalized.content_kind,title,body_text:bodyText,content_document:doc,target_system:normalized.target_system,target_channel:normalized.target_channel,source_metadata:source,asset_manifest:normalized.assets,payload_sha256:payloadHash,status,receipt});
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
    return reply(400,{error:"UNKNOWN_OPERATION"});
  }catch(e){
    const msg=e instanceof Error?e.message:"INTERNAL_ERROR";
    if(msg==="UNAUTHENTICATED") return reply(401,{error:msg});
    if(msg==="WORKSPACE_BINDING_REQUIRED") return reply(403,{error:msg});
    console.error("pcc-workspace-ingest-v1",msg);
    return reply(500,{error:msg});
  }
});
