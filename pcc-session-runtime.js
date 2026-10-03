(() => {
  'use strict';
  const KEY='pccEntrySession', WELCOME='pccNaceWelcomed', THREAD='pccNaceThread';
  const gateway='https://ttkceizmjeckrorhkhfr.supabase.co/functions/v1/pcc-entry-gateway';
  const pccOrigin='https://command.risingphoenixhq.com';
  let renewing=false, timer=null, locked=false;

  function token(){ return sessionStorage.getItem(KEY); }
  function insidePcc(url){
    try { const u=new URL(url,location.href); return u.origin===pccOrigin; } catch { return false; }
  }
  function stopCapabilities(){
    try { window.NACE?.suspend?.(); } catch {}
    try { window.PCCCalling?.interrupt?.(); } catch {}
    try { if(typeof window.endOfficeVoice==='function') window.endOfficeVoice('PCC locked. Re-enter HQ to resume.'); } catch {}
    try { navigator.mediaDevices?.getUserMedia; } catch {}
  }
  function clearState(){
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(WELCOME);
    sessionStorage.removeItem(THREAD);
  }
  function entryUrl(){
    const here=location.pathname.split('/').pop()||'command-floor.html';
    const allowed=new Set(['command-floor.html','console.html','war-room.html','council-staff.html','execution.html','financial-tracking.html','nhce-monitor.html','registry.html','voice-engine.html','office.html','founder-suite.html','systems-console.html','board-room.html','workforce-console.html']);
    return 'index.html'+(allowed.has(here)?'?return='+encodeURIComponent(here):'');
  }
  function lock(reason='PCC secure presence ended.'){
    if(locked) return;
    locked=true; stopCapabilities(); clearState();
    location.replace(entryUrl()+(entryUrl().includes('?')?'&':'?')+'locked=1');
  }
  async function renew(){
    if(renewing||locked||document.visibilityState!=='visible'||!token()) return;
    renewing=true;
    try{
      const r=await fetch(gateway+'/renew',{method:'POST',headers:{Authorization:'Bearer '+token()},cache:'no-store'});
      const b=await r.json().catch(()=>({}));
      if(!r.ok||!b.session){ if(r.status===401) lock('PCC authorization expired.'); return; }
      sessionStorage.setItem(KEY,b.session);
    }catch(e){ console.warn('PCC session renewal unavailable',e); }
    finally{ renewing=false; }
  }
  function signOut(){
    locked=true; stopCapabilities(); clearState(); location.replace('index.html?signed_out=1');
  }
  function installSignOut(){
    if(document.getElementById('pccGlobalSignOut')) return;
    const b=document.createElement('button'); b.id='pccGlobalSignOut'; b.type='button'; b.textContent='Sign Out';
    b.setAttribute('aria-label','Sign out of Phoenix Command Center');
    Object.assign(b.style,{position:'fixed',right:'14px',bottom:'14px',zIndex:'2147483647',padding:'10px 14px',border:'1px solid rgba(255,255,255,.28)',borderRadius:'8px',background:'rgba(7,12,18,.94)',color:'#fff',font:'inherit',cursor:'pointer'});
    b.addEventListener('click',signOut); document.body.appendChild(b);
  }
  document.addEventListener('click',e=>{
    const a=e.target.closest?.('a[href]'); if(!a||!token()) return;
    if(insidePcc(a.href)) sessionStorage.setItem('pccInternalNavigation','1');
  },true);
  window.addEventListener('pagehide',()=>{
    if(sessionStorage.getItem('pccInternalNavigation')==='1'){sessionStorage.removeItem('pccInternalNavigation');return;}
    clearState();
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden'&&token()) lock();
  });
  window.addEventListener('blur',()=>{ if(token()) lock(); });
  if(!token()){ location.replace(entryUrl()); return; }
  installSignOut();
  renew();
  timer=setInterval(renew,4*60*1000);
  window.PCCSession={renew,signOut,lock};
})();