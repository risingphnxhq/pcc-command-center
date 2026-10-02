/* Contact matching remains inside SVW; no private directory is sent to a model. */
(()=>{'use strict';
 const root='https://system-voice-worker.tsteelefpa.workers.dev';
 let identity=null,active=null;
 const requests=new Map();
 const isCommand=text=>/^(?:nace[,\s:]*)?(?:(?:please|can you|could you)\s+)?(?:call|phone|dial)\b/i.test(String(text).trim());
 async function execute(message,persona='nace'){
  if(!isCommand(message))throw Error('Give an explicit call request.');
  if(active)throw Error('A call request is already being checked.');
  if(!window.supabase)await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/dist/umd/supabase.min.js';script.onload=resolve;script.onerror=()=>reject(Error('Individual calling sign-in could not load.'));document.head.append(script);});
  identity ||= window.supabase.createClient('https://ttkceizmjeckrorhkhfr.supabase.co','sb_publishable_v3-qGYPg-tSY-G4cX47HRg_TgMnYEbO',{auth:{persistSession:true,autoRefreshToken:true}});
  const {data:{session}}=await identity.auth.getSession();
  if(!session?.access_token)throw Error('Sign in once with your Corporate identity on the Command Floor before calling.');
  const key=persona+':'+String(message).trim().toLowerCase();
  if(!requests.has(key))requests.set(key,crypto.randomUUID());
  active=requests.get(key);
  try{
   const response=await fetch(root+'/telephony/command',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({message,persona,request_id:active}),cache:'no-store',signal:AbortSignal.timeout(30000)});
   const data=await response.json();if(!response.ok)throw Error(data.message||data.error||'Calling service unavailable.');
   return data;
  }catch(error){throw Error(error.message+' The request ID is retained; do not automatically redial an uncertain call.');}
  finally{active=null;}
 }
 window.PCCCalling={isCommand,execute};
})();
