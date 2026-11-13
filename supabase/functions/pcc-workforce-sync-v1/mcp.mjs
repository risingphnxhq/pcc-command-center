const MCP_RESOURCE='https://oyjmpbuxvfxusmbouldi.supabase.co/functions/v1/pcc-workforce-sync-v1/mcp';
const METADATA='https://oyjmpbuxvfxusmbouldi.supabase.co/functions/v1/pcc-workforce-sync-v1/.well-known/oauth-protected-resource';
export const resourceMetadata={resource:MCP_RESOURCE,authorization_servers:['https://oyjmpbuxvfxusmbouldi.supabase.co/auth/v1'],scopes_supported:['openid','profile','email','offline_access'],bearer_methods_supported:['header']};
const challenge='Bearer resource_metadata="'+METADATA+'", scope="openid email profile offline_access"';
function connectionCredential(value){
 if(/^Bearer pccsd_[a-f0-9]{64}$/i.test(value??''))return true;
 try{const token=value?.match(/^Bearer (\S+)$/i)?.[1],parts=token?.split('.');if(parts?.length!==3)return false;const claims=JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));return ['29b4c197-7df5-4ef1-a7ca-e89bad3fd59e','1fc4a7d8-b9f9-4a49-bbe6-3ccc6b32e5ef'].includes(claims.client_id);}catch{return false;}
}
// Transport adapter only: all institutional decisions remain in the existing handler.
const versions=['2026-07-28','2025-11-25','2025-06-18','2025-03-26'];
const obj=properties=>({type:'object',properties,additionalProperties:false});
const version={type:'integer',minimum:1,description:'Exact state_version from the latest complete bootstrap.'};
const schemas={
 psc_d_preflight_aiden_gate1_sync:obj({}),
 psc_d_start_aiden_reviewer:obj({}),
 psc_d_bootstrap:obj({mission_id:{type:'string',enum:['RPE-SYS-WORKFORCE-RLS-IMPLEMENTATION-001'],description:'Optional pre-registration preview of the assigned Systems Workforce mission.'}}),
 psc_d_read:obj({}),
 psc_d_certification_progress:obj({}),
 psc_d_persona_monitor:{...obj({persona:{type:'string',minLength:1,maxLength:160,description:'Exact persona name, institutional actor ID, or workforce stream ID.'}}),required:['persona']},
 psc_d_acknowledge:{...obj({observed_state_version:version,context_fingerprint:{type:'string',pattern:'^[a-f0-9]{64}$',description:'Exact context_sha256 after reading and reconciling the complete assigned context.'}}),required:['observed_state_version','context_fingerprint']},
 psc_d_action_gate:{...obj({observed_state_version:version,mission_id:{type:'string',minLength:1,maxLength:240},required_capability:{type:'string',minLength:1,maxLength:100}}),required:['observed_state_version','mission_id','required_capability']}
};
const runtimeId={type:'string',pattern:'^[0-9a-fA-F-]{36}$',description:'Full PSC-D runtime_id assigned to this conversation. Never reuse another conversation’s ID.'};
schemas.psc_d_register_runtime={...obj({runtime_label:{type:'string',minLength:1,maxLength:120},mission_id:{type:'string',minLength:1,maxLength:240}}),required:['runtime_label','mission_id']};
schemas.psc_d_runtime_heartbeat={...obj({runtime_id:runtimeId}),required:['runtime_id']};
schemas.psc_d_checkpoint={...obj({runtime_id:runtimeId,checkpoint:{type:'string',minLength:1,maxLength:4000}}),required:['runtime_id','checkpoint']};
schemas.psc_d_complete_runtime={...obj({runtime_id:runtimeId}),required:['runtime_id']};
schemas.psc_d_retire_runtime={...obj({runtime_id:runtimeId}),required:['runtime_id']};
for(const name of ['psc_d_bootstrap','psc_d_read','psc_d_acknowledge','psc_d_action_gate'])schemas[name].properties.runtime_id=runtimeId;
for(const name of ['psc_d_acknowledge','psc_d_action_gate'])schemas[name].required.push('runtime_id');
schemas.psc_d_continue_runtime={...obj({previous_runtime_id:runtimeId,runtime_label:{type:'string',minLength:1,maxLength:120}}),required:['previous_runtime_id','runtime_label']};
schemas.psc_d_record_build_evidence={...obj({
 runtime_id:runtimeId, observed_state_version:version, mission_id:schemas.psc_d_action_gate.properties.mission_id,
 evidence_id:{type:'string',format:'uuid',description:'Generate one UUID per evidence submission and reuse it on retry.'},
 commit:{type:'string',pattern:'^[a-f0-9]{40}$'},artifact_sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},
 summary:{type:'string',minLength:1,maxLength:500},next_action:{type:'string',minLength:1,maxLength:500}
}),required:['runtime_id','observed_state_version','mission_id','evidence_id','commit','artifact_sha256','summary','next_action']};
const descriptions={
 psc_d_certification_progress:'Read the Systems certification draft, release binding, seven gate results and certificate status. Requires New Mason OAuth.',
 psc_d_persona_monitor:'Read one Systems persona’s registered assignments across engines, including unbound streams, runtime health, last sync and latest failure evidence. Requires New Mason Systems Command OAuth.',
 psc_d_record_build_evidence:'Record the verified PMF Gate 2 build commit, artifact digest and next action under the acknowledged New Mason runtime. Returns an evidence receipt and saves the recovery checkpoint. Does not advance Gate 2 or issue approval.',
 psc_d_bootstrap:'Retrieve the complete context assigned to this authenticated connection: actual identity, command, authority, mission, governing PSC and checkpoint. Read and reconcile every returned record before acknowledgment. No acknowledgment or execution authorization is created.',
 psc_d_read:'Read current identity, assignments and synchronization status. This abbreviated read does not replace full bootstrap.',
 psc_d_acknowledge:'Record this connected runtime’s statement that it read and reconciled the complete current bootstrap. Creates a durable synchronization receipt. Never acknowledge incomplete, stale or conflicting context. Does not grant new authority or independent acceptance.',
 psc_d_action_gate:'Check existing authority, active assigned mission and current acknowledged context before a governed action. Does not perform the action or extend synchronization. A PASS is not independent release acceptance.'
};
descriptions.psc_d_continue_runtime='Start this replacement conversation under the same authorized office binding and mission as its predecessor. Creates a new runtime ID, carries the predecessor checkpoint, and retires the prior active runtime. Does not copy acknowledgment. Use only for an explicit conversation replacement, never after compression of the same conversation.';
descriptions.psc_d_runtime_heartbeat='Send liveness from this running New Mason runtime only. Requires its own runtime ID and does not acknowledge or renew synchronization.';
descriptions.psc_d_start_aiden_reviewer='Start or recover Aiden Mercer’s isolated review-only provider runtime using the existing synthetic startup probe. Requires authenticated New Mason Systems Command. This does not activate audit authority or certify PMF.';
descriptions.psc_d_preflight_aiden_gate1_sync='Preflight Aiden’s pending Gate 1 service binding and context with a single-use challenge. Does not acknowledge PSC-D or grant audit authority.';
const actions={psc_d_certification_progress:'CERTIFICATION_PROGRESS',psc_d_persona_monitor:'PERSONA_MONITOR',psc_d_preflight_aiden_gate1_sync:'PREFLIGHT_AIDEN_GATE1_SYNC',psc_d_start_aiden_reviewer:'START_AIDEN_REVIEWER',psc_d_runtime_heartbeat:'RUNTIME_HEARTBEAT',psc_d_record_build_evidence:'RECORD_BUILD_EVIDENCE',psc_d_continue_runtime:'CONTINUE_RUNTIME',psc_d_bootstrap:'BOOTSTRAP',psc_d_read:'READ',psc_d_acknowledge:'ACK',psc_d_action_gate:'ACTION_GATE'};
Object.assign(actions,{psc_d_register_runtime:'REGISTER_RUNTIME',psc_d_checkpoint:'RUNTIME_CHECKPOINT',psc_d_complete_runtime:'RUNTIME_COMPLETE',psc_d_retire_runtime:'RUNTIME_RETIRE'});
Object.assign(descriptions,{psc_d_register_runtime:'Register this new conversation as a distinct runtime under an already assigned active mission. Save and display the returned runtime_id. Registration is not synchronization. Do not register again after compression; recover this conversation’s existing ID.',psc_d_checkpoint:'Save this runtime’s bounded progress and next step. Does not acknowledge context or renew synchronization.',psc_d_complete_runtime:'Mark this conversation runtime completed without deleting its history or closing its institutional mission.',psc_d_retire_runtime:'Retire this runtime while preserving its history and checkpoint. Does not retire the office or mission.'});
for(const [name,action,ack] of [['psc_d_retrieve_work_order','RETRIEVE_WORK_ORDER',false],['psc_d_acknowledge_work_order','ACKNOWLEDGE_WORK_ORDER',true]]){
 const properties={work_order_id:{type:'string',minLength:1,maxLength:240}};
 if(ack)properties.assignment_sha256={type:'string',pattern:'^[a-f0-9]{64}$'};
 schemas[name]={...obj(properties),required:Object.keys(properties)};
 actions[name]=action;
 descriptions[name]=ack?'Acknowledge the exact reconciled work order digest.':'Retrieve a Communications work order and record retrieval.';
}
schemas.psc_d_respond_to_challenge={...obj({challenge_id:{type:'string',minLength:1,maxLength:120},last_verified_result:{type:'string',maxLength:2000},open_work:{type:'string',maxLength:2000},next_action:{type:'string',maxLength:2000}}),required:['challenge_id','last_verified_result','open_work','next_action']};
actions.psc_d_respond_to_challenge='RESPOND_TO_CHALLENGE';
descriptions.psc_d_respond_to_challenge='Record the work position for a delivered challenge before retrieving its checkpoint.';
schemas.psc_d_acknowledge.properties.challenge_id={type:'string',minLength:1,maxLength:120};
schemas.psc_d_verify_callback_route={...obj({proof:{type:'string',pattern:'^[a-f0-9]{64}$'}}),required:['proof']};
actions.psc_d_verify_callback_route='VERIFY_CALLBACK_ROUTE';
descriptions.psc_d_verify_callback_route='Redeem a one-time callback proof received in the bound conversation.';
schemas.psc_d_send_callback_route_proof={...obj({subscription_id:{type:'string',pattern:'^sub_[a-f0-9]{64}$'}}),required:['subscription_id']};
actions.psc_d_send_callback_route_proof='SEND_CALLBACK_ROUTE_PROOF';
descriptions.psc_d_send_callback_route_proof='Send one synthetic route proof to the selected PCC subscription for the verified Communications test runtime.';
schemas.psc_d_dispatch_comms_challenge=obj({});
actions.psc_d_dispatch_comms_challenge='DISPATCH_COMMS_CHALLENGE';
descriptions.psc_d_dispatch_comms_challenge='Dispatch the pending Communications test challenge through its verified route.';
export const toolList=Object.keys(schemas).map(name=>({name,description:descriptions[name],inputSchema:schemas[name],securitySchemes:[{type:'oauth2',scopes:['openid','email','profile','offline_access']}],_meta:{securitySchemes:[{type:'oauth2',scopes:['openid','email','profile','offline_access']}]},annotations:{readOnlyHint:['psc_d_bootstrap','psc_d_read','psc_d_action_gate','psc_d_persona_monitor','psc_d_certification_progress'].includes(name),destructiveHint:false,idempotentHint:!['psc_d_register_runtime','psc_d_continue_runtime','psc_d_start_aiden_reviewer','psc_d_preflight_aiden_gate1_sync'].includes(name),openWorldHint:false}}));
const response=(body,status=200,extra={})=>new Response(body===null?null:JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store',...extra}});
const error=(id,code,message,status=200)=>response({jsonrpc:'2.0',id,error:{code,message}},status);
export function createMcpHandler(handler){
 return async req=>{
  if(req.headers.has('origin')&&req.headers.get('origin')!=='https://command.risingphoenixhq.com')return response({error:'ORIGIN_NOT_ALLOWED'},403);
  if(req.method==='GET'||req.method==='DELETE')return response(null,405,{'allow':'POST'});
  if(req.method!=='POST')return response({error:'POST_REQUIRED'},405);
  let b;
  try{const raw=await req.text();if(new TextEncoder().encode(raw).length>16384)return error(null,-32600,'Request too large',413);b=JSON.parse(raw);}catch{return error(null,-32700,'Invalid JSON',400);}
  if(!b||Array.isArray(b)||b.jsonrpc!=='2.0'||typeof b.method!=='string'||(b.id!==undefined&&typeof b.id!=='string'&&typeof b.id!=='number'&&b.id!==null))return error(null,-32600,'Invalid request',400);
  const id=b.id??null;
  if(b.id===undefined){if(b.method==='notifications/initialized'||b.method==='notifications/cancelled')return response(null,202);return error(null,-32600,'Request id required',400);}
  if(b.method==='server/discover')return response({jsonrpc:'2.0',id,result:{supportedVersions:versions,capabilities:{tools:{}}}});
  if(b.method==='initialize')return response({jsonrpc:'2.0',id,result:{protocolVersion:versions.includes(b.params?.protocolVersion)?b.params.protocolVersion:versions[0],capabilities:{tools:{}},serverInfo:{name:'rpe-existing-psc-d',version:'1.1.0'},instructions:'Use full bootstrap first. Reconcile actual identity, assignment, authority, mission, governing PSC, checkpoint and unfinished work. Acknowledge only after reading the complete context. Check the action gate before governed work. Missing or changed authority/context requires reconciliation. Never substitute a selected persona for an authenticated binding.'}});
  if(b.method==='ping')return response({jsonrpc:'2.0',id,result:{}});
  if(b.method==='tools/list')return response({jsonrpc:'2.0',id,result:{tools:toolList}});
  if(b.method!=='tools/call')return error(id,-32601,'Method not found');
  const name=b.params?.name,args=b.params?.arguments??{};
  if(!Object.hasOwn(actions,name??''))return error(id,-32602,'Unsupported tool');
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(schemas[name].properties,k)))return error(id,-32602,'Invalid tool arguments');
  for(const key of schemas[name].required??[])if(!Object.hasOwn(args,key))return error(id,-32602,'Required argument missing');
  if('observed_state_version'in args&&(!Number.isSafeInteger(args.observed_state_version)||args.observed_state_version<1))return error(id,-32602,'Invalid observed state version');
  if('context_fingerprint'in args&&!/^[a-f0-9]{64}$/.test(args.context_fingerprint))return error(id,-32602,'Invalid context fingerprint');
  if('previous_runtime_id'in args&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.previous_runtime_id))return error(id,-32602,'Invalid predecessor runtime id');
  if('runtime_id'in args&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.runtime_id))return error(id,-32602,'Invalid runtime id');
  for(const key of ['runtime_label','checkpoint'])if(key in args&&(typeof args[key]!=='string'||!args[key].trim()||args[key].length>schemas[name].properties[key].maxLength))return error(id,-32602,'Invalid runtime text');
  for(const key of ['mission_id','required_capability'])if(key in args&&(typeof args[key]!=='string'||!args[key].length||args[key].length>schemas[name].properties[key].maxLength))return error(id,-32602,'Invalid mission or capability');
  // Dedicated keys resolve their own actor and binding in the original handler.
  // Never expose key management, accept actor overrides or upgrade a browser JWT to a runtime.
  const authorization=req.headers.get('authorization');
  if(!connectionCredential(authorization))return response({jsonrpc:'2.0',id,result:{content:[{type:'text',text:'PSC-D authorized OAuth or dedicated connection authentication required.'}],isError:true}},401,{'www-authenticate':challenge});
  try{
   const session=b.params?._meta?.['openai/session'];
   let chatFingerprint=null;
   if((['psc_d_bootstrap','psc_d_read','psc_d_register_runtime','psc_d_continue_runtime','psc_d_retrieve_work_order','psc_d_acknowledge_work_order','psc_d_respond_to_challenge','psc_d_acknowledge','psc_d_verify_callback_route','psc_d_send_callback_route_proof','psc_d_dispatch_comms_challenge'].includes(name))&&typeof session==='string'&&session.length>0&&session.length<=512){
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(session));
    chatFingerprint=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
   }
   const upstream=await handler(new Request(req.url,{method:'POST',headers:{authorization,'content-type':'application/json'},body:JSON.stringify({...args,action:actions[name]})}),chatFingerprint);
   const data=await upstream.json();
   if(name==='psc_d_read'&&upstream.ok&&data?.authentication?.mode==='PSC_D_OAUTH'){
    data.chat_correlation={fingerprint:chatFingerprint,authorization:false};
   }
   return response({jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(data)}],isError:!upstream.ok}},upstream.status===401?401:200,upstream.status===401?{'www-authenticate':challenge}:{});
  }catch{return response({jsonrpc:'2.0',id,result:{content:[{type:'text',text:'PSC_D_OPERATION_FAILED'}],isError:true}});}
 };
}
