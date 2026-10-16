/* Private Founder briefing. No report data is embedded in this public source. */
(()=>{
 const mount=document.getElementById('executive-briefing');if(!mount)return;
 const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;};
 const heading=make('h2','Executive briefing'),status=make('p','Sign in with your individual Founder identity to read private reports.'),refresh=make('button','Refresh briefing'),content=make('div');
 refresh.type='button';refresh.className='floor-btn';status.setAttribute('role','status');content.className='executive-brief-grid';mount.append(heading,status,refresh,content);
 let client;
 async function load(){
  refresh.disabled=true;content.replaceChildren();
  try{
   const entry=sessionStorage.getItem('pccEntrySession');if(!entry)throw Error('Enter HQ first, then sign in with your individual Founder identity.');
   if(!window.supabase)throw Error('Sign-in service has not loaded. Refresh this page.');
   client||=window.supabase.createClient('https://ttkceizmjeckrorhkhfr.supabase.co','sb_publishable_v3-qGYPg-tSY-G4cX47HRg_TgMnYEbO',{auth:{persistSession:true,autoRefreshToken:true}});
   const {data:{session}}=await client.auth.getSession();if(!session?.access_token)throw Error('Use the individual Founder sign-in on this page, then refresh the briefing.');
   status.textContent='Reading authenticated executive reports…';
   const response=await fetch('https://ttkceizmjeckrorhkhfr.supabase.co/functions/v1/rpe-corporate-delivery',{method:'POST',headers:{Authorization:'Bearer '+entry,'X-PCC-Individual-Authorization':'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({operation:'READ'}),cache:'no-store',signal:AbortSignal.timeout(15000)});
   const data=await response.json();if(!response.ok)throw Error(data.error==='ENTRY_REQUIRED'?'Your HQ entry expired. Re-enter HQ to read this briefing.':data.error==='FOUNDER_REQUIRED'?'This briefing is restricted to your verified Founder account.':data.error||'Briefing unavailable.');
   status.textContent='Updated '+new Date(data.generated_at).toLocaleString()+' · AI analysis '+(data.model_enabled?'enabled':'paused')+'. Recommendations require evidence before action.';
   const job=data.delivery;
   const delivery=make('article',undefined,'executive-brief-card');delivery.append(make('h3','Operating acceptance task'));
   if(job){delivery.append(make('p',job.state==='COMPLETED'&&job.acceptance?'Completed · Read-only briefing note accepted':'Current stage: '+job.state),make('p','Task: '+job.task_id),make('p','CEO acceptance: '+(job.acceptance?.state||'Outstanding')));
    if(job.artifact_digest)delivery.append(make('p','Evidence SHA-256: '+job.artifact_digest));
    if(job.artifact_body){const details=make('details');details.append(make('summary','Read the dated evidence note'),make('pre',job.artifact_body));delivery.append(details);}
    const receipts=job.worker_receipts||[];if(receipts.length){const details=make('details');details.append(make('summary','Worker steps and receipts'));for(const r of receipts)details.append(make('p',r.operation+' · '+r.state+(r.receipt_id?' · Receipt '+r.receipt_id:'')));delivery.append(details);}
   }else delivery.append(make('p','Waiting for the executive scope and acceptance records.'));
   content.append(delivery);
   const names={ALEXIS_VALE:'Alexis · Chairwoman',MICHAEL_CARRINGTON:'Michael · CEO',CHAD_G_PENNINGTON:'Chad · COO',OLIVER_GRANT:'Oliver · CFO'};
   for(const office of data.offices||[]){const card=make('article',undefined,'executive-brief-card');card.append(make('h3',names[office.office_id]||office.office_id),make('p','Analysis: '+(office.model_state||'Not yet available')));if(office.assessment){card.append(make('p',office.assessment.brief));const list=make('ul');for(const r of office.assessment.recommendations||[])list.append(make('li',r));card.append(list);const details=make('details');details.append(make('summary','Missing evidence'));for(const u of office.assessment.uncertainties||[])details.append(make('p',u));card.append(details);}content.append(card);}
   const records=make('details');records.append(make('summary','Task scope, acceptance criteria and finance checks'));for(const r of data.office_records||[])records.append(make('h3',names[r.office]||r.office),make('pre',JSON.stringify(r.record,null,2)));content.append(records);
   const work=make('details');work.append(make('summary','Internal work queue'));for(const w of data.work_items||[])work.append(make('p',(names[w.office_id]||w.office_id)+' · '+w.state+' · '+w.summary));content.append(work,make('p',data.limits));
  }catch(e){status.textContent=e.message||'Private briefing unavailable.';}finally{refresh.disabled=false;}
 }
 refresh.addEventListener('click',load);load();
})();
