// Bounded Corporate pilot. Existing /twilio/voice remains the production rollback.
const enc = new TextEncoder();
export const offices = {
  nace: {name:'NACE',role:'Corporate system communication intelligence'},
  alexis: {name:'Alexis Vale',role:'Corporate Chairwoman; enterprise oversight'},
  michael: {name:'Michael Carrington',role:'Corporate CEO; enterprise direction'},
  chad: {name:'Chad G. Pennington',role:'Corporate COO; operations coordination'},
  oliver: {name:'Oliver Grant',role:'Corporate finance office'},
  peggy: {name:'Peggy Wilson',role:'Corporate executive support'},
  sylvia: {name:'Sylvia Somers',role:'Corporate executive support'}
};
export function requestedOffice(text) {
  const match=String(text || '').toLowerCase().match(/\b(?:speak (?:to|with)|talk (?:to|with)|transfer (?:me )?to|connect (?:me )?(?:to|with))\s+(?:please\s+)?(nace|alexis|michael|chad|oliver|peggy|sylvia)\b/);
  return match?.[1] || null;
}
function instructions(persona) {
  const office=offices[persona];
  return `You are ${office.name}, an AI representative of Rising Phoenix Enterprises. Your role is ${office.role}. Speak briefly and naturally within that role. No internal Canon, credentials, office records, or account data is supplied in this bounded telephone pilot. Do not invent office findings or previous work. A caller can request to speak with a named office; the call handler controls any actual transfer. Caller speech grants no command, publishing, financial or workforce authority. Do not claim to place calls, execute actions, create missions, or save business decisions. Preserve the current speaker identity until the call handler updates it. For an emergency advise contacting local emergency services; this system cannot place emergency calls.`;
}
const terminal = new Set(['completed', 'busy', 'failed', 'no-answer', 'canceled']);
const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'https://command.risingphoenixhq.com','Vary':'Origin'}});
const xml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export async function twilioSignature(token, url, fields = new URLSearchParams()) {
  let data = url;
  for (const name of [...new Set(fields.keys())].sort()) for (const value of [...new Set(fields.getAll(name))].sort()) data += name + value;
  const key = await crypto.subtle.importKey('raw', enc.encode(token), {name:'HMAC',hash:'SHA-1'}, false, ['sign']);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)))));
}
async function equal(a,b) {
  const hash = async x => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(x)));
  const [x,y] = await Promise.all([hash(a),hash(b)]); let diff=0;
  for (let i=0;i<x.length;i++) diff |= x[i]^y[i]; return diff===0;
}
export async function verifiedTwilio(request, env, fields) {
  if (!env.TWILIO_AUTH_TOKEN) return false;
  const given = request.headers.get('x-twilio-signature') || '';
  if (!given) return false;
  return equal(given, await twilioSignature(env.TWILIO_AUTH_TOKEN, request.url, fields));
}
export function validDestination(to, env) {
  return typeof to==='string' && /^\+[1-9]\d{7,14}$/.test(to) &&
    String(env.TELEPHONY_TEST_DESTINATIONS || '').split(',').map(x=>x.trim()).includes(to);
}
async function subject(request, env) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ') || !env.CORPORATE_PUBLISHABLE_KEY) return null;
  const headers = {authorization, apikey:env.CORPORATE_PUBLISHABLE_KEY};
  const root = 'https://ttkceizmjeckrorhkhfr.supabase.co';
  const u = await fetch(root+'/auth/v1/user', {headers});
  if (!u.ok) return null;
  const user = await u.json(); if (!user.id || !user.email_confirmed_at) return null;
  const a = await fetch(root+'/rest/v1/rpc/pcc_telephony_caller_authorized', {method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});
  return a.ok && await a.json()===true ? user.id : null;
}
async function event(env, sid, kind, evidence, id = crypto.randomUUID()) {
  await env.CALL_RECEIPTS.prepare('INSERT OR IGNORE INTO call_events(event_id,call_sid,kind,evidence) VALUES(?,?,?,?)').bind(id,sid,kind,JSON.stringify(evidence)).run();
}
async function ticket(env,sid,persona) {
  const token=crypto.randomUUID();
  await env.CALL_RECEIPTS.prepare('INSERT INTO stream_tickets(ticket,call_sid,persona,expires_at) VALUES(?,?,?,?)').bind(token,sid,persona,Date.now()+60000).run();
  return token;
}
async function twiml(request,env,form,persona,voices) {
  const sid=form.get('CallSid');
  if (!/^CA[0-9a-f]{32}$/i.test(sid || '') || form.get('AccountSid')!==env.TWILIO_ACCOUNT_SID) return json({error:'CALL_IDENTITY_DENIED'},403);
  const voice=voices(persona,env); if (!voice) return json({error:'APPROVED_VOICE_NOT_CONFIGURED'},503);
  await env.CALL_RECEIPTS.prepare('INSERT OR IGNORE INTO calls(request_id,call_sid,direction,persona,state) VALUES(?,?,?,?,?)').bind(sid,sid,'inbound',persona,'in-progress').run();
  const t=await ticket(env,sid,persona); const origin=new URL(request.url).origin;
  await event(env,sid,'stream_requested',{persona,transport:'STREAMING_HYBRID'});
  return new Response(`<?xml version="1.0"?><Response><Connect><Stream url="${xml(origin.replace('https:','wss:')+'/twilio/media')}"><Parameter name="ticket" value="${xml(t)}"/></Stream></Connect><Redirect method="POST">${xml(origin+'/twilio/voice')}</Redirect></Response>`,{headers:{'Content-Type':'text/xml','Cache-Control':'no-store'}});
}
export async function telephony(request,env,ctx,voices) {
  const url=new URL(request.url),path=url.pathname;
  if (!['/telephony/readiness','/telephony/calls','/twilio/pilot','/twilio/outbound','/twilio/status','/twilio/media'].includes(path)) return null;
  if (request.method==='OPTIONS') return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'https://command.risingphoenixhq.com','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'authorization, content-type','Vary':'Origin'}});
  if (path==='/telephony/readiness') return json({mode:'STREAMING_HYBRID_PILOT',live_certified:false,configured:{twilio_account:Boolean(env.TWILIO_ACCOUNT_SID),twilio_auth:Boolean(env.TWILIO_AUTH_TOKEN),caller_number:Boolean(env.TWILIO_FROM_NUMBER),receipts:Boolean(env.CALL_RECEIPTS),pcc_auth:Boolean(env.CORPORATE_PUBLISHABLE_KEY),openai:Boolean(env.OPENAI_API_KEY),elevenlabs:Boolean(env.ELEVENLABS_API_KEY),test_destinations:Boolean(env.TELEPHONY_TEST_DESTINATIONS)}});
  if (!env.CALL_RECEIPTS) return json({error:'CALL_RECEIPTS_NOT_CONFIGURED'},503);
  if (path==='/telephony/calls') {
    const owner=await subject(request,env); if (!owner) return json({error:'INDIVIDUAL_AUTHORITY_REQUIRED'},401);
    if (request.method==='GET') {
      const sid=url.searchParams.get('call_sid');
      const call=await env.CALL_RECEIPTS.prepare('SELECT * FROM calls WHERE call_sid=? AND subject=?').bind(sid,owner).first();
      if (!call) return json({error:'CALL_NOT_FOUND'},404);
      const events=await env.CALL_RECEIPTS.prepare('SELECT kind,evidence,created_at FROM call_events WHERE call_sid=? ORDER BY created_at').bind(sid).all();
      return json({call,events:events.results});
    }
    if (request.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) return json({error:'TWILIO_NOT_CONFIGURED'},503);
    const raw=await request.text(); if(raw.length>2048) return json({error:'REQUEST_TOO_LARGE'},413);
    let body;try{body=JSON.parse(raw);}catch{return json({error:'INVALID_JSON'},400);}
    const persona=body.persona || 'nace';
    if (!validDestination(body.to,env) || !offices[persona] || !voices(persona,env) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.request_id || '') || typeof body.purpose!=='string' || !body.purpose.trim() || body.purpose.length>400) return json({error:'INVALID_OR_UNAPPROVED_CALL'},400);
    const prior=await env.CALL_RECEIPTS.prepare('SELECT subject,state,call_sid FROM calls WHERE request_id=?').bind(body.request_id).first();
    if(prior) return prior.subject===owner ? json({call:prior,replayed:true},200) : json({error:'REQUEST_CONFLICT'},409);
    const count=await env.CALL_RECEIPTS.prepare("SELECT count(*) AS n FROM calls WHERE subject=? AND created_at>datetime('now','-1 hour')").bind(owner).first();
    if(count.n>=3) return json({error:'PILOT_RATE_LIMIT'},429);
    // Reserve before provider request. A timeout is ambiguous and must never auto-redial.
    try{await env.CALL_RECEIPTS.prepare('INSERT INTO calls(request_id,subject,direction,persona,purpose,state) VALUES(?,?,?,?,?,?)').bind(body.request_id,owner,'outbound',persona,body.purpose,'REQUESTED').run();}catch{return json({error:'REQUEST_CONFLICT'},409);}
    const base=url.origin; const params=new URLSearchParams({To:body.to,From:env.TWILIO_FROM_NUMBER,Url:base+'/twilio/outbound?request_id='+body.request_id,Method:'POST',StatusCallback:base+'/twilio/status?request_id='+body.request_id,StatusCallbackMethod:'POST',Timeout:'30',TimeLimit:'900'});
    for(const state of ['initiated','ringing','answered','completed']) params.append('StatusCallbackEvent',state);
    let res;
    try{res=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls.json`,{method:'POST',headers:{Authorization:'Basic '+btoa(env.TWILIO_ACCOUNT_SID+':'+env.TWILIO_AUTH_TOKEN),'Content-Type':'application/x-www-form-urlencoded'},body:params,signal:AbortSignal.timeout(15000)});}catch{await env.CALL_RECEIPTS.prepare('UPDATE calls SET state=? WHERE request_id=?').bind('PROVIDER_OUTCOME_UNKNOWN',body.request_id).run();return json({error:'PROVIDER_OUTCOME_UNKNOWN',request_id:body.request_id},502);}
    const data=await res.json();
    if(!res.ok || !data.sid){await env.CALL_RECEIPTS.prepare('UPDATE calls SET state=? WHERE request_id=?').bind('PROVIDER_REJECTED',body.request_id).run();return json({error:'PROVIDER_REJECTED',provider_code:data.code || null},502);}
    await env.CALL_RECEIPTS.prepare('UPDATE calls SET call_sid=COALESCE(call_sid,?),state=CASE WHEN state=? THEN ? ELSE state END,updated_at=CURRENT_TIMESTAMP WHERE request_id=?').bind(data.sid,'REQUESTED',data.status || 'queued',body.request_id).run();
    await event(env,data.sid,'outbound_accepted',{request_id:body.request_id,persona,subject:owner,provider_status:data.status});
    return json({call_sid:data.sid,request_id:body.request_id,state:data.status,completed:false},202);
  }
  if (path==='/twilio/media') {
    if(request.headers.get('upgrade')?.toLowerCase()!=='websocket') return json({error:'UPGRADE_REQUIRED'},426);
    if(!await verifiedTwilio(request,env,new URLSearchParams())) return json({error:'TWILIO_SIGNATURE_DENIED'},403);
    return media(request,env,ctx,voices);
  }
  if(request.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  const form=new URLSearchParams(await request.text());
  if(!await verifiedTwilio(request,env,form) || form.get('AccountSid')!==env.TWILIO_ACCOUNT_SID) return json({error:'TWILIO_SIGNATURE_DENIED'},403);
  if(path==='/twilio/status') {
    const sid=form.get('CallSid'),state=form.get('CallStatus'); if(!/^CA[0-9a-f]{32}$/i.test(sid || '') || !['queued','initiated','ringing','in-progress',...terminal].includes(state)) return json({error:'INVALID_STATUS'},400);
    const id=url.searchParams.get('request_id');
    if(id) await env.CALL_RECEIPTS.prepare('UPDATE calls SET call_sid=COALESCE(call_sid,?) WHERE request_id=? AND (call_sid IS NULL OR call_sid=?)').bind(sid,id,sid).run();
    await event(env,sid,'provider_status',{status:state,sequence:form.get('SequenceNumber'),duration:form.get('CallDuration')},sid+':status:'+state+':'+(form.get('SequenceNumber') || ''));
    await env.CALL_RECEIPTS.prepare("UPDATE calls SET state=?,updated_at=CURRENT_TIMESTAMP WHERE call_sid=? AND state NOT IN ('completed','busy','failed','no-answer','canceled')").bind(state,sid).run();
    return new Response(null,{status:204});
  }
  let persona='nace';
  if(path==='/twilio/outbound') {
    const row=await env.CALL_RECEIPTS.prepare('SELECT persona,call_sid FROM calls WHERE request_id=?').bind(url.searchParams.get('request_id')).first();
    if(!row || (row.call_sid && row.call_sid!==form.get('CallSid'))) return json({error:'CALL_BINDING_DENIED'},403);
    persona=row.persona;
    await env.CALL_RECEIPTS.prepare('UPDATE calls SET call_sid=COALESCE(call_sid,?) WHERE request_id=?').bind(form.get('CallSid'),url.searchParams.get('request_id')).run();
  }else if(!String(env.TELEPHONY_TEST_DESTINATIONS || '').split(',').map(x=>x.trim()).includes(form.get('From'))) return json({error:'PILOT_CALLER_DENIED'},403);
  return twiml(request,env,form,persona,voices);
}

async function upstream(url,headers) {
  const response=await fetch(url,{headers:{...headers,Upgrade:'websocket'}});
  if(response.status!==101 || !response.webSocket) throw Error('UPSTREAM_UPGRADE_FAILED');
  response.webSocket.accept();return response.webSocket;
}
function send(ws,value){if(ws?.readyState===1)ws.send(JSON.stringify(value));}
async function media(request,env,ctx,voices) {
  const pair=new WebSocketPair(),client=pair[0],phone=pair[1];phone.accept();
  let sid,stream,persona,ai,tts,closed=false,ready=false,epoch=0,turn=0,frames=[],audioMs=0,turnStart=0,firstToken=0,audioStarted=false,responseId=null,assistantItem=null;
  let serial=Promise.resolve(),ttsSerial=Promise.resolve();
  const close=async reason=>{if(closed)return;closed=true;clearTimeout(limit);epoch++;ai?.close();tts?.close();phone.close(1000,'Session ended');if(sid)await event(env,sid,'stream_closed',{reason,turns:turn});};
  const fail=()=>ctx.waitUntil(close('UPSTREAM_OR_PROTOCOL_FAILURE'));
  const limit=setTimeout(()=>ctx.waitUntil(close('SESSION_LIMIT')),900000);
  const abort=()=>{epoch++;tts?.close();tts=null;responseId=null;send(ai,{type:'response.cancel'});if(assistantItem)send(ai,{type:'conversation.item.delete',item_id:assistantItem});assistantItem=null;send(phone,{event:'clear',streamSid:stream});};
  const startTts=async()=>{
    const own=epoch;ttsSerial=Promise.resolve();
    const voice=voices(persona,env);
    const ws=await upstream(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/stream-input?model_id=${encodeURIComponent(env.TELEPHONY_TTS_MODEL || 'eleven_flash_v2_5')}&output_format=ulaw_8000`,{'xi-api-key':env.ELEVENLABS_API_KEY});
    if(closed || own!==epoch){ws.close();return null;}tts=ws;
    ws.addEventListener('message',ev=>{try{const d=JSON.parse(ev.data);if(own!==epoch || closed)return;if(d.audio){send(phone,{event:'media',streamSid:stream,media:{payload:d.audio}});audioMs+=atob(d.audio).length/8;if(!audioStarted){audioStarted=true;ctx.waitUntil(event(env,sid,'first_audio',{turn,after_first_token_ms:firstToken?Date.now()-firstToken:null,after_turn_end_ms:turnStart?Date.now()-turnStart:null}));}}if(d.isFinal){send(phone,{event:'mark',streamSid:stream,mark:{name:'turn-'+turn}});ws.close();}}catch{fail();}});
    ws.addEventListener('error',fail);
    send(ws,{text:' ',generation_config:{chunk_length_schedule:[50,90,120,160]}});return ws;
  };
  let ttsReady=Promise.resolve(null),pending='';
  const appendText=(text,flush=false)=>{const own=epoch;ttsSerial=ttsSerial.then(async()=>{const ws=await ttsReady;if(!ws || closed || own!==epoch)return;send(ws,{text,try_trigger_generation:true,...(flush?{flush:true}:{})});}).catch(fail);};
  phone.addEventListener('message',ev=>{serial=serial.then(async()=>{
    if(closed)return;if(typeof ev.data!=='string' || ev.data.length>12000)throw Error('FRAME_TOO_LARGE');const d=JSON.parse(ev.data);
    if(d.event==='connected')return;
    if(d.event==='start'){
      if(sid)throw Error('DUPLICATE_START');
      const token=d.start?.customParameters?.ticket;
      const row=await env.CALL_RECEIPTS.prepare('UPDATE stream_tickets SET claimed=1 WHERE ticket=? AND claimed=0 AND expires_at>? RETURNING call_sid,persona').bind(token || '',Date.now()).first();
      if(!row || row.call_sid!==d.start.callSid || d.start.accountSid!==env.TWILIO_ACCOUNT_SID || d.start.mediaFormat?.encoding!=='audio/x-mulaw' || d.start.mediaFormat?.sampleRate!==8000)throw Error('STREAM_IDENTITY_DENIED');
      sid=row.call_sid;persona=row.persona;stream=d.start.streamSid;
      ai=await upstream('https://api.openai.com/v1/realtime?model='+encodeURIComponent(env.TELEPHONY_REALTIME_MODEL || 'gpt-realtime'),{Authorization:'Bearer '+env.OPENAI_API_KEY});
      ai.addEventListener('message',eventMessage=>{try{const m=JSON.parse(eventMessage.data);
        if(m.type==='conversation.item.input_audio_transcription.completed') {
          const next=requestedOffice(m.transcript);
          if(next && next!==persona && voices(next,env)) {
            const previous=persona;abort();persona=next;
            send(ai,{type:'session.update',session:{instructions:instructions(persona)}});
            send(ai,{type:'response.create',response:{instructions:`The caller explicitly requested this transfer. Introduce yourself as ${offices[persona].name}, the ${offices[persona].role}, acknowledge the handoff, and continue the caller's existing subject. Do not claim a business action occurred.`}});
            ctx.waitUntil(Promise.all([event(env,sid,'office_handoff',{from:previous,to:persona,trigger:'EXPLICIT_CALLER_REQUEST',authority_changed:false}),env.CALL_RECEIPTS.prepare('UPDATE calls SET persona=?,updated_at=CURRENT_TIMESTAMP WHERE call_sid=?').bind(persona,sid).run()]));
          }
        }
        if(m.type==='session.updated' && !ready){ready=true;for(const audio of frames)send(ai,{type:'input_audio_buffer.append',audio});frames=[];send(ai,{type:'response.create',response:{instructions:`Introduce yourself as ${persona}, an AI representative of Rising Phoenix Enterprises. Briefly greet the caller and ask how you can help.`}});}
        if(m.type==='input_audio_buffer.speech_started'){abort();ctx.waitUntil(event(env,sid,'caller_speech_started',{turn}));}
        if(m.type==='input_audio_buffer.speech_stopped')turnStart=Date.now();
        if(m.type==='response.created'){responseId=m.response.id;assistantItem=null;epoch++;tts?.close();turn++;audioMs=0;firstToken=0;audioStarted=false;pending='';ttsReady=startTts().catch(()=>{fail();return null;});}
        if(m.type==='response.output_item.added' && m.response_id===responseId)assistantItem=m.item?.id;
        if(m.type==='response.output_text.delta' && m.response_id===responseId){if(!firstToken)firstToken=Date.now();pending+=m.delta || '';if(pending.length>=50 || /[.!?]\s*$/.test(pending)){appendText(pending,true);pending='';}}
        if(m.type==='response.output_text.done' && m.response_id===responseId){if(pending)appendText(pending,true);pending='';appendText('',false);}
        if(m.type==='response.done' && m.response?.status==='failed')fail();
        if(m.type==='error' && m.error?.code!=='response_cancel_not_active')fail();
      }catch{fail();}});
      ai.addEventListener('error',fail);ai.addEventListener('close',()=>{if(!closed)fail();});
      send(ai,{type:'session.update',session:{type:'realtime',output_modalities:['text'],instructions:instructions(persona),audio:{input:{format:{type:'audio/pcmu'},transcription:{model:'gpt-4o-mini-transcribe'},turn_detection:{type:'server_vad',threshold:0.5,prefix_padding_ms:300,silence_duration_ms:400,create_response:true,interrupt_response:true}}}}});
      await event(env,sid,'stream_connected',{persona,transport:'STREAMING_HYBRID',vad_silence_ms:400});return;
    }
    if(d.event==='media'){
      if(!sid || d.streamSid!==stream || typeof d.media?.payload!=='string' || d.media.payload.length>8192)throw Error('MEDIA_DENIED');
      if(ready)send(ai,{type:'input_audio_buffer.append',audio:d.media.payload});else{if(frames.length>=100)throw Error('UPSTREAM_BACKPRESSURE');frames.push(d.media.payload);}return;
    }
    if(d.event==='mark')await event(env,sid,'playback_mark',{name:d.mark?.name});
    if(d.event==='stop')await close('TWILIO_STOP');
  }).catch(fail);});
  phone.addEventListener('close',()=>ctx.waitUntil(close('PHONE_CLOSED')));phone.addEventListener('error',fail);
  return new Response(null,{status:101,webSocket:client});
}
