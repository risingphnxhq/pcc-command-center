/* NACE is PCC's system intelligence, separate from Corporate office personas. */
(()=>{'use strict';
const endpoint='https://ttkceizmjeckrorhkhfr.supabase.co/functions/v1/pcc-nace-conversation';
const threadKey='pccNaceThread',token=()=>sessionStorage.getItem('pccEntrySession');
let threadId=sessionStorage.getItem(threadKey),busy=false,player,url,recognition,panel,lines,status,form,input;
const page=()=>location.pathname.split('/').pop()||'index.html';
function say(who,text){const p=document.createElement('p');const b=document.createElement('strong');b.textContent=who+': ';p.append(b,document.createTextNode(text));lines.append(p);lines.scrollTop=lines.scrollHeight}
function showSources(sources){if(!Array.isArray(sources)||!sources.length)return;
 const box=document.createElement('p');box.append(document.createTextNode('Public sources: '));
 sources.slice(0,8).forEach((source,i)=>{try{const u=new URL(source.url);if(u.protocol!=='https:')return;
  if(i)box.append(document.createTextNode(' · '));const a=document.createElement('a');a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=String(source.title||u.hostname).slice(0,100);a.style.color='#9cdbeb';box.append(a)
 }catch{}});lines.append(box)}
function state(text){if(status)status.textContent=text}
function stop(){if(player){player.pause();if(url){URL.revokeObjectURL(url);url=null}player.removeAttribute('src');player.load()}}
async function speak(turnId){if(!turnId||!threadId||!token())return;state('Preparing NACE voice…');
 try{const r=await fetch(endpoint+'/speech',{method:'POST',headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json'},body:JSON.stringify({thread_id:threadId,turn_id:turnId}),cache:'no-store'});
  if(!r.ok)throw Error('NACE speech unavailable ('+r.status+').');const blob=await r.blob();
  if(!blob.size||!blob.type.startsWith('audio/'))throw Error('NACE returned no playable audio.');
  stop();url=URL.createObjectURL(blob);player.src=url;player.hidden=false;
  try{await player.play();state('NACE is speaking.')}catch{state('Tap Play on the NACE audio control.')}
 }catch(e){state(e.message)}}
async function ask(message,mode='ask'){if(busy)return;if(!token()){state('Enter PCC to speak with NACE.');return}
 const text=String(message||'').trim();if(mode!=='welcome'&&!text)return;busy=true;form.querySelector('button').disabled=true;stop();
 if(mode!=='welcome')say('You',text);state('NACE is checking Corporate PCC…');
 try{const r=await fetch(endpoint+'/turn',{method:'POST',headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json'},body:JSON.stringify({thread_id:threadId,message:text,mode,page:page()}),cache:'no-store'});
  const d=await r.json();if(!r.ok)throw Error(d.error==='ENTRY_REQUIRED'?'Your PCC visit expired. Re-enter HQ.':d.error||'NACE unavailable.');
  threadId=d.thread_id;sessionStorage.setItem(threadKey,threadId);say('NACE',d.text);showSources(d.web_sources);state('NACE is ready.');await speak(d.turn_id)
 }catch(e){state(e.message);say('NACE',e.message)}finally{busy=false;form.querySelector('button').disabled=false}}
function open(){if(panel){panel.hidden=false;input.focus()}}
function close(){if(panel)panel.hidden=true;stop()}
function listen(){open();const R=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!R){state('Microphone transcription unavailable here. Type to NACE.');return}
 if(!recognition){recognition=new R();recognition.lang=document.documentElement.lang||'en-US';recognition.interimResults=false;
  recognition.onresult=e=>ask(e.results[0][0].transcript);recognition.onerror=e=>state('Microphone: '+e.error)}
 try{recognition.start();state('Listening…')}catch{state('Microphone unavailable. Type to NACE.')}}
function mount(){if(!token())return;
 const style=document.createElement('style');style.textContent=`
 #pccNaceToggle{position:fixed;right:18px;bottom:18px;z-index:9000;background:#132637;color:#f2d892;border:1px solid #c6a15b;padding:12px 18px;font:700 13px Arial;cursor:pointer;box-shadow:0 10px 30px #0008}
 #pccNacePanel{position:fixed;right:18px;bottom:70px;z-index:9001;width:min(410px,calc(100vw - 36px));max-height:min(600px,calc(100vh - 85px));background:#0a1724;color:#e9e5d7;border:1px solid #c6a15b;box-shadow:0 20px 50px #000b;padding:15px;font:14px Arial;overflow:auto}
 #pccNacePanel[hidden]{display:none}#pccNacePanel button{cursor:pointer;background:#17364d;color:#f2d892;border:1px solid #997845;padding:8px}#pccNacePanel input{min-width:0;flex:1;background:#07111b;color:white;border:1px solid #826c48;padding:9px}
 #pccNaceLines{max-height:245px;overflow:auto;border:1px solid #354354;padding:9px;margin:12px 0;line-height:1.45}#pccNaceLines p{margin:0 0 10px}#pccNaceStatus{font-size:12px;color:#b8cbd4}
 `;document.head.append(style);
 const toggle=document.createElement('button');toggle.id='pccNaceToggle';toggle.type='button';toggle.textContent='◆ Talk to NACE';toggle.onclick=open;document.body.append(toggle);
 panel=document.createElement('section');panel.id='pccNacePanel';panel.hidden=true;panel.setAttribute('aria-label','NACE PCC System Intelligence');
 const top=document.createElement('div');top.style.cssText='display:flex;justify-content:space-between;align-items:center;gap:10px';
 const title=document.createElement('strong');title.textContent='NACE · PCC System Intelligence';
 const x=document.createElement('button');x.type='button';x.textContent='Close';x.onclick=close;top.append(title,x);
 const description=document.createElement('p');description.textContent='Ask about PCC state, office discussions, blockers and next steps. NACE does not approve or execute decisions.';
 lines=document.createElement('div');lines.id='pccNaceLines';lines.textContent='NACE is ready when you are.';
 status=document.createElement('p');status.id='pccNaceStatus';status.textContent='Connected to your PCC visit.';
 form=document.createElement('form');form.style.cssText='display:flex;gap:6px';input=document.createElement('input');input.placeholder='Ask NACE…';input.setAttribute('aria-label','Ask NACE');
 const send=document.createElement('button');send.type='submit';send.textContent='Send';form.append(input,send);
 form.onsubmit=e=>{e.preventDefault();const value=input.value;input.value='';ask(value)};
 const mic=document.createElement('button');mic.type='button';mic.textContent='Speak to NACE';mic.onclick=listen;mic.style.marginTop='8px';
 player=document.createElement('audio');player.controls=true;player.hidden=true;player.style.cssText='width:100%;margin-top:10px';
 panel.append(top,description,lines,status,form,mic,player);document.body.append(panel);
 document.addEventListener('click',e=>{if(e.target?.id==='startOfficeVoice')stop()},true)}
document.addEventListener('DOMContentLoaded',mount);
window.NACE={version:'corporate-live-v1',open,ask,listen,stop,welcome:()=>{open();return threadId?Promise.resolve():ask('', 'welcome')},currentPage:page};
})();
