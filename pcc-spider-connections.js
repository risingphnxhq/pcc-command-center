(() => {
 'use strict';
 const target='https://phoenix-builder-runner.tsteelefpa.workers.dev';
 const client=window.supabase.createClient('https://ttkceizmjeckrorhkhfr.supabase.co','sb_publishable_v3-qGYPg-tSY-G4cX47HRg_TgMnYEbO',{auth:{persistSession:true,autoRefreshToken:true}});
 const status=document.getElementById('spiderLaunchStatus'),retry=document.getElementById('spiderLaunchRetry'),signIn=document.getElementById('spiderFounderSignIn');
 let launching=false;
 async function launch(){
  if(launching)return;launching=true;retry.hidden=true;signIn.hidden=true;
  try{
   const entry=sessionStorage.getItem('pccEntrySession');if(!entry){location.replace('index.html?return=spider-connections.html');return;}
   const {data:{session}}=await client.auth.getSession();if(!session?.access_token){status.textContent='Sign in with your existing Founder account on the Command Floor, then choose SPIDER Connections from the rail.';signIn.hidden=false;retry.hidden=false;return;}
   status.textContent='Verifying Founder authority and opening SPIDER…';
   const r=await fetch(target+'/connections/api/pcc-launch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entry,individual:session.access_token}),cache:'no-store'});
   const body=await r.json();if(!r.ok)throw Error(body.message||'SPIDER could not open.');
   const url=new URL(body.manager_url);if(url.origin!==target||url.pathname!=='/connections'||!/^#access=[A-Za-z0-9_-]{43}$/.test(url.hash))throw Error('SPIDER returned an invalid launch destination.');
   location.assign(url.href);
  }catch(e){status.textContent=e.message;retry.hidden=false;signIn.hidden=false;}finally{launching=false;}
 }
 retry.addEventListener('click',launch);launch();
})();
