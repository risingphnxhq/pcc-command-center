(() => {
 'use strict';
 const kids=document.body.dataset.channel==='phnx_kids',channelName=kids?'Phoenix Kids':'Phoenix Kitchen';
 const target='https://phoenix-builder-runner.tsteelefpa.workers.dev';
 const client=window.supabase.createClient('https://ttkceizmjeckrorhkhfr.supabase.co','sb_publishable_v3-qGYPg-tSY-G4cX47HRg_TgMnYEbO',{auth:{persistSession:true,autoRefreshToken:true}});
 const $=id=>document.getElementById(id),note=$('spiderLaunchStatus');
 let current=null,busy=false,selected=null;
 const central=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',weekday:'short',hour:'numeric',minute:'2-digit'});
 const stamp=value=>value?central.format(new Date(value))+' CT':'Not recorded';
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 function notice(text,error=false){note.textContent=text;note.classList.toggle('error',error);}
 async function identity(){
  const entry=sessionStorage.getItem('pccEntrySession');
  if(!entry){location.replace('index.html?return='+encodeURIComponent(kids?'spider-kids.html':'spider-connections.html')+'');throw Error('PCC entry is required.');}
  const {data:{session}}=await client.auth.getSession();
  if(!session?.access_token)throw Error('Sign in with your existing Founder account on the Command Floor.');
  return {entry,individual:session.access_token};
 }
 async function api(action,args={}){
  const auth=await identity();
  const r=await fetch(target+(kids?'/kids/pcc':'/kitchen/pcc'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...auth,action,...args}),cache:'no-store'});
  const d=await r.json();if(!r.ok)throw Error(d.message||channelName+' request failed.');return d;
 }
 function link(text,url){const a=el('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
 function rows(){
  const list=(current?.slots||[]).filter(s=>($('kindFilter').value==='all'||s.kind===$('kindFilter').value)&&($('stateFilter').value==='all'||s.state===$('stateFilter').value));
  const root=$('slotRows');root.replaceChildren();$('emptyQueue').hidden=!!list.length;
  for(const s of list){
   const tr=el('tr');tr.append(el('td',stamp(s.publish_at)));
   const title=el('td',s.kind==='short'?'Short':'Episode');title.append(el('small',s.title||'Awaiting production'));tr.append(title);
   const state=el('td');state.append(el('span',s.state,'badge '+s.state));
   if(s.state==='scheduled'&&Date.parse(s.publish_at)<Date.now())state.append(el('small','Release due · verify in YouTube'));
   tr.append(state);const review=el('td'),b=el('button','Details','rowbutton');b.type='button';b.onclick=()=>detail(s.slot_id);review.append(b);tr.append(review);root.append(tr);
  }
 }
 function detail(id){
  selected=id;const s=current.slots.find(x=>x.slot_id===id);if(!s)return;
  $('slotDetail').hidden=false;$('detailTitle').textContent=s.title||'Planned '+s.kind;
  $('detailMeta').textContent=stamp(s.publish_at)+' · '+s.state+' · Slot '+s.slot_id;
  const links=$('detailLinks');links.replaceChildren();
  if(/^[A-Za-z0-9_-]{11}$/.test(s.video_id||''))links.append(link('Preview in YouTube ↗','https://www.youtube.com/watch?v='+encodeURIComponent(s.video_id)));
  if(/^libfile_[A-Za-z0-9]+$/.test(s.artifact_library_id||''))links.append(link('Download saved video ↗','https://chatgpt.com/api/library/files/'+s.artifact_library_id+'/download'));
  if(s.state==='failed'&&!s.video_id&&Date.parse(s.publish_at)>Date.now()+3600000){const retry=el('button','Retry production');retry.type='button';retry.onclick=()=>mutate('retry',{slot_id:s.slot_id});links.append(retry);}
  if(s.state==='uncertain')links.append(el('p','Upload outcome is uncertain. Inspect YouTube before retrying.','fine'));
  $('detailReceipt').textContent=JSON.stringify(s.receipt&&Object.keys(s.receipt).length?s.receipt:{message:'No publishing receipt yet.'},null,2);
 }
 function render(d){
  current=d;$('kitchenWorkspace').hidden=false;$('spiderFounderSignIn').hidden=true;
  $('slotCount').textContent=d.slots.length;
  $('scheduledCount').textContent=d.slots.filter(s=>s.state==='scheduled').length;
  $('plannedCount').textContent=d.slots.filter(s=>['planned','ready'].includes(s.state)&&Date.parse(s.publish_at)>Date.now()).length;
  $('attentionCount').textContent=d.slots.filter(s=>['failed','uncertain'].includes(s.state)||(['planned','ready','uploading'].includes(s.state)&&Date.parse(s.publish_at)<Date.now())).length;
  $('gateLabel').textContent=d.control.enabled?'New production is enabled':'New production is paused';
  $('productionToggle').textContent=d.control.enabled?'Pause new production':'Resume new production';
  $('productionToggle').disabled=busy;
  $('automationLabel').textContent='Daily production task configured';
  $('automationState').textContent=d.automation.verification+'. '+(d.control.enabled?'Production gate is open.':'Production gate is closed.');
  $('productionEvidence').textContent=d.production_evidence?'Latest recorded run: '+d.production_evidence.psc_id+' · '+stamp(d.production_evidence.created_at):'No unattended production execution receipt has been recorded yet.';
  $('lastRefresh').textContent='Workspace refreshed: '+stamp(d.checked_at)+'. Task scheduler live status is not queried here.';
  $('channelStatus').textContent=d.channel.id;
  const perf=$('performance');perf.replaceChildren();
  if(d.metrics.available){for(const [label,key] of [['Subscribers','subscribers'],['Channel views','views'],['Video count','videos']]){const row=el('div',undefined,'metricline');row.append(el('span',label),el('strong',d.metrics[key]===null?'Hidden':Number(d.metrics[key]).toLocaleString()));perf.append(row);}perf.append(el('p','YouTube read: '+stamp(d.metrics.checked_at),'fine'));}
  else perf.append(el('p',d.metrics.reason||'Channel statistics unavailable.'));
  const events=$('controlEvents');events.replaceChildren();
  if(!d.events.length)events.append(el('li','No operator control changes recorded.'));
  for(const e of d.events)events.append(el('li',stamp(e.created_at)+' · '+e.action+(e.slot_id?' · '+e.slot_id:'')));
  rows();if(selected)detail(selected);
 }
 async function refresh(message){
  if(busy)return;busy=true;$('refreshKitchen').disabled=true;$('productionToggle').disabled=true;
  try{render(await api('status'));notice(message||channelName+' workspace is current. Scheduled uploads remain private until their release time.');}
  catch(e){$('kitchenWorkspace').hidden=true;$('spiderFounderSignIn').hidden=false;notice(e.message,true);}
  finally{busy=false;$('refreshKitchen').disabled=false;$('productionToggle').disabled=!current;}
 }
 async function mutate(action,args={}){
  if(busy||!current)return;busy=true;$('productionToggle').disabled=true;
  try{await api(action,{expected_version:current.control.version,...args});busy=false;await refresh(action==='pause'?'New production and upload admission paused. Existing YouTube releases are unchanged.':action==='resume'?'New production and upload admission resumed.':'Production retry queued for the next production run.');}
  catch(e){busy=false;notice(e.message,true);$('productionToggle').disabled=false;}
 }
 $('refreshKitchen').onclick=()=>refresh();
 $('productionToggle').onclick=()=>mutate(current.control.enabled?'pause':'resume');
 $('kindFilter').onchange=rows;$('stateFilter').onchange=rows;
 $('closeDetail').onclick=()=>{$('slotDetail').hidden=true;selected=null;};
 $('spiderLaunchRetry').onclick=async()=>{
  if(busy)return;const button=$('spiderLaunchRetry');button.disabled=true;
  try{const auth=await identity();const r=await fetch(target+'/connections/api/pcc-launch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(auth),cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.message||'Connection manager unavailable.');const u=new URL(d.manager_url);if(u.origin!==target||u.pathname!=='/connections'||!/^#access=[A-Za-z0-9_-]{43}$/.test(u.hash))throw Error('Invalid connection manager destination.');location.assign(u.href);}
  catch(e){notice(e.message,true);button.disabled=false;$('spiderFounderSignIn').hidden=false;}
 };
 refresh();setInterval(()=>{if(document.visibilityState==='visible')refresh();},300000);
})();
