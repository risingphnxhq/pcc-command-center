import {createHandler as createReviewerHandler,createStartupCapability,digest} from './aiden-reviewer-core.mjs';
import {buildContext} from './context.mjs';
const cors={'access-control-allow-origin':'https://command.risingphoenixhq.com','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, apikey, content-type','vary':'Origin'};
const reply=(b,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'content-type':'application/json','cache-control':'no-store'}});
const workforceActors=['RPE-AIDEN-MERCER','RPE-ELENA-WARD','RPE-PRIYA-SHAH','RPE-LEXINGTON-MARTIN'];
const actors=['RPE-CHAD-HQ','RPE-MASON-HQ'],pulses=['LIVENESS','MEMORY','CHANGE','RECONCILIATION','ACTION_GATE','DEEP_REHYDRATION'];
const operations=['RECEIVER_TEST_SEND','RECEIVER_TEST_STATUS','DISPATCH_COMMS_CHALLENGE','SEND_CALLBACK_ROUTE_PROOF','VERIFY_CALLBACK_ROUTE','RESPOND_TO_CHALLENGE','RETRIEVE_WORK_ORDER','ACKNOWLEDGE_WORK_ORDER','PREFLIGHT_AIDEN_GATE1_SYNC','START_AIDEN_REVIEWER','RUNTIME_HEARTBEAT','RECORD_BUILD_EVIDENCE','READ','BOOTSTRAP','ACK','ACTION_GATE','REGISTER_RUNTIME','CONTINUE_RUNTIME','RUNTIME_CHECKPOINT','RUNTIME_COMPLETE','RUNTIME_RETIRE','WORKFORCE_READ','CREATE_CONNECTION_KEY','LIST_CONNECTION_KEYS','REVOKE_CONNECTION_KEY'];
const statsCoreReferences=new Set([
 'SC-CSE-PSC-2026-08-25-H001-R1',
 'SC-CSE-PSC-2026-08-25-H010-R1',
 'SC-CSE-PSC-2026-08-25-H022-R1'
]);
const fields='psc_id,system_code,authority_code,canon_name,canon_type,canon_state,effective_date,structured_summary,detailed_canon,dependency_psc_ids,supersedes_psc_ids,superseded_by_psc_id,current_build_position,next_authorized_step,created_at';
const digestOf=v=>typeof v==='string'?v.match(/^(?:PCC-USER-ACK-NOT-GPT:|PSC-D-STREAM-ACK:)?([a-f0-9]{64})$/)?.[1]:null;
const validAt=(b,t)=>b?.status==='ACTIVE'&&Number.isFinite(Date.parse(b.valid_from))&&Date.parse(b.valid_from)<=t&&(!b.valid_until||(Number.isFinite(Date.parse(b.valid_until))&&Date.parse(b.valid_until)>t));
const sha=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))),b=>b.toString(16).padStart(2,'0')).join('');
const randomKey=()=>'pccsd_'+Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
export function createHandler(db,clock=()=>Date.now(),env=()=>undefined){
 return async (req,chatFingerprint)=>{
  const origin=req.headers.get('origin');
  if(origin&&origin!=='https://command.risingphoenixhq.com')return reply({error:'ORIGIN_NOT_ALLOWED'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return reply({error:'POST_REQUIRED'},405);
  try{
   const raw=await req.text();if(new TextEncoder().encode(raw).byteLength>16384)return reply({error:'REQUEST_TOO_LARGE'},413);
   let b;try{b=JSON.parse(raw);}catch{return reply({error:'INVALID_JSON'},400);}
   if(!b||typeof b!=='object'||Array.isArray(b))return reply({error:'INVALID_REQUEST'},400);
   const token=req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
   if(!token)return reply({error:'AUTHORIZATION_REQUIRED'},401);
   let subject,key=null,oauth=false;
   if(token.startsWith('pccsd_')){
    if(!/^pccsd_[a-f0-9]{64}$/.test(token))return reply({error:'INVALID_AUTHORIZATION'},401);
    const {data,error}=await db.from('pcc_psc_d_connection_keys_v1').select('key_id,auth_subject,actor_id,binding_id,status,expires_at,last_ack_sha256,last_ack_version,last_ack_at').eq('token_sha256',await sha(token)).maybeSingle();
    if(error)throw Error('KEY_LOOKUP');
    if(!data||data.status!=='ACTIVE'||!Number.isFinite(Date.parse(data.expires_at))||Date.parse(data.expires_at)<=clock())return reply({error:'INVALID_AUTHORIZATION'},401);
    key=data;subject=data.auth_subject;
   }else{
    const {data,error}=await db.auth.getUser(token);if(error||!data?.user?.id)return reply({error:'INVALID_AUTHORIZATION'},401);subject=data.user.id;
    // getUser has validated this credential. Do not treat a third-party OAuth
    // token as an interactive PCC sign-in or silently inherit another system's access.
    if(token.includes('.')){
     let claims;try{const parts=token.split('.');if(parts.length!==3)throw Error();claims=JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));}catch{return reply({error:'INVALID_AUTHORIZATION'},401);}
     if(claims?.client_id!=null){
      if(claims.sub!==subject||claims.role!=='authenticated'||!Number.isSafeInteger(claims.exp))return reply({error:'INVALID_AUTHORIZATION'},401);
      const resolved=await db.rpc('pcc_psc_d_oauth_runtime_resolve',{p_auth_subject:subject,p_client_id:claims.client_id,p_session_id:claims.session_id,p_token_exp:claims.exp});
      if(resolved.error||!resolved.data)return reply({error:'OAUTH_CLIENT_NOT_ADMITTED_FOR_PSC_D'},403);
      key=resolved.data;oauth=true;
     }
    }
   }
   if(b.action==='CERTIFICATION_PROGRESS'){
    if(!oauth||key?.actor_id!=='RPE-MASON-HQ')return reply({error:'NEW_MASON_SYSTEMS_COMMAND_REQUIRED'},403);
    const {data,error}=await db.rpc('pcc_psc_d_certification_progress_v1',{p_subject:subject});
    if(error)return reply({error:'CERTIFICATION_PROGRESS_UNAVAILABLE'},503);
    if(!data)return reply({error:'CERTIFICATION_PROGRESS_NOT_ADMITTED'},403);
    return reply(data);
   }
   if(b.action==='PERSONA_MONITOR'){
    if(!oauth||key?.actor_id!=='RPE-MASON-HQ')return reply({error:'NEW_MASON_SYSTEMS_COMMAND_REQUIRED'},403);
    if(typeof b.persona!=='string'||!b.persona.trim()||b.persona.length>160)return reply({error:'INVALID_PERSONA_FILTER'},400);
    const {data,error}=await db.rpc('pcc_psc_d_persona_monitor_v1',{p_subject:subject,p_persona:b.persona.trim()});
    if(error)return reply({error:error.code==='42501'?'NEW_MASON_SYSTEMS_COMMAND_REQUIRED':'PERSONA_MONITOR_UNAVAILABLE'},error.code==='42501'?403:503);
    return reply(data);
   }
   if(b.action==='WORKFORCE_READ'){
    if(key)return reply({error:'INTERACTIVE_ACCOUNT_REQUIRED'},403);
    if((b.page!=null&&(!Number.isInteger(b.page)||b.page<0||b.page>10000))||[b.query,b.status,b.actor_filter,b.lane].some(v=>v!=null&&(typeof v!=='string'||v.length>120)))return reply({error:'INVALID_FILTER'},400);
    const {data,error}=await db.rpc('pcc_psc_d_workforce_read',{p_subject:subject,p_page:b.page||0,p_query:b.query||'',p_status:b.status||'',p_actor:b.actor_filter||'',p_lane:b.lane||'',p_history:b.history===true});
    return error?reply({error:'AUTHORIZED_WORKFORCE_VIEW_REQUIRED'},403):reply(data);
   }
   const id=key?.actor_id||String(b.actor_id||'').trim();
   if(!actors.includes(id)&&!(oauth&&workforceActors.includes(id)))return reply({error:'ACTOR_ID_REQUIRED_OR_UNSUPPORTED'},400);
   if(key&&b.actor_id&&b.actor_id!==id)return reply({error:'CONNECTION_ACTOR_SCOPE_MISMATCH'},403);
   const action=b.action??(b.pulse_type==='ACTION_GATE'?'ACTION_GATE':'ACK');
   if(!operations.includes(action))return reply({error:'INVALID_ACTION'},400);
   const guarded=action==='ACTION_GATE'||action==='RECORD_BUILD_EVIDENCE';
   const pt=guarded?'ACTION_GATE':String(action==='RUNTIME_HEARTBEAT'?'LIVENESS':b.pulse_type||'MEMORY').toUpperCase();
   if(!pulses.includes(pt))return reply({error:'INVALID_PULSE_TYPE'},400);
   const {data:p,error:pe}=await db.rpc('pcc_psc_d_projection_read',{p_auth_subject:subject,p_actor_id:id});
   if(pe)throw Error('PROJECTION');
   if(!p?.binding||!validAt(p.binding,clock()))return reply({error:'ACTIVE_ACTOR_BINDING_REQUIRED',authentication:{subject,requested_actor_id:id,mode:oauth?'PSC_D_OAUTH':key?'PSC_D_CONNECTION_KEY':'USER_JWT'}},403);
   if(key&&key.binding_id!==p.binding.binding_id)return reply({error:'CONNECTION_BINDING_CHANGED_RECONNECT_REQUIRED'},403);
   if(!p.binding.allowed_pulse_types?.includes(pt))return reply({error:'PULSE_TYPE_NOT_AUTHORIZED_FOR_BINDING'},403);
   if(!p.actor)return reply({error:'ACTIVE_ACTOR_NOT_FOUND'},403);
   if(!p.sync)return reply({error:'SYNC_STATE_NOT_REGISTERED'},409);
   const auth={subject,actor_id:id,binding_id:p.binding.binding_id,mode:oauth?'PSC_D_OAUTH':key?'PSC_D_CONNECTION_KEY':'USER_JWT'};
   if(action==='RECEIVER_TEST_SEND'||action==='RECEIVER_TEST_STATUS'){
    if(key||id!=='RPE-MASON-HQ'||p.binding.metadata?.runtime_lane!=='NEW_MASON_ACCOUNT'||!(p.authorities||[]).some(a=>validAt(a,clock())&&a.capabilities?.includes('SYSTEMS_COMMAND')))return reply({error:'NEW_MASON_SYSTEMS_COMMAND_REQUIRED'},403);
    const runtimeId='48ed6fb2-0391-489a-9f37-4585fbde1aef';
    if(action==='RECEIVER_TEST_STATUS'){
     if(typeof b.test_id!=='string'||!/^evt_[a-f0-9-]{36}$/.test(b.test_id))return reply({error:'INVALID_TEST_ID'},400);
     const {data,error}=await db.rpc('pcc_receiver_test_status_v1',{p_runtime_id:runtimeId,p_test_id:b.test_id.slice(4)});
     return error?reply({error:'RECEIVER_TEST_STATUS_UNAVAILABLE'},503):data?reply(data):reply({error:'RECEIVER_TEST_NOT_FOUND'},404);
    }
    const serviceKey=env('SUPABASE_SERVICE_ROLE_KEY');
    if(!serviceKey)return reply({error:'ROUTE_PROOF_SENDER_UNAVAILABLE'},503);
    const sent=await fetch('https://oyjmpbuxvfxusmbouldi.supabase.co/functions/v1/pcc-psc-d-stream-signal-probe-v1/send-receiver-test',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:'Bearer '+serviceKey,'content-type':'application/json'},body:JSON.stringify({runtime_id:runtimeId})});
    return reply(await sent.json(),sent.status);
   }
   if(action==='START_AIDEN_REVIEWER'){
    if(!oauth||id!=='RPE-MASON-HQ'||p.binding.metadata?.runtime_lane!=='NEW_MASON_ACCOUNT'||!(p.authorities||[]).some(a=>validAt(a,clock())&&a.capabilities?.includes('SYSTEMS_COMMAND')))return reply({error:'NEW_MASON_SYSTEMS_COMMAND_REQUIRED'},403);
    const existing=await db.rpc('pcc_aiden_reviewer_runtime_v1',{p_action:'READ',p_data:{operator_subject:subject}});
    if(existing.error)return reply({error:'AIDEN_RUNTIME_READ_FAILED'},503);
    if(existing.data?.status==='PROBE_PASSED')return reply({ok:true,runtime:existing.data,formal_audit_pass:false});
    if(!env('PCC_OPENAI_API_KEY')||!env('PCC_AGENT_MODEL'))return reply({error:'MANAGED_PROVIDER_CONFIGURATION_MISSING'},503);
    const capability=createStartupCapability();
    const issued=await db.rpc('pcc_aiden_reviewer_runtime_v1',{p_action:'ISSUE_STARTUP',p_data:{operator_subject:subject,token_sha256:await digest(capability)}});
    if(issued.error||issued.data?.status!=='ISSUED')return reply({error:'AIDEN_STARTUP_ISSUE_DENIED'},409);
    return createReviewerHandler({db,operatorSubject:subject,env})(new Request(req.url,{method:'POST',headers:{Authorization:'Bearer '+capability},body:JSON.stringify({action:'PROBE',command_id:issued.data.command_id})}));
   }
   if(action.includes('CONNECTION_KEY')){
    if(key)return reply({error:'USER_SIGN_IN_REQUIRED_FOR_KEY_MANAGEMENT'},403);
    if(!(id==='RPE-CHAD-HQ'?['CORPORATE_CHAD_ACCOUNT','PRIME_CHAD_ACCOUNT']:['NEW_MASON_ACCOUNT','PRIME_MASON_ACCOUNT']).includes(p.binding.metadata?.runtime_lane))return reply({error:'INTERACTIVE_ACCOUNT_BINDING_REQUIRED'},403);
    if(action==='CREATE_CONNECTION_KEY'){
     const label=typeof b.key_label==='string'?b.key_label.trim():'';
     if(!label||label.length>100)return reply({error:'KEY_LABEL_REQUIRED_MAX_100'},400);
     const secret=randomKey();
     const {data,error}=await db.from('pcc_psc_d_connection_keys_v1').insert({auth_subject:subject,actor_id:id,binding_id:p.binding.binding_id,key_label:label,token_sha256:await sha(secret),expires_at:new Date(clock()+30*86400000).toISOString()}).select('key_id,key_label,expires_at,status').single();
     if(error)throw Error('KEY_CREATE');return reply({...data,api_key:secret,shown_once:true,scope:['READ','BOOTSTRAP','ACK','ACTION_GATE'],authentication:auth});
    }
    if(action==='LIST_CONNECTION_KEYS'){
     const {data,error}=await db.from('pcc_psc_d_connection_keys_v1').select('key_id,key_label,status,created_at,expires_at,revoked_at').eq('auth_subject',subject).eq('actor_id',id);
     if(error)throw Error('KEY_LIST');return reply({keys:data||[]});
    }
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.key_id||''))return reply({error:'INVALID_KEY_ID'},400);
    const {data,error}=await db.from('pcc_psc_d_connection_keys_v1').update({status:'REVOKED',revoked_at:new Date(clock()).toISOString()}).eq('key_id',b.key_id).eq('auth_subject',subject).eq('actor_id',id).select('key_id,status').maybeSingle();
    if(error)throw Error('KEY_REVOKE');return data?reply(data):reply({error:'OWNED_CONNECTION_KEY_NOT_FOUND'},404);
   }
   const workforceMissionId='RPE-SYS-WORKFORCE-RLS-IMPLEMENTATION-001';
   const context=(missionId)=>buildContext(missionId===workforceMissionId
    || (id==='RPE-MASON-HQ' && missionId==='RPE-SYS-PSC-D-SUCCESSOR-DRILL-001')
    ? {...p,missions:(p.missions||[]).filter(m=>m.mission_id===missionId&&m.state==='ACTIVE'&&m.assigned_actor_id===id)}
    : p,async pscId=>{
    const {data,error}=await db.from('phoenix_canon_records').select(fields).eq('psc_id',pscId).maybeSingle();
    if(error)throw Error('CANON_READ');
    if(data||id!=='RPE-MASON-HQ'||!statsCoreReferences.has(pscId))return data;
    const archived=await db.from('sc_cse_psc_canon').select('psc_id,system_name,event_name,event_class,verification_state,controlling_state,original_event_date,reconstructed_on,dependencies,next_authorized_step').eq('psc_id',pscId).maybeSingle();
    if(archived.error)throw Error('STATSCORE_CANON_READ');
    const row=archived.data;
    if(!row)return null;
    return {
     psc_id:row.psc_id,canon_name:row.event_name,canon_type:row.event_class,canon_state:row.verification_state,
     effective_date:row.original_event_date,dependency_psc_ids:row.dependencies,next_authorized_step:row.next_authorized_step,
     structured_summary:{system_name:row.system_name,controlling_state:row.controlling_state,reconstructed_on:row.reconstructed_on},
     source_surface:'public.sc_cse_psc_canon'
    };
   });
   if(action==='PREFLIGHT_AIDEN_GATE1_SYNC'){
    if(!oauth||id!=='RPE-MASON-HQ'||p.binding.metadata?.runtime_lane!=='NEW_MASON_ACCOUNT'||!(p.authorities||[]).some(a=>validAt(a,clock())&&a.capabilities?.includes('SYSTEMS_COMMAND')))return reply({error:'NEW_MASON_SYSTEMS_COMMAND_REQUIRED'},403);
    const aiden='RPE-AIDEN-MERCER', missionId='RPE-SYS-GATE1-AIDEN-AUDIT-001';
    const mission=await db.rpc('pcc_aiden_gate1_sync_challenge',{p_action:'CONTEXT',p_data:{operator_subject:subject}});
    if(mission.error||mission.data?.status!=='AVAILABLE'||!mission.data.mission)return reply({error:'AIDEN_GATE1_MISSION_UNAVAILABLE'},409);
    const c=await buildContext({actor:{actor_id:aiden},missions:[mission.data.mission]},async pscId=>{
     const record=await db.from('phoenix_canon_records').select(fields).eq('psc_id',pscId).maybeSingle();
     if(record.error)throw Error('CANON_READ');
     return record.data;
    });
    if(c.retrieval_state!=='RETRIEVED_RECONCILIATION_REQUIRED')return reply({error:'AIDEN_GATE1_CONTEXT_INCOMPLETE',issues:c.issues},409);
    const token=createStartupCapability();
    const request={operator_subject:subject,context_sha256:c.context_sha256,token_sha256:await digest(token)};
    const issue=await db.rpc('pcc_aiden_gate1_sync_challenge',{p_action:'ISSUE',p_data:request});
    if(issue.error||issue.data?.status!=='ISSUED')return reply({error:'AIDEN_GATE1_CHALLENGE_NOT_ISSUED'},409);
    const claim=await db.rpc('pcc_aiden_gate1_sync_challenge',{p_action:'CLAIM',p_data:{...request,challenge_id:issue.data.challenge_id}});
    if(claim.error||claim.data?.status!=='CLAIMED')return reply({error:'AIDEN_GATE1_CHALLENGE_NOT_CLAIMED'},409);
    return reply({status:'PREFLIGHT_PASSED',actor_id:aiden,mission_id:missionId,runtime_id:claim.data.runtime_id,challenge_id:claim.data.challenge_id,context_sha256:c.context_sha256,records:c.record_count,psc_d_synchronized:false,audit_actions_enabled:false});
   }
   const runtime=async(operation,extra={})=>{
    if(!key)return {error:'CONNECTED_RUNTIME_REQUIRED'};
    const {data,error}=await db.rpc('pcc_psc_d_runtime_operation',{p_key_id:key.key_id,p_operation:operation,p_runtime_id:b.runtime_id||null,...extra});
    return error?{error:String(error.message||'RUNTIME_OPERATION_FAILED').slice(0,160)}:{data};
   };
   if(action==='RUNTIME_HEARTBEAT'){
    if(!oauth||id!=='RPE-MASON-HQ'||p.binding.metadata?.runtime_lane!=='NEW_MASON_ACCOUNT')return reply({error:'NEW_MASON_OAUTH_REQUIRED'},403);
    if(typeof b.runtime_id!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(b.runtime_id))return reply({error:'RUNTIME_ID_REQUIRED'},400);
    const r=await runtime('RUNTIME_HEARTBEAT');
    return r.error?reply({error:r.error},409):reply({...r.data,synchronization_extended:false});
   }
   if(action==='CONTINUE_RUNTIME'){
    if(!key)return reply({error:'CONNECTED_RUNTIME_REQUIRED'},403);
    const {data,error}=await db.rpc('pcc_psc_d_continue_with_drill_binding',{p_key_id:key.key_id,p_previous_runtime_id:b.previous_runtime_id,p_label:b.runtime_label,p_fingerprint:oauth&&id==='RPE-MASON-HQ'&&p.binding.metadata?.runtime_lane==='NEW_MASON_ACCOUNT'?chatFingerprint||null:null});
    return error?reply({error:String(error.message||'CONTINUATION_FAILED').slice(0,160)},409):reply({runtime:data,synchronization_extended:false,next_action:'Save this new runtime ID. Read its inherited checkpoint and bootstrap with the new ID before acknowledgment. The prior active runtime was retired.',authentication:auth});
   }
   if(action==='RETRIEVE_WORK_ORDER'||action==='ACKNOWLEDGE_WORK_ORDER'){
    if(!key||!oauth||id!=='RPE-MASON-HQ'||p.binding.metadata?.runtime_lane!=='NEW_MASON_ACCOUNT'||!chatFingerprint)return reply({error:'BOUND_WORK_ORDER_AUTH_REQUIRED'},403);
    const ack=action==='ACKNOWLEDGE_WORK_ORDER';
    if(ack&&!/^[a-f0-9]{64}$/.test(b.assignment_sha256??''))return reply({error:'ASSIGNMENT_DIGEST_REQUIRED'},400);
    const {data,error}=await db.rpc('pcc_bound_work_order_receipt_v1',{p_key_id:key.key_id,p_fingerprint:chatFingerprint,p_work_order_id:b.work_order_id,p_ack_sha256:ack?b.assignment_sha256:null});
    const known=['BOUND_WORK_ORDER_UNAVAILABLE','STALE_ASSIGNMENT_DIGEST','ASSIGNMENT_RETRIEVAL_REQUIRED'];
    return error?reply({error:known.includes(error.message)?error.message:'WORK_ORDER_OPERATION_FAILED'},409):reply(data);
   }
   if(action==='SEND_CALLBACK_ROUTE_PROOF'){
 if(!key||!oauth||id!=='RPE-MASON-HQ'||p.binding.metadata?.runtime_lane!=='NEW_MASON_ACCOUNT'||!chatFingerprint)return reply({error:'BOUND_RUNTIME_REQUIRED'},403);
 if(typeof b.subscription_id!=='string'||!/^sub_[a-f0-9]{64}$/.test(b.subscription_id))return reply({error:'INVALID_SUBSCRIPTION_ID'},400);
 const resolved=await db.rpc('pcc_psc_d_resolve_conversation_runtime_v1',{p_key_id:key.key_id,p_fingerprint:chatFingerprint});
 if(resolved.error||resolved.data!=='48ed6fb2-0391-489a-9f37-4585fbde1aef')return reply({error:'COMMUNICATIONS_RUNTIME_REQUIRED'},403);
 const serviceKey=env('SUPABASE_SERVICE_ROLE_KEY');
 if(!serviceKey)return reply({error:'ROUTE_PROOF_SENDER_UNAVAILABLE'},503);
 const sent=await fetch('https://oyjmpbuxvfxusmbouldi.supabase.co/functions/v1/pcc-psc-d-stream-signal-probe-v1/send-route-proof',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:'Bearer '+serviceKey,'content-type':'application/json'},body:JSON.stringify({subscription_id:b.subscription_id,runtime_id:resolved.data})});
 return reply(await sent.json(),sent.status);
}
if(action==='DISPATCH_COMMS_CHALLENGE'){
 if(!key||!oauth||id!=='RPE-MASON-HQ'||p.binding.metadata?.runtime_lane!=='NEW_MASON_ACCOUNT'||!chatFingerprint)return reply({error:'BOUND_RUNTIME_REQUIRED'},403);
 const resolved=await db.rpc('pcc_psc_d_resolve_conversation_runtime_v1',{p_key_id:key.key_id,p_fingerprint:chatFingerprint});
 if(resolved.error||resolved.data!=='48ed6fb2-0391-489a-9f37-4585fbde1aef')return reply({error:'COMMUNICATIONS_RUNTIME_REQUIRED'},403);
 const serviceKey=env('SUPABASE_SERVICE_ROLE_KEY');
 if(!serviceKey)return reply({error:'CHALLENGE_SENDER_UNAVAILABLE'},503);
 const sent=await fetch('https://oyjmpbuxvfxusmbouldi.supabase.co/functions/v1/pcc-psc-d-stream-signal-probe-v1/send-challenge',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:'Bearer '+serviceKey,'content-type':'application/json'},body:JSON.stringify({challenge_id:'PCC-COMMS-COGNITIVE-CHALLENGE-001'})});
 return reply(await sent.json(),sent.status);
}
if(action==='VERIFY_CALLBACK_ROUTE'){
 if(!key||!oauth||id!=='RPE-MASON-HQ'||p.binding.metadata?.runtime_lane!=='NEW_MASON_ACCOUNT'||!chatFingerprint)return reply({error:'BOUND_RUNTIME_REQUIRED'},403);
 const {data,error}=await db.rpc('pcc_verify_signal_route_v1',{p_key_id:key.key_id,p_fingerprint:chatFingerprint,p_proof:b.proof});
 return error?reply({error:'BOUND_ROUTE_PROOF_INVALID'},409):reply(data);
}
if(action==='RESPOND_TO_CHALLENGE'){
 if(!key||!oauth||id!=='RPE-MASON-HQ'||p.binding.metadata?.runtime_lane!=='NEW_MASON_ACCOUNT'||!chatFingerprint)return reply({error:'BOUND_CHALLENGE_AUTH_REQUIRED'},403);
 const {data,error}=await db.rpc('pcc_record_bound_cognitive_challenge_response_v1',{p_key_id:key.key_id,p_fingerprint:chatFingerprint,p_challenge_id:b.challenge_id,p_response:{last_verified_result:b.last_verified_result,open_work:b.open_work,next_action:b.next_action}});
 const known=['INVALID_WORK_POSITION','DELIVERED_BOUND_CHALLENGE_REQUIRED','CHALLENGE_CHECKPOINT_CHANGED','CHALLENGE_RESPONSE_ALREADY_RECORDED'];
 return error?reply({error:known.includes(error.message)?error.message:'CHALLENGE_RESPONSE_FAILED'},409):reply(data);
}
if(action==='REGISTER_RUNTIME'){
    if(!key)return reply({error:'CONNECTED_RUNTIME_REQUIRED'},403);
    const drill=b.mission_id==='RPE-SYS-PSC-D-SUCCESSOR-DRILL-001';
    if(drill&&(!oauth||id!=='RPE-MASON-HQ'||p.binding.metadata?.runtime_lane!=='NEW_MASON_ACCOUNT'||!chatFingerprint))return reply({error:'DRILL_CONVERSATION_AUTH_REQUIRED'},403);
    const r=drill?await db.rpc('pcc_psc_d_register_bound_drill',{p_key_id:key.key_id,p_label:b.runtime_label,p_fingerprint:chatFingerprint}):await runtime('REGISTER',{p_mission_id:b.mission_id,p_label:b.runtime_label});
    return r.error?reply({error:r.error},409):reply({runtime:r.data,next_action:'Carry runtime_id in this conversation; bootstrap with that ID before acknowledgment. A new conversation must register its own runtime.',authentication:auth});
   }
   if(['RUNTIME_CHECKPOINT','RUNTIME_COMPLETE','RUNTIME_RETIRE'].includes(action)){
    const r=await runtime(action==='RUNTIME_CHECKPOINT'?'CHECKPOINT':action==='RUNTIME_COMPLETE'?'COMPLETED':'RETIRED',{p_checkpoint:b.checkpoint||null});
    return r.error?reply({error:r.error},409):reply({runtime:r.data,synchronization_extended:false,authentication:auth});
   }
   if(action==='BOOTSTRAP'){
    let missionId=b.mission_id,conversationBindingVerified=false;
    if(!b.runtime_id&&!missionId&&oauth&&id==='RPE-MASON-HQ'&&chatFingerprint){
     const match=await db.rpc('pcc_psc_d_resolve_conversation_runtime_v1',{p_key_id:key.key_id,p_fingerprint:chatFingerprint});
     if(match.error)return reply({error:'CONVERSATION_RUNTIME_LOOKUP_UNAVAILABLE'},503);
     if(match.data){b.runtime_id=match.data;conversationBindingVerified=true;}
     else if(p.binding.metadata?.runtime_lane==='NEW_MASON_ACCOUNT'){
      const drill=await db.rpc('pcc_psc_d_resolve_bound_drill',{p_key_id:key.key_id,p_fingerprint:chatFingerprint});
      if(drill.error)return reply({error:'DRILL_RUNTIME_LOOKUP_UNAVAILABLE'},503);
      if(drill.data){b.runtime_id=drill.data;conversationBindingVerified=true;}
     }
    }
    if (b.runtime_id) {
     const owned=await runtime('READ');
     if(owned.error)return reply({error:owned.error},409);
     if(missionId&&missionId!==owned.data.mission_id)return reply({error:'RUNTIME_MISSION_SCOPE_MISMATCH'},403);
     missionId=owned.data.mission_id;
    } else if (missionId && (missionId!==workforceMissionId || !key || !(p.missions||[]).some(m=>m.mission_id===missionId&&m.state==='ACTIVE'&&m.assigned_actor_id===id))) {
     return reply({error:'ASSIGNED_ACTIVE_WORKFORCE_MISSION_REQUIRED'},403);
    }
    const c=await context(missionId);let r;
    if(b.runtime_id){r=await runtime('RETRIEVE',{p_version:c.state_version,p_sha:c.context_sha256});if(r.error)return reply({error:r.error},409);}
    let recovery;
    if (!b.runtime_id && !missionId && oauth && id === 'RPE-MASON-HQ' && p.binding.metadata?.runtime_lane === 'NEW_MASON_ACCOUNT') {
     const missionId = 'RPE-SYS-PMF-ANIMATION-030-NEW-MASON-001';
     if ((p.missions || []).some(m => m.mission_id === missionId && m.state === 'ACTIVE')) {
      const found = await runtime('DISCOVER_NEW_MASON_CHECKPOINT', {p_mission_id: missionId});
      recovery = found.error ? {state:'CHECKPOINT_LOOKUP_UNAVAILABLE'} : found.data;
      recovery = {...recovery, conversation_binding_verified:false};
     }
    }
    return reply({protocol:'PSC-D',...c,runtime:r?.data||null,conversation_binding_verified:conversationBindingVerified,
     ...(recovery ? {mission_checkpoint_recovery:recovery} : {}),
     runtime_registration_required:!!key&&!b.runtime_id&&(!recovery||recovery.state==='NO_ACTIVE_RUNTIME'),authentication:auth});
   }
   const s=p.sync,deadline=Date.parse(s.next_memory_sync_due_at||'');
   const fresh=Boolean(s.last_memory_sync_at&&Number.isFinite(deadline)&&deadline>clock()&&s.sync_state==='SYNCHRONIZED');
   if(action==='READ')return reply({protocol:'PSC-D',actor:p.actor,command:p.command,authorities:p.authorities||[],missions:p.missions||[],synchronization:{...s,stored_sync_state:s.sync_state,evaluated_state:fresh?'SYNCHRONIZED':'CONTEXT_REHYDRATION_REQUIRED'},authentication:auth,acknowledged:false});
   if(!Number.isSafeInteger(b.observed_state_version)||b.observed_state_version<1)return reply({error:'INVALID_OBSERVED_STATE_VERSION'},400);
   if(b.observed_state_version!==s.state_version)return reply({error:'STATE_VERSION_MISMATCH_RECONCILE_REQUIRED'},409);
   if(action==='ACK' && pt==='ACTION_GATE')return reply({error:'ACTION_PULSE_MISMATCH'},400);
   if(guarded){
    if(action==='RECORD_BUILD_EVIDENCE'&&!key)return reply({error:'CONNECTED_RUNTIME_REQUIRED'},403);
    if(key&&!b.runtime_id)return reply({error:'RUNTIME_ID_REQUIRED'},409);
    if(key){const r=await runtime('READ');if(r.error)return reply({error:r.error},409);if(r.data.mission_id!==b.mission_id)return reply({error:'RUNTIME_MISSION_SCOPE_MISMATCH'},403);}
    const authority=(p.authorities||[]).find(a=>validAt(a,clock())&&a.capabilities?.includes(action==='RECORD_BUILD_EVIDENCE'?'MANUFACTURING':b.required_capability));
    const mission=(p.missions||[]).find(m=>m.mission_id===b.mission_id&&m.state==='ACTIVE'&&m.assigned_actor_id===id);
    if(!authority||!mission)return reply({error:'ACTIVE_MISSION_AND_CAPABILITY_REQUIRED'},403);
    if(key && (key.last_ack_version!==s.state_version || !key.last_ack_at || Date.parse(key.last_ack_at)+15*60000<=clock() || !key.last_ack_sha256))return reply({error:'CONNECTION_ACK_REQUIRED'},409);
   }
   if(guarded&&!fresh)return reply({error:'PSC_D_ACTION_BLOCKED_REHYDRATION_REQUIRED'},409);
   if(pt!=='LIVENESS'){
    let missionId;
    if(key&&b.runtime_id){
     const owned=await runtime('READ');
     if(owned.error)return reply({error:owned.error},409);
     missionId=owned.data.mission_id;
    }
    const c=await context(missionId);if(c.retrieval_state!=='RETRIEVED_RECONCILIATION_REQUIRED')return reply({error:'FULL_GOVERNING_CONTEXT_REQUIRED',issues:c.issues},409);
    const expected=guarded?(key?key.last_ack_sha256:digestOf(s.last_context_fingerprint)):digestOf(b.context_fingerprint);
    if(expected!==c.context_sha256)return reply({error:'GOVERNING_CONTEXT_CHANGED_RECONCILE_REQUIRED'},409);
   }else if(key)return reply({error:'CONNECTION_SCOPE_DOES_NOT_INCLUDE_LIVENESS'},403);
   if(action==='ACK'&&b.challenge_id!=null){
    if(!key||!oauth||id!=='RPE-MASON-HQ'||!chatFingerprint||!b.runtime_id||typeof b.challenge_id!=='string'||b.challenge_id.length>120)return reply({error:'BOUND_CHALLENGE_AUTH_REQUIRED'},403);
    const {data,error}=await db.rpc('pcc_commit_bound_challenge_ack_v1',{p_key_id:key.key_id,p_fingerprint:chatFingerprint,p_runtime_id:b.runtime_id,p_challenge_id:b.challenge_id,p_version:s.state_version,p_sha:digestOf(b.context_fingerprint)});
    const known=['BOUND_CHALLENGE_AUTH_REQUIRED','BOUND_CHALLENGE_RESPONSE_REQUIRED','CHALLENGE_SYNC_COMMIT_FAILED'];
    return error?reply({error:known.includes(error.message)?error.message:'CHALLENGE_ACK_FAILED'},409):reply({protocol:'PSC-D',challenge_id:b.challenge_id,runtime_id:b.runtime_id,synchronization:data,receipt:{sync_receipt_id:data.receipt_id}});
   }
   if(key&&['ACK','ACTION_GATE'].includes(action)){
    if(!b.runtime_id)return reply({error:'RUNTIME_ID_REQUIRED'},409);
    const r=await runtime(action==='ACK'?'ACK':'GATE',{p_version:s.state_version,p_sha:action==='ACK'?digestOf(b.context_fingerprint):key.last_ack_sha256});
    if(r.error)return reply({error:r.error},409);
   }
   if(action==='RECORD_BUILD_EVIDENCE'){
    const {data,error}=await db.rpc('pcc_psc_d_record_build_evidence_v1',{
     p_key_id:key.key_id,p_runtime_id:b.runtime_id,p_version:s.state_version,p_sha:key.last_ack_sha256,
     p_evidence_id:b.evidence_id,p_commit:b.commit,p_artifact_sha256:b.artifact_sha256,p_summary:b.summary,p_next_action:b.next_action
    });
    const denials=['INVALID_BUILD_EVIDENCE','RUNTIME_SYNC_REQUIRED','OWNED_RUNTIME_REQUIRED','RUNTIME_NOT_ACTIVE','ASSIGNED_ACTIVE_MISSION_REQUIRED','BUILD_EVIDENCE_MISSION_NOT_ADMITTED','MANUFACTURING_AUTHORITY_REQUIRED','ACTIVE_CONNECTION_REQUIRED','ACTIVE_BINDING_REQUIRED','ACTIVE_BOAS_BUILD_CONTROL_REQUIRED','GATE_NOT_IN_PROGRESS','EVIDENCE_ID_CONFLICT'];
    return error?reply({error:denials.includes(error.message)?error.message:'BUILD_EVIDENCE_RECORD_FAILED'},denials.includes(error.message)?409:500):reply(data);
   }
   if(action==='ACTION_GATE')return reply({protocol:'PSC-D',action_gate:'PASS',actor_id:id,runtime_id:b.runtime_id,state_version:s.state_version,authentication:auth,acknowledged:false,synchronization_extended:false});
   const fingerprint=pt==='LIVENESS'?null:(key?'PSC-D-STREAM-ACK:':'PCC-USER-ACK-NOT-GPT:')+digestOf(b.context_fingerprint);
   const {data:commit,error:ce}=await db.rpc('pcc_psc_d_commit',{p_auth_subject:subject,p_actor_id:id,p_pulse_type:pt,p_observed_state_version:b.observed_state_version,p_context_fingerprint:fingerprint});
   if(ce)throw Error('COMMIT');
   if(key && commit.state==='SYNCHRONIZED'){
    const {error:ke}=await db.from('pcc_psc_d_connection_keys_v1').update({last_ack_sha256:digestOf(b.context_fingerprint),last_ack_version:b.observed_state_version,last_ack_at:new Date(clock()).toISOString()}).eq('key_id',key.key_id).eq('status','ACTIVE');
    if(ke)throw Error('CONNECTION_ACK_RECORD');
   }
   return reply({protocol:'PSC-D',synchronization:commit,authentication:auth,receipt:{sync_receipt_id:commit.receipt_id},acknowledgment_class:key?'CONNECTED_RUNTIME_STATEMENT':'USER_OR_LEGACY_RUNTIME_STATEMENT',independent_acceptance:false},commit.state==='SYNCHRONIZED'?200:409);
  }catch{return reply({error:'PSC_D_OPERATION_FAILED'},500);}
 };
}
