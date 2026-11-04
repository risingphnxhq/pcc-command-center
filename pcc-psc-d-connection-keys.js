(() => {
'use strict';
const client=window.PCC_PSC_D_CLIENT,actor=window.PCC_PSC_D_ACTOR_ID,$=id=>document.getElementById(id);
if(!client)return;
let epoch=0,subject=null;
const clear=()=>{$('connectionSecret').value='';$('connectionSecretPanel').hidden=true;$('connectionKeys').replaceChildren();};
client.auth.onAuthStateChange((_event,s)=>{epoch++;if(subject!==(s?.user?.id||null))clear();subject=s?.user?.id||null;$('createConnectionKey').disabled=!s;$('listConnectionKeys').disabled=!s;});
async function call(action,extra={}){
 const {data:{session}}=await client.auth.getSession();
 if(!session?.access_token)throw Error('Sign in with your existing PCC account first.');
 const response=await fetch('https://oyjmpbuxvfxusmbouldi.supabase.co/functions/v1/pcc-workforce-sync-v1',{method:'POST',headers:{authorization:'Bearer '+session.access_token,'content-type':'application/json'},body:JSON.stringify({actor_id:actor,action,...extra}),cache:'no-store'});
 const body=await response.json();if(!response.ok)throw Error(body.error||'Connection request failed');return body;
}
$('createConnectionKey').addEventListener('click',async()=>{
 const e=epoch;clear();$('connectionStatus').textContent='Verifying your existing office binding…';
 try{const r=await call('CREATE_CONNECTION_KEY',{key_label:actor+' PSC-D account connection'});if(e!==epoch)return;$('connectionSecret').value=r.api_key;$('connectionSecretPanel').hidden=false;$('connectionStatus').textContent='Connection key created. Add it to your private PSC-D plugin credential field. This page shows it once; it expires '+r.expires_at+'.';}
 catch(error){if(e===epoch)$('connectionStatus').textContent=error.message;}
});
$('copyConnectionKey').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('connectionSecret').value);$('connectionStatus').textContent='Copied. Paste only into the private plugin credential field.';}catch{$('connectionStatus').textContent='Clipboard unavailable. Use the key field to copy securely.';}});
$('clearConnectionKey').addEventListener('click',clear);
$('listConnectionKeys').addEventListener('click',async()=>{
 const e=epoch;clear();
 try{const r=await call('LIST_CONNECTION_KEYS');if(e!==epoch)return;
 for(const key of r.keys){const row=document.createElement('p'),label=document.createElement('span');label.textContent=key.key_label+' · '+key.status+' · expires '+key.expires_at+' ';row.append(label);
 if(key.status==='ACTIVE'){const button=document.createElement('button');button.textContent='Revoke';button.addEventListener('click',async()=>{const ownEpoch=epoch;button.disabled=true;try{await call('REVOKE_CONNECTION_KEY',{key_id:key.key_id});if(ownEpoch===epoch){label.textContent=key.key_label+' · REVOKED';button.remove();}}catch(error){if(ownEpoch===epoch){$('connectionStatus').textContent=error.message;button.disabled=false;}}});row.append(button);}$('connectionKeys').append(row);}
 $('connectionStatus').textContent=r.keys.length?'Existing connections loaded.':'No PSC-D connection keys exist for this account and office.';
 }catch(error){if(e===epoch)$('connectionStatus').textContent=error.message;}
});
})();