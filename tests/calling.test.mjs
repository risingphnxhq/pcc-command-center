import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {calling,isCallCommand,resolveStored} from '../cloudflare/system-voice-worker/calling.mjs';
test('private contact matching is local and ambiguity cannot select a number',()=>{
 const contacts=[{contact_id:'ty',label:'Ty',aliases:'["Phoenix King","me"]'}];
 assert.equal(resolveStored('Call me about our V1 test',contacts).contact_id,'ty');
 assert.equal(resolveStored('Call me about our V1 test',contacts).purpose,'our V1 test');
 assert.equal(resolveStored('Call unknown',contacts).contact_id,'');
 assert.equal(resolveStored('Call Ty',[...contacts,...contacts]).contact_id,'');
});
test('only explicit call orders enter the dispatch path',()=>{
 for(const text of ['Call Ty','NACE, call Ty','Please phone Ty','Can you dial Ty']) assert.equal(isCallCommand(text),true);
 for(const text of ['Proceed','Do not call Ty','Did you call Ty?','Tell me about a call','']) assert.equal(isCallCommand(text),false);
});
test('unauthenticated commands cannot resolve contacts or dispatch',async()=>{
 const result=await calling(new Request('https://worker.test/telephony/command',{method:'POST',headers:{Origin:'https://command.risingphoenixhq.com'},body:JSON.stringify({message:'Call Ty'})}),{}, {},()=>null);
 assert.equal(result.status,403);assert.equal((await result.json()).error,'INDIVIDUAL_CALL_AUTH_REQUIRED');
});
test('cross-origin requests are denied before authentication',async()=>{
 const result=await calling(new Request('https://worker.test/telephony/command',{method:'POST',headers:{Origin:'https://other.test'}}),{}, {},()=>null);
 assert.equal(result.status,403);assert.equal((await result.json()).error,'ORIGIN_DENIED');
});
test('a submitted request is replayed without resolving or dialing again',async()=>{
 const original=globalThis.fetch;let providerRequests=0;
 globalThis.fetch=async url=>{if(String(url).endsWith('/auth/v1/user'))return Response.json({id:'owner',email_confirmed_at:'2026-10-02'});if(String(url).includes('/rpc/pcc_telephony_caller_authorized'))return Response.json(true);providerRequests++;throw Error('Unexpected external request');};
 const env={CORPORATE_PUBLISHABLE_KEY:'public',CALL_RECEIPTS:{prepare:()=>({bind:()=>({first:async()=>({subject:'owner',state:'ringing',call_sid:'CA123'})})})}};
 try{
  const result=await calling(new Request('https://worker.test/telephony/command',{method:'POST',headers:{Origin:'https://command.risingphoenixhq.com',Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({message:'Call Ty',request_id:'cd179ad9-f75e-4ca6-8490-035ddf5a2c6b'})}),env,{},()=>null);
  assert.equal((await result.json()).replayed,true);assert.equal(providerRequests,0);
 }finally{globalThis.fetch=original;}
});
test('conversation client retains the request after uncertain transport and never sends it to a model',async()=>{
 const requests=[];
 const window={supabase:{createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'session'}}})}})}};
 const context={window,crypto:{randomUUID:()=> 'cd179ad9-f75e-4ca6-8490-035ddf5a2c6b'},AbortSignal,fetch:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});throw Error('network unavailable');}};
 vm.runInNewContext(readFileSync(new URL('../corporate-calling.js',import.meta.url),'utf8'),context);
 await assert.rejects(window.PCCCalling.execute('Call me about a test'),/request ID is retained/);
 await assert.rejects(window.PCCCalling.execute('Call me about a test'),/request ID is retained/);
 assert.equal(requests[0].body.request_id,requests[1].body.request_id);
 assert.equal(requests.length,2);
 for(const request of requests)assert.equal(request.url,'https://system-voice-worker.tsteelefpa.workers.dev/telephony/command');
});
