(() => {
 'use strict';
 const $=id=>document.getElementById(id),client=window.PCC_PSC_D_CLIENT;
 const endpoint='https://oyjmpbuxvfxusmbouldi.supabase.co/functions/v1/pcc-workforce-sync-v1';
 let page=0,sequence=0,signed=false,timer,rows=[];
 const labels={CORPORATE_CHAD_ACCOUNT:'Corporate Chad',NEW_MASON_ACCOUNT:'New Mason',PRIME_CHAD_ACCOUNT:'Prime Chad',PRIME_MASON_ACCOUNT:'Prime Mason'};
 const date=v=>v?new Date(v).toLocaleString(): 'No receipt';
 const human=v=>String(v||'Unknown').replaceAll('_',' ').toLowerCase().replace(/^./,c=>c.toUpperCase());
 function node(tag,text,cls){const n=document.createElement(tag);n.textContent=text??'';if(cls)n.className=cls;return n;}
 function cell(row,text,small){const td=node('td',text);if(small)td.append(node('small',small));row.append(td);return td;}
 function clear(message){rows=[];$('workforceGroups').replaceChildren();$('workforceRows').replaceChildren();const tr=node('tr');const td=cell(tr,message);td.colSpan=7;$('workforceRows').append(tr);$('workforceSummary').replaceChildren();$('accountRows').replaceChildren();$('streamDetails').hidden=true;$('streamDetailBody').replaceChildren();$('workforcePage').textContent='No records loaded';$('workforcePrev').disabled=true;$('workforceNext').disabled=true;}
 function details(r){const root=$('streamDetailBody');root.replaceChildren();root.append(node('h3',r.runtime_label));const dl=node('dl');for(const [k,v] of Object.entries({'Full runtime ID':r.runtime_id,'Suggested title':`${labels[r.runtime_lane]||r.institutional_persona} · ${r.runtime_label} · ${r.runtime_id.slice(0,8)}`,'Office / Actor':r.institutional_persona+' / '+r.actor_id,'Command':r.command_id,'Assigned mission':r.mission_name+' / '+r.mission_id,'Continuity':human(r.evaluated_status),'Registered':date(r.created_at),'Last retrieval':date(r.last_retrieved_at),'Last acknowledgment':date(r.last_ack_at),'Next sync due':date(r.next_sync_due_at),'Checkpoint':r.checkpoint||'No runtime checkpoint saved.','Mission next action':r.next_authorized_action||'Not recorded','Mission blockers':JSON.stringify(r.blockers||[]),'Governing PSC IDs':(r.controlling_psc_ids||[]).join('\n')||'Not recorded','Previous conversation runtime':r.supersedes_runtime_id||'Original registered runtime'})){dl.append(node('dt',k),node('dd',v));}root.append(dl);const copy=node('button','Copy runtime ID');copy.type='button';copy.onclick=async()=>{try{await navigator.clipboard.writeText(r.runtime_id);copy.textContent='Copied';}catch{copy.textContent='Select the full ID above to copy';}};root.append(copy);$('streamDetails').hidden=false;$('streamDetails').open=true;}
 function renderGroups(data){
 const root=$('workforceGroups');root.replaceChildren();
 const note=node('p',data.group_total?'Expand a division and office, then choose a mission to load its streams.':'No mission groups match this view.','small');root.append(note);
 const divisions=new Map();
 for(const g of data.groups||[]){
 const division=g.command_id==='RPE-SYSTEMS-HQ'?'Systems':g.command_id==='RPE-CORPORATE-HQ'?'Corporate':g.command_id;
 if(!divisions.has(division)){const d=node('details');d.append(node('summary',division));root.append(d);divisions.set(division,{element:d,offices:new Map()});}
 const d=divisions.get(division);
 if(!d.offices.has(g.actor_id)){const o=node('details');o.append(node('summary',g.institutional_persona+' · '+g.command_id));d.element.append(o);d.offices.set(g.actor_id,o);}
 const row=node('div',null,'mission-group');row.append(node('strong',g.mission_name),node('small',(g.system_code||'Mission')+' · '+g.streams+' streams · '+g.attention+' need attention'));
 const view=node('button','View streams');view.type='button';view.onclick=()=>{$('workforceQuery').value=g.mission_id;page=0;load();};row.append(view);d.offices.get(g.actor_id).append(row);
 }
 if(data.group_total>(data.groups||[]).length)root.append(node('p','Showing '+(data.groups||[]).length+' of '+data.group_total+' mission groups. Narrow the account, state or search to find other groups.','small'));
 }
 function render(data){renderGroups(data);
  const summary=$('workforceSummary');summary.replaceChildren();for(const [key,label] of [['total','Registered streams'],['active','Active'],['synchronized','Synchronized'],['attention','Needs attention'],['history','Completed / retired']]){const card=node('div',null,'summary-card');card.append(node('span',label),node('strong',String(data.summary?.[key]??0)));summary.append(card);}
  rows=data.rows||[];const tbody=$('workforceRows');tbody.replaceChildren();
  for(const r of rows){const tr=node('tr');cell(tr,r.institutional_persona,labels[r.runtime_lane]||r.runtime_lane);cell(tr,r.runtime_label,r.runtime_id).lastChild.className='runtime-id';cell(tr,r.mission_name,r.system_code||r.command_id);cell(tr,date(r.last_ack_at));cell(tr,r.next_sync_due_at?date(r.next_sync_due_at):'Not established');const td=cell(tr,'');td.append(node('span',human(r.evaluated_status),'state-chip'+(r.evaluated_status==='SYNCHRONIZED'?' synced':'')));const action=cell(tr,'');const open=node('button','Details');open.type='button';open.onclick=()=>details(r);action.append(open);tbody.append(tr);}
  if(!rows.length){const tr=node('tr');const td=cell(tr,data.total?'No rows on this page.':'No registered streams match this view. Account setup alone does not create a stream.');td.colSpan=7;tbody.append(tr);}
  const accounts=$('accountRows');accounts.replaceChildren();for(const a of data.connections||[]){const tr=node('tr');cell(tr,a.label);cell(tr,a.actor_id);cell(tr,human(a.binding_state));cell(tr,String(a.connection_count));cell(tr,String(a.registered_streams));accounts.append(tr);}
  $('workforcePage').textContent=`${data.total?data.page*50+1:0}–${Math.min((data.page+1)*50,data.total)} of ${data.total} matching streams`;$('workforcePrev').disabled=page===0;$('workforceNext').disabled=(page+1)*50>=data.total;
  $('workforceStatus').textContent=`Read ${date(data.generated_at)} · ${data.scope==='FOUR_MAIN_ACCOUNT_LANES'?'Main-account supervision':'Your authorized bindings'}. Refresh does not renew any synchronization.`;
 }
 async function load(){const ticket=++sequence;if(!signed){clear('Sign in with your authorized PCC account to view the workforce.');$('workforceStatus').textContent='Your browser is not signed in. Open Connection settings to access the protected workforce view.';return;}
  $('refreshWorkforce').disabled=true;
  try{const {data,error}=await client.auth.getSession();if(error||!data?.session)throw Error('Sign in again to read protected workforce records.');const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+data.session.access_token},body:JSON.stringify({action:'WORKFORCE_READ',page,query:$('workforceQuery').value.trim(),lane:$('workforceLane').value,status:$('workforceFilter').value,history:$('workforceHistory').value==='history'})});const result=await response.json();if(!response.ok)throw Error(result.error||'Workforce read failed.');if(ticket===sequence)render(result);}catch(e){if(ticket===sequence){clear('Workforce records unavailable.');$('workforceStatus').textContent=e.message;}}finally{if(ticket===sequence)$('refreshWorkforce').disabled=false;}
 }
 $('refreshWorkforce').onclick=load;$('workforcePrev').onclick=()=>{page--;load();};$('workforceNext').onclick=()=>{page++;load();};
 for(const id of ['workforceLane','workforceFilter','workforceHistory'])$(id).onchange=()=>{page=0;$('streamDetails').hidden=true;load();};
 $('workforceQuery').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{page=0;load();},300);};
 window.addEventListener('pcc-session-display',event=>{signed=event.detail.signed;if(!signed){sequence++;clear('Sign in to inspect authorized streams.');}load();});
 setInterval(()=>{if(signed&&!document.hidden)load();},60000);
 client.auth.getUser().then(({data,error})=>{signed=!error&&!!data?.user;if(!signed)$('connectionSettings').open=true;load();}).catch(()=>{signed=false;load();});
})();
