import test from 'node:test';
import assert from 'node:assert/strict';
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
