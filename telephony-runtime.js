(() => {
  'use strict';
  const root='https://system-voice-worker.tsteelefpa.workers.dev';
  const projectUrl='https://ttkceizmjeckrorhkhfr.supabase.co';
  const publishableKey='sb_publishable_v3-qGYPg-tSY-G4cX47HRg_TgMnYEbO';
  let client=null;
  const $=id=>document.getElementById(id);
  let requestId=null,lastPayload=null,callSid=null,ready=false;

  async function session(){
    if(!window.supabase) throw Error('Individual sign-in could not load. Refresh PCC before calling.');
    client ||= window.supabase.createClient(projectUrl,publishableKey,{auth:{persistSession:true,autoRefreshToken:true}});
    const {data:{session}}=await client.auth.getSession();
    if(!session?.access_token) throw Error('Sign in with your individual Corporate identity on the Command Floor.');
    return session;
  }

  async function auth(){ return (await session()).access_token; }

  async function rpc(name,args){
    await session();
    const {data,error}=await client.rpc(name,args);
    if(error) throw Error(error.message || name+' failed');
    return data;
  }

  async function observe(eventClass,state,providerRef=null,evidence={}){
    if(!requestId) return;
    try{
      await rpc('pcc_telephony_session_observe',{
        p_request_id:requestId,
        p_event_class:eventClass,
        p_state:state,
        p_provider_ref:providerRef,
        p_evidence:evidence
      });
    }catch(error){
      console.warn('Telephony receipt observation failed',error);
    }
  }

  async function call(method,path,body){
    const response=await fetch(root+path,{
      method,
      headers:{Authorization:'Bearer '+await auth(),...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),
      cache:'no-store'
    });
    const data=await response.json();
    if(!response.ok) throw Object.assign(Error(data.error || 'Call service unavailable'),{response:data,status:response.status});
    return data;
  }

  async function readiness(){
    ready=false;
    $('placeCall').disabled=true;
    $('refreshTelephony').disabled=true;
    $('telephonyStatus').textContent='Checking telephone connection…';
    try{
      const response=await fetch(root+'/telephony/readiness',{cache:'no-store',signal:AbortSignal.timeout(10000)});
      if(!response.ok) throw Error('Calling is held. Telephone service did not return a successful connection check.');
      const data=await response.json();
      const required=['twilio_account','twilio_auth','caller_number','receipts','pcc_auth','openai','elevenlabs','test_destinations'];
      if(data.mode!=='STREAMING_HYBRID_PILOT'||data.live_certified!==false||required.some(name=>typeof data.configured?.[name]!=='boolean'))
        throw Error('Calling is held. Telephone connection evidence is incomplete or unrecognized.');
      const missing=required.filter(name=>data.configured[name]!==true).map(name=>name.replaceAll('_',' '));
      ready=missing.length===0;
      $('telephonyStatus').textContent=ready
        ?'Pilot configuration present; live calling acceptance remains pending.'
        :'Calling is held. Configuration needed: '+missing.join(', ')+'.';
    }catch(error){
      ready=false;
      $('telephonyStatus').textContent=error.name==='TimeoutError'
        ?'Calling is held. Telephone connection check timed out. Use Check connection to retry.'
        :error.message;
    }finally{
      $('placeCall').disabled=!ready;
      $('refreshTelephony').disabled=false;
    }
  }

  $('callForm').addEventListener('submit',async event=>{
    event.preventDefault();
    if(!ready) return;
    const payload={
      to:$('callTo').value.trim(),
      persona:$('callPersona').value,
      purpose:$('callPurpose').value.trim()
    };
    const snapshot=JSON.stringify(payload);
    if(snapshot!==lastPayload){
      requestId=crypto.randomUUID();
      lastPayload=snapshot;
    }
    $('placeCall').disabled=true;
    try{
      await rpc('pcc_telephony_session_open',{
        p_request_id:requestId,
        p_persona_id:payload.persona,
        p_purpose:payload.purpose
      });
      const data=await call('POST','/telephony/calls',{...payload,request_id:requestId});
      callSid=data.call_sid || data.call?.call_sid || null;
      await observe('PROVIDER_SUBMISSION',String(data.state || data.call?.state || 'ACCEPTED').toUpperCase(),callSid,{
        provider:'TWILIO',
        replayed:data.replayed===true,
        completed:data.completed===true
      });
      $('callResult').textContent=JSON.stringify({...data,corporate_receipt_request_id:requestId},null,2);
      $('refreshCall').disabled=!callSid;
    }catch(error){
      await observe('PROVIDER_SUBMISSION','UNKNOWN',callSid,{
        provider:'TWILIO',
        error:error.message,
        provider_response:error.response || null
      });
      $('callResult').textContent=error.message+' Same request ID will be retained; an uncertain result must not be redialed automatically.';
    }finally{
      $('placeCall').disabled=!ready;
    }
  });

  $('refreshCall').addEventListener('click',async()=>{
    if(!callSid || !requestId) return;
    try{
      const data=await call('GET','/telephony/calls?call_sid='+encodeURIComponent(callSid));
      const state=String(data.call?.state || data.call?.status || data.state || 'OBSERVED').toUpperCase();
      await observe('STATUS_REFRESH',state,callSid,{provider:'TWILIO',provider_response:data});
      const ledger=await rpc('pcc_telephony_session_read',{p_request_id:requestId});
      $('callResult').textContent=JSON.stringify({provider:data,corporate_ledger:ledger},null,2);
    }catch(error){
      await observe('STATUS_REFRESH','UNKNOWN',callSid,{provider:'TWILIO',error:error.message});
      $('callResult').textContent=error.message;
    }
  });

  $('newCall').addEventListener('click',()=>{
    requestId=null;
    lastPayload=null;
    callSid=null;
    $('refreshCall').disabled=true;
    $('callResult').textContent='New call request selected. Review destination and purpose before calling.';
  });

  $('refreshTelephony').addEventListener('click',readiness);
  readiness();
})();
