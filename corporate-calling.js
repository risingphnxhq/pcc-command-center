/* Conversational Corporate calling. Verified contact resolution remains inside SVW; private directory is never sent to a model. */
(()=>{'use strict';
 const root='https://system-voice-worker.tsteelefpa.workers.dev';
 const projectUrl='https://ttkceizmjeckrorhkhfr.supabase.co';
 const publishableKey='sb_publishable_v3-qGYPg-tSY-G4cX47HRg_TgMnYEbO';
 let identity=null,active=null;
 const requests=new Map();
 const isCommand=text=>/^(?:nace[,\s:]*)?(?:(?:please|can you|could you)\s+)?(?:call|phone|dial)\b/i.test(String(text).trim());

 async function session(){
  if(!window.supabase)await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/dist/umd/supabase.min.js';script.onload=resolve;script.onerror=()=>reject(Error('Individual calling sign-in could not load.'));document.head.append(script);});
  identity ||= window.supabase.createClient(projectUrl,publishableKey,{auth:{persistSession:true,autoRefreshToken:true}});
  const {data:{session}}=await identity.auth.getSession();
  if(!session?.access_token)throw Error('Sign in once with your Corporate identity on the Command Floor before calling.');
  return session;
 }

 async function openReceipt(requestId,persona,message){
  const s=await session();
  const purpose=String(message).trim().slice(0,1000);
  const {error}=await identity.rpc('pcc_telephony_session_open',{p_request_id:requestId,p_persona_id:persona,p_purpose:purpose});
  if(error)throw Error('Corporate call receipt could not open: '+error.message);
  return s;
 }

 async function observe(requestId,eventClass,state,providerRef,evidence){
  try{
   const {error}=await identity.rpc('pcc_telephony_session_observe',{
    p_request_id:requestId,p_event_class:eventClass,p_state:state,
    p_provider_ref:providerRef||null,p_evidence:evidence||{}
   });
   if(error)console.warn('Corporate call receipt update failed',error.message);
  }catch(error){console.warn('Corporate call receipt update failed',error);}
 }

 async function execute(message,persona='nace'){
  if(!isCommand(message))throw Error('Give an explicit call request.');
  if(active)throw Error('A call request is already being checked.');
  const normalized=String(message).trim();
  const key=persona+':'+normalized.toLowerCase();
  if(!requests.has(key))requests.set(key,crypto.randomUUID());
  active=requests.get(key);
  const requestId=active;
  let providerRef=null;
  try{
   const s=await openReceipt(requestId,persona,normalized);
   const response=await fetch(root+'/telephony/command',{
    method:'POST',
    headers:{Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'},
    body:JSON.stringify({message:normalized,persona,request_id:requestId}),
    cache:'no-store',
    signal:AbortSignal.timeout(30000)
   });
   const data=await response.json().catch(()=>({}));
   providerRef=data.call_sid||data.call?.call_sid||null;
   const state=String(data.state||data.call?.state||(response.ok?'SUBMITTED':'FAILED')).toUpperCase();
   await observe(requestId,'CONVERSATIONAL_CALL',state,providerRef,{
    persona,
    contact:data.contact||null,
    placed:data.placed===true,
    completed:data.completed===true,
    replayed:data.replayed===true,
    http_status:response.status
   });
   if(!response.ok)throw Error(data.message||data.error||'Calling service unavailable.');
   return {...data,corporate_receipt_request_id:requestId};
  }catch(error){
   await observe(requestId,'CONVERSATIONAL_CALL','UNKNOWN',providerRef,{persona,error:error.message});
   throw Error(error.message+' The request ID is retained; do not automatically redial an uncertain call.');
  }finally{active=null;}
 }
 window.PCCCalling={isCommand,execute};
})();