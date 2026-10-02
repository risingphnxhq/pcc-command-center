import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('office entry opens the approved conversation and recovers from backend rejection',async()=>{
 const nodes=new Map(),requests=[];let suspended=0,resumed=0;
 const node=()=>({textContent:'',pause(){},style:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){},append(){},replaceChildren(){},previousElementSibling:{}});
 const document={getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},createElement:node};
 class Peer{addTrack(){}createDataChannel(){return {readyState:'connecting',send(){},close(){}}}async createOffer(){return {sdp:'test-offer'}}async setLocalDescription(){}close(){}}
 const context={document,window:{NACE:{suspend(){suspended++},resume(){resumed++}},addEventListener(){}},location:{search:'?office_id=ALEXIS_VALE'},sessionStorage:{getItem(){return 'test-entry'}},URLSearchParams,AbortSignal,performance,RTCPeerConnection:Peer,navigator:{mediaDevices:{async getUserMedia(){return {getTracks(){return [{stop(){}}]}}}}},cancelAnimationFrame(){},clearTimeout,setTimeout,console,
 async fetch(url){requests.push(url);if(url.includes('voice-bank'))return {ok:true,json:async()=>({provider:'elevenlabs'})};if(url.includes('snapshot'))return {ok:true,json:async()=>({offices:[{office_id:'ALEXIS_VALE',display_name:'Alexis Vale'}]})};return {ok:false,text:async()=>JSON.stringify({error:'PROVIDER_UNAVAILABLE'})};}};
 const source=readFileSync(new URL('../office.html',import.meta.url),'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1];
 vm.runInNewContext(source,context);await tick();await tick();
 assert.ok(requests.some(url=>url.includes('pcc-voice-realtime-session?mode=office')));
 assert.equal(suspended,1);assert.equal(resumed,1);
 assert.match(nodes.get('officeVoiceState').textContent,/PROVIDER_UNAVAILABLE/);
 assert.equal(nodes.get('startOfficeVoice').disabled,false);
});
test('spoken Proceed interrupts playing NACE speech instead of being discarded',async()=>{
 const requests=[],nodes=new Map();let mount,mic;
 const node=()=>({paused:false,hidden:false,append(){},after(){},load(){},removeAttribute(){},pause(){this.paused=true},setAttribute(){},addEventListener(){},closest(){return {querySelector(){return {after(){}}}}}});
 class Recognition{constructor(){mic=this}start(){}abort(){}}
 const document={documentElement:{lang:'en-US'},visibilityState:'visible',addEventListener(name,fn){if(name==='DOMContentLoaded')mount=fn},getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},querySelector(){return node()},createTextNode(v){return v},createElement:node};
 const context={window:{SpeechRecognition:Recognition},document,location:{pathname:'/command-floor.html'},sessionStorage:{getItem(){return 'test-session'},setItem(){}},AbortController,URL:{revokeObjectURL(){}},fetch(url,options){requests.push(JSON.parse(options.body));return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('stopped'),{name:'AbortError'}))))}};
 vm.runInNewContext(readFileSync(new URL('../nace-runtime.js',import.meta.url),'utf8'),context);mount();context.window.NACE.listen();
 mic.onresult({resultIndex:0,results:[{isFinal:true,0:{transcript:'Proceed'}}]});
 assert.equal(requests[0].message,'Proceed');context.window.NACE.stop();await tick();
});
