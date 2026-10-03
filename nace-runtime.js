/* NACE is PCC's system intelligence, separate from Corporate office personas. */
(()=>{'use strict';
const endpoint='https://ttkceizmjeckrorhkhfr.supabase.co/functions/v1/pcc-nace-conversation';
const threadKey='pccNaceThread',token=()=>sessionStorage.getItem('pccEntrySession');
let threadId=sessionStorage.getItem(threadKey),busy=false,player,url,recognition,lines,status,input,send,welcomeStarted=false,listening=false,micActive=false,enableSound;
let turnController=null,speechController=null,sequence=0,lastReply="",suspended=false;
const page=()=>location.pathname.split('/').pop()||'index.html';
function say(who,message){if(!lines)return;const entry=document.createElement('div');entry.className='bubble'+(who==='You'?' user':'');
 const label=document.createElement('small');label.textContent=who;entry.append(label,document.createTextNode(String(message)));lines.append(entry);lines.scrollTop=lines.scrollHeight}
function state(message){if(status)status.textContent=message}
function sources(items){if(!Array.isArray(items)||!items.length||!lines)return;
 const entry=document.createElement('div');entry.className='bubble';const label=document.createElement('small');label.textContent='PUBLIC SOURCES';entry.append(label);
 items.slice(0,8).forEach((item,i)=>{try{const link=new URL(item.url);if(link.protocol!=='https:')return;if(i)entry.append(document.createTextNode(' · '));
  const a=document.createElement('a');a.href=link.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=String(item.title||link.hostname).slice(0,100);entry.append(a)}catch{}});lines.append(entry)}
function stop(){if(!player)return;player.pause();if(url){URL.revokeObjectURL(url);url=null}player.removeAttribute('src');player.load();if(enableSound)enableSound.hidden=true}
function halt(){sequence++;turnController?.abort();speechController?.abort();turnController=null;speechController=null;stop();busy=false;if(send)send.disabled=false;state('Stopped. NACE is listening.')}
async function speak(turnId,current){if(!turnId||!threadId||!token()||!player||current!==sequence)return;state('Preparing NACE voice…');
 speechController=new AbortController();
 try{const response=await fetch(endpoint+'/speech',{method:'POST',headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json'},body:JSON.stringify({thread_id:threadId,turn_id:turnId}),cache:'no-store',signal:speechController.signal});
  if(!response.ok)throw Error('NACE voice is unavailable ('+response.status+').');const audio=await response.blob();if(!audio.size||!audio.type.startsWith('audio/'))throw Error('NACE returned no playable audio.');
  if(current!==sequence)return;
  stop();url=URL.createObjectURL(audio);player.src=url;
  try{await player.play();state('NACE is speaking.')}catch{if(enableSound)enableSound.hidden=false;state('Tap Enable NACE sound once to allow speech in this browser.')}
 }catch(error){if(error.name!=='AbortError'&&current===sequence)state(error.message)}finally{if(current===sequence)speechController=null}}
async function ask(message,mode='ask'){const text=String(message||'').trim();
 if(mode!=='welcome'&&/^(?:nace[,\s:]*)?(?:stop|stop talking|be quiet|interrupt|pause|hold on)[.!]?$/i.test(text)){say('You','Stop');halt();return}
 if(!token()){state('Enter PCC to speak with NACE.');return}if(mode!=='welcome'&&!text)return;
 if(/^(?:nace[,\s:]*)?(?:(?:please|can you|could you)\s+)?(?:call|phone|dial)\b/i.test(text)){
  say('You',text);state('NACE is checking the contact and call authority…');
  try{if(!window.PCCCalling)await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='corporate-calling.js?v=20261002b';script.onload=resolve;script.onerror=()=>reject(Error('Corporate calling could not load.'));document.head.append(script);});const call=await window.PCCCalling.execute(text,'nace');say('NACE',call.message||'Call request recorded.');state(call.message||'Call request recorded.');}catch(error){say('PCC',error.message);state(error.message);}return;
 }
 if(busy||player&&!player.paused)halt();const current=++sequence;busy=true;if(send)send.disabled=true;stop();turnController=new AbortController();
 if(mode!=='welcome')say('You',text);state('NACE is checking Corporate PCC…');
 try{const response=await fetch(endpoint+'/turn',{method:'POST',headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json'},body:JSON.stringify({thread_id:threadId,message:text,mode,page:page()}),cache:'no-store',signal:turnController.signal});
  const data=await response.json();if(!response.ok)throw Error(data.error==='ENTRY_REQUIRED'?'Your PCC visit expired. Re-enter HQ.':data.error||'NACE could not respond.');
  if(current!==sequence)return;threadId=data.thread_id;sessionStorage.setItem(threadKey,threadId);lastReply=String(data.text||'');say('NACE',data.text);sources(data.web_sources);state('NACE is ready.');await speak(data.turn_id,current)
 }catch(error){if(error.name!=='AbortError'&&current===sequence){state(error.message);say('PCC',error.message)}}finally{if(current===sequence){busy=false;turnController=null;if(send)send.disabled=false}}}
function open(){document.getElementById('command-chamber')?.scrollIntoView({behavior:'smooth',block:'start'});input?.focus()}
function listen(){const R=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!R){state('Microphone transcription is unavailable here. Type to NACE.');return}
 if(!recognition){recognition=new R();recognition.lang=document.documentElement.lang||'en-US';recognition.interimResults=false;recognition.continuous=true;
  recognition.onstart=()=>{micActive=true;state('NACE is listening. Say Yes, Proceed, or ask a question.')};
  recognition.onresult=e=>{for(let i=e.resultIndex;i<e.results.length;i++){if(!e.results[i].isFinal)continue;
   const heard=e.results[i][0].transcript.trim();if(!heard)continue;
   const stopCue=/^(?:nace[,\s:]*)?(?:stop|stop talking|be quiet|interrupt|pause|hold on)[.!]?$/i.test(heard);
   const wake=/^nace[,\s:]+/i.test(heard);
   if(stopCue){ask('Stop');continue}if(player&&!player.paused&&!wake){const norm=v=>v.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();const echo=norm(heard);if(echo.split(' ').length>=4&&norm(lastReply).includes(echo))continue;}
   const message=wake?heard.replace(/^nace[,\s:]+/i,''):heard;state('NACE heard: '+message);ask(message)}};
  recognition.onerror=e=>{if(e.error==='no-speech'||e.error==='aborted')return;
   listening=false;if(e.error==='not-allowed'||e.error==='service-not-allowed')state('Microphone permission is needed. Tap MIC to retry or type to NACE.');else state('Microphone: '+e.error+'. Tap MIC to retry.')};
  recognition.onend=()=>{micActive=false;if(listening&&document.visibilityState==='visible')setTimeout(()=>{if(listening&&!micActive)startMic()},250)};
  document.addEventListener('visibilitychange',()=>{if(listening&&document.visibilityState==='visible'&&!micActive)startMic()})}
 if(listening&&micActive)return;listening=true;startMic()}
function startMic(){if(suspended||micActive||!listening||document.visibilityState!=='visible')return;
 try{recognition.start();micActive=true;state('NACE is listening. Say Yes, Proceed, or ask a question.')}
 catch(error){if(error.name!=='InvalidStateError'){listening=false;state('Microphone could not start. Tap MIC to retry or type to NACE.')}}}
function welcome(){if(suspended||welcomeStarted||!token())return Promise.resolve();welcomeStarted=true;return ask('', 'welcome')}
function setupSound(){player=document.createElement('audio');player.setAttribute('aria-label','NACE system voice');player.addEventListener('ended',()=>state('NACE is listening.'));
 enableSound=document.createElement('button');enableSound.type='button';enableSound.textContent='Enable NACE sound';enableSound.hidden=true;enableSound.setAttribute('aria-label','Enable NACE speech in this browser');enableSound.onclick=async()=>{try{await player.play();enableSound.hidden=true;state('NACE is speaking.')}catch{state('Browser audio is blocked. Check this site’s sound permission and device output.')}}}
function mount(){if(!token())return;
 const chamber=document.getElementById('command-chamber');
 if(chamber){lines=document.getElementById('conversation');status=document.getElementById('voiceStatus');input=document.getElementById('commandInput');send=document.querySelector('#commandForm button[type="submit"]');
  setupSound();const stopButton=document.createElement('button');stopButton.type='button';stopButton.className='floor-btn';stopButton.textContent='STOP NACE';stopButton.setAttribute('aria-label','Stop NACE speaking or responding');stopButton.onclick=halt;document.getElementById('commandForm')?.append(stopButton);chamber.closest('main')?.querySelector('#commandForm')?.after(player,enableSound);return}
 const main=document.querySelector('main');if(!main)return;
 const style=document.createElement('style');style.textContent='.nace-presence{margin:8px 0 28px;color:#e9e5d7;font:14px Arial}.nace-presence .nace-lines{max-height:130px;overflow:auto;line-height:1.5}.nace-presence .bubble{padding:5px 0}.nace-presence .bubble small{display:inline;margin-right:9px;color:#e6c378}.nace-presence form{margin-top:8px}.nace-presence input{width:min(100%,560px);padding:6px 0;background:transparent;color:inherit;border:0;border-bottom:1px solid #846d44;outline-offset:4px}.nace-presence h2{font-size:13px;letter-spacing:.12em;color:#e6c378}.nace-presence p{font-size:12px}';document.head.append(style);
 const section=document.createElement('section');section.className='nace-presence';section.setAttribute('aria-label','NACE PCC System Intelligence');
 const heading=document.createElement('h2');heading.textContent='NACE · PCC System Intelligence';heading.style.margin='0 0 8px';
 lines=document.createElement('div');lines.className='nace-lines';lines.setAttribute('role','log');status=document.createElement('p');status.textContent='NACE is ready.';
 const form=document.createElement('form');input=document.createElement('input');input.placeholder='Say “NACE” or type a question here…';input.setAttribute('aria-label','Ask NACE');const stopButton=document.createElement('button');stopButton.type='button';stopButton.textContent='Stop NACE';stopButton.setAttribute('aria-label','Stop NACE speaking or responding');stopButton.onclick=halt;form.append(input,stopButton);form.onsubmit=e=>{e.preventDefault();const value=input.value;input.value='';ask(value)};
 setupSound();section.append(heading,lines,status,form,player,enableSound);main.prepend(section);welcome();listen()}
document.addEventListener('DOMContentLoaded',mount);
window.NACE={version:'corporate-live-v4',open,ask,listen,stop:halt,welcome,currentPage:page,suspend(){suspended=true;listening=false;recognition?.abort();halt();},resume(){suspended=false;listen();}};
})();
