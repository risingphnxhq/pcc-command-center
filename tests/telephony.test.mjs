import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {telephony,twilioSignature,verifiedTwilio,validDestination,requestedOffice} from '../cloudflare/system-voice-worker/telephony.mjs';
import worker from '../cloudflare/system-voice-worker/worker.mjs';
const sid='CA'+'a'.repeat(32), account='AC'+'b'.repeat(32);
const env={TWILIO_AUTH_TOKEN:'test-secret-only',TWILIO_ACCOUNT_SID:account,TELEPHONY_TEST_DESTINATIONS:'+15555550100'};
const voices=key=>key==='nace'?'approved-test-voice':null;
async function callControls(configured, provider) {
  const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{value:'',disabled:false,textContent:'',listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}});return elements.get(id);};
  const context={document:{getElementById:element},window:{supabase:{createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'mock-test-only'}}})}})}},AbortSignal,crypto,JSON,Error,URLSearchParams,fetch:async(url,options)=>String(url).endsWith('/telephony/readiness')?new Response(JSON.stringify({mode:'STREAMING_HYBRID_PILOT',live_certified:false,configured}),{status:200}):provider(url,options)};
  vm.runInNewContext(readFileSync(new URL('../telephony-runtime.js',import.meta.url),'utf8'),context);
  await new Promise(resolve=>setImmediate(resolve));return element;
}
test('PCC controls hold placement when provider connection is missing',async()=>{
  const el=await callControls({twilio_auth:false,receipts:false},()=>{throw Error('Provider should not be called');});
  assert.equal(el('placeCall').disabled,true);assert.match(el('telephonyStatus').textContent,/Calling is held/);
  await el('callForm').listeners.submit({preventDefault(){}});
});
test('PCC holds placement on empty or incomplete readiness evidence',async()=>{
  for(const configured of [{},{twilio_auth:true,receipts:true}]){const el=await callControls(configured,()=>{throw Error('Must not call provider');});assert.equal(el('placeCall').disabled,true);assert.match(el('telephonyStatus').textContent,/evidence is incomplete/);}
});
test('PCC retry preserves request id after uncertain provider outcome',async()=>{
  const configured=Object.fromEntries(['twilio_account','twilio_auth','caller_number','receipts','pcc_auth','openai','elevenlabs','test_destinations'].map(name=>[name,true]));
  const requests=[];const el=await callControls(configured,async(url,options)=>{requests.push(JSON.parse(options.body));return new Response(JSON.stringify({error:'PROVIDER_OUTCOME_UNKNOWN'}),{status:502});});
  el('callTo').value='+15555550100';el('callPersona').value='chad';el('callPurpose').value='Controlled test';
  await el('callForm').listeners.submit({preventDefault(){}});await el('callForm').listeners.submit({preventDefault(){}});
  assert.equal(requests.length,2);assert.equal(requests[0].request_id,requests[1].request_id);assert.match(el('callResult').textContent,/must not be redialed automatically/);
});
async function signed(path,fields) {
  const url='https://voice.example'+path,body=new URLSearchParams(fields);
  return new Request(url,{method:'POST',body,headers:{'x-twilio-signature':await twilioSignature(env.TWILIO_AUTH_TOKEN,url,body)}});
}
test('Twilio signature matches independently constructed HMAC and evolving form fields',async()=>{
  const reference=createHmac('sha1','12345').update('https://mycompany.com/myapp.php?foo=1&bar=2CallSidCA1234567890ABCDECaller+14158675310Digits1234From+14158675310To+18005551212').digest('base64');
  assert.equal(await twilioSignature('12345','https://mycompany.com/myapp.php?foo=1&bar=2',new URLSearchParams({CallSid:'CA1234567890ABCDE',Caller:'+14158675310',Digits:'1234',From:'+14158675310',To:'+18005551212'})),reference);
  const req=await signed('/twilio/pilot',{CallSid:sid,NewProviderField:'value'});
  assert.equal(await verifiedTwilio(req,env,new URLSearchParams(await req.clone().text())),true);
  assert.equal(await verifiedTwilio(req,env,new URLSearchParams({CallSid:sid})),false);
});
test('missing token and forged signatures denied',async()=>{
  const req=await signed('/twilio/pilot',{CallSid:sid});
  assert.equal(await verifiedTwilio(req,{},new URLSearchParams()),false);
  assert.equal(await verifiedTwilio(new Request(req.url,{headers:{'x-twilio-signature':'forged'}}),env,new URLSearchParams()),false);
});
test('outbound only allows explicit controlled E.164 destinations',()=>{
  assert.equal(validDestination('+15555550100',env),true);
  for(const n of ['911','+1911','+15555550200','5555550100',null])assert.equal(validDestination(n,env),false);
});
test('office handoff requires an explicit transfer request within the six-office pilot',()=>{
  assert.equal(requestedOffice('Please transfer me to Chad.'),'chad');
  assert.equal(requestedOffice('May I speak with Alexis Vale?'),'alexis');
  assert.equal(requestedOffice('Chad told me to call yesterday.'),null);
  assert.equal(requestedOffice('Transfer me to Mason.'),null);
});
test('public readiness reports configuration, never certification',async()=>{
  const r=await telephony(new Request('https://voice.example/telephony/readiness'),{},null,voices);
  const data=await r.json();assert.equal(data.live_certified,false);assert.equal(data.configured.twilio_auth,false);
});
test('outbound route rejects unauthenticated caller before provider request',async()=>{
  const r=await telephony(new Request('https://voice.example/telephony/calls',{method:'POST',body:'{}'}),{CALL_RECEIPTS:{}},null,voices);
  assert.equal(r.status,401);
});
test('signed inbound creates isolated short-lived stream ticket',async()=>{
  const writes=[];const db={prepare(sql){return{bind(...values){return{async run(){writes.push({sql,values});return{};}};}};}};
  const req=await signed('/twilio/pilot',{CallSid:sid,AccountSid:account,From:'+15555550100'});
  const r=await telephony(req,{...env,CALL_RECEIPTS:db},null,voices);assert.equal(r.status,200);
  const body=await r.text();assert.match(body,/<Connect><Stream/);assert.match(body,/<Parameter name="ticket"/);assert.match(body,/<Redirect/);
  assert.ok(!body.includes(env.TWILIO_AUTH_TOKEN));
  const t=writes.find(w=>w.sql.includes('stream_tickets'));assert.equal(t.values[1],sid);assert.ok(t.values[3]>Date.now());
});
test('inbound pilot refuses other callers and other Twilio accounts',async()=>{
  for(const fields of [{CallSid:sid,AccountSid:account,From:'+15555550200'},{CallSid:sid,AccountSid:'ACwrong',From:'+15555550100'}]){
    const r=await telephony(await signed('/twilio/pilot',fields),{...env,CALL_RECEIPTS:{}},null,voices);assert.equal(r.status,403);
  }
});
test('status callback receipt is replay safe and terminal outcomes cannot regress',async()=>{
  const writes=[];const db={prepare(sql){return{bind(...values){return{async run(){writes.push({sql,values});return{};}};}};}};
  const r=await telephony(await signed('/twilio/status',{CallSid:sid,AccountSid:account,CallStatus:'completed',SequenceNumber:'3',CallDuration:'24'}),{...env,CALL_RECEIPTS:db},null,voices);
  assert.equal(r.status,204);assert.ok(writes.find(w=>w.sql.includes('INSERT OR IGNORE')).values.includes(sid+':status:completed:3'));
  assert.match(writes.find(w=>w.sql.startsWith('UPDATE calls SET state')).sql,/state NOT IN/);
});
test('legacy speech delivers first audio chunk without waiting for full synthesis',async()=>{
  const original=globalThis.fetch;let ended=false;
  globalThis.fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]));},cancel(){ended=true;}}),{headers:{'Content-Type':'audio/mpeg'}});
  try{const r=await worker.fetch(new Request('https://voice.example/voice/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'Test',persona_key:'nace'})}),{ELEVENLABS_API_KEY:'test',NACE_VOICE_ID:'test'},{});assert.equal(r.status,200);const reader=r.body.getReader();assert.deepEqual([...((await reader.read()).value)],[1,2,3]);assert.equal(ended,false);await reader.cancel();}finally{globalThis.fetch=original;}
});
test('media pilot forwards live caller frames, speaks partial output, and clears on interruption',async()=>{
  class Socket {
    constructor(){this.readyState=1;this.listeners={};this.sent=[];}
    accept(){} addEventListener(type,fn){(this.listeners[type] ||= []).push(fn);}
    send(raw){this.sent.push(JSON.parse(raw));}
    close(){this.readyState=3;}
    emit(data){for(const fn of this.listeners.message || [])fn({data:JSON.stringify(data)});}
  }
  const phone=new Socket(),client=new Socket(),ai=new Socket(),speech=new Socket();
  const old={fetch:globalThis.fetch,Response:globalThis.Response,WebSocketPair:globalThis.WebSocketPair};
  globalThis.WebSocketPair=class{constructor(){return{0:client,1:phone};}};
  globalThis.Response=class extends old.Response{constructor(body,init){if(init?.status===101)return{status:101,webSocket:init.webSocket};super(body,init);}};
  globalThis.fetch=async url=>({status:101,webSocket:String(url).includes('api.openai.com')?ai:speech});
  const evidence=[];const db={prepare(sql){return{bind(...values){return{async first(){return{call_sid:sid,persona:'nace'};},async run(){evidence.push({sql,values});return{};}};}};}};
  const pending=[];const tick=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
  try{
    const url='https://voice.example/twilio/media';
    const signature=await twilioSignature(env.TWILIO_AUTH_TOKEN,url);
    const r=await telephony(new Request(url,{headers:{upgrade:'websocket','x-twilio-signature':signature}}),{...env,CALL_RECEIPTS:db,OPENAI_API_KEY:'test',ELEVENLABS_API_KEY:'test'}, {waitUntil(p){pending.push(p);}},key=>['nace','chad'].includes(key)?'approved-'+key:null);
    assert.equal(r.status,101);
    phone.emit({event:'start',start:{customParameters:{ticket:'test-ticket'},callSid:sid,accountSid:account,streamSid:'MZtest',mediaFormat:{encoding:'audio/x-mulaw',sampleRate:8000}}});await tick();
    assert.equal(ai.sent[0].type,'session.update');
    ai.emit({type:'session.updated'});phone.emit({event:'media',streamSid:'MZtest',media:{payload:'AAAA'}});await tick();
    assert.ok(ai.sent.some(m=>m.type==='input_audio_buffer.append' && m.audio==='AAAA'));
    ai.emit({type:'response.created',response:{id:'r1'}});
    ai.emit({type:'response.output_text.delta',response_id:'r1',delta:'Hello. '});await tick();
    assert.ok(speech.sent.some(m=>m.text==='Hello. ' && m.flush===true));
    speech.emit({audio:'AAAA'});assert.ok(phone.sent.some(m=>m.event==='media'));
    ai.emit({type:'input_audio_buffer.speech_started'});assert.ok(phone.sent.some(m=>m.event==='clear'));assert.ok(ai.sent.some(m=>m.type==='response.cancel'));
    const before=speech.sent.length;ai.emit({type:'response.output_text.delta',response_id:'r1',delta:'Late canceled words. '});await tick();assert.equal(speech.sent.length,before);
    ai.emit({type:'conversation.item.input_audio_transcription.completed',transcript:'Please transfer me to Chad.'});await tick();
    assert.ok(ai.sent.some(m=>m.type==='session.update' && m.session.instructions.includes('Chad G. Pennington')));
    assert.ok(evidence.some(w=>w.values.includes('office_handoff') && JSON.parse(w.values[3]).authority_changed===false));
    phone.emit({event:'stop'});await tick();await Promise.all(pending);
    assert.ok(evidence.some(w=>w.values.includes('first_audio')));
  }finally{phone.emit({event:'stop'});await tick();Object.assign(globalThis,old);}
});
