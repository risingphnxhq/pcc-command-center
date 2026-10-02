import test from 'node:test';
import assert from 'node:assert/strict';
import {calling,isCallCommand} from '../cloudflare/system-voice-worker/calling.mjs';
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
