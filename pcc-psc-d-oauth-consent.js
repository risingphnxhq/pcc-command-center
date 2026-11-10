(() => {
 'use strict';
 const $=id=>document.getElementById(id),status=s=>{$('status').textContent=s;};
 const identities={
 '29b4c197-7df5-4ef1-a7ca-e89bad3fd59e':{user:'2d7d7b10-53f1-43ee-9c38-52e7760a7a98',name:'Corporate Chad'},
 '1fc4a7d8-b9f9-4a49-bbe6-3ccc6b32e5ef':{user:'c8ce89f8-3d1f-47da-bceb-f04ce0cc6bd1',name:'New Mason'},
 'e19d319b-2ad7-4c29-b73d-584a41282ae7':{user:'c8ce89f8-3d1f-47da-bceb-f04ce0cc6bd1',name:'New Mason · Synthetic Signal Probe',redirect:'https://chatgpt.com/connector/oauth/Co49aHGowQ_I'}
 };
 const allowedScopes=new Set(['openid','email','profile','offline_access']);
 const authorizationId=new URLSearchParams(location.search).get('authorization_id');
 let details=null;
 const fail=message=>{details=null;$('consent').hidden=true;status(message);};
 if(!authorizationId||!/^[a-zA-Z0-9_-]{8,200}$/.test(authorizationId)){fail('Open Connect from the PSC-D plugin to start a valid authorization request.');return;}
 if(!window.supabase){fail('Account authentication could not load. Refresh this page.');return;}
 const client=window.supabase.createClient('https://oyjmpbuxvfxusmbouldi.supabase.co','sb_publishable_rwTE4QRlQkzr0R0f5t5ylA_a9zuj0eE',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const callbackAllowed=value=>{try{const u=new URL(value);return u.origin==='https://chatgpt.com'&&(u.pathname==='/connector_platform_oauth_redirect'||/^\/connector\/oauth\/[a-zA-Z0-9_-]+$/.test(u.pathname));}catch{return false;}};
 async function review(){
  $('signIn').hidden=true;$('consent').hidden=true;details=null;
  const {data:{session},error}=await client.auth.getSession();
  if(error||!session){$('signIn').hidden=false;status('For New Mason, sign in with your PCC Systems runtime account. For Corporate Chad, sign in with your PCC Corporate account.');return;}
  const verified=await client.auth.getUser();
  if(verified.error||!Object.values(identities).some(identity=>identity.user===verified.data?.user?.id)){fail('This account is not a registered PSC-D identity. Start Connect again from the plugin and sign in with its PCC office account.');return;}
  const {data,error:requestError}=await client.auth.oauth.getAuthorizationDetails(authorizationId);
  if(requestError||!data){const statusCode=Number.isInteger(requestError?.status)?requestError.status:'unknown';const code=/^[a-z_]{1,80}$/.test(requestError?.code||'')?requestError.code:'authorization_details_unavailable';fail('Authorization check failed (HTTP '+statusCode+'; '+code+'). No access was approved.');return;}
  // Supabase may return a completed redirect for a grant the user already approved.
  if(!('authorization_id' in data)){if(callbackAllowed(data.redirect_url)){status('This connection was previously approved. Returning to ChatGPT…');location.replace(data.redirect_url);}else fail('The return destination could not be verified.');return;}
  const identity=identities[data.client?.id];
  const scopes=typeof data.scope==='string'?data.scope.split(/\s+/).filter(Boolean):[];
  if(data.authorization_id!==authorizationId||!identity||data.user?.id!==identity.user||verified.data?.user?.id!==identity.user||!callbackAllowed(data.redirect_uri)||(identity.redirect&&data.redirect_uri!==identity.redirect)||!scopes.length||scopes.some(s=>!allowedScopes.has(s))){fail('This request does not match the signed-in PCC office. No access was approved. Start Connect again from the plugin and sign in with the matching PCC office account.');return;}
  $('officeName').textContent=identity.name;$('approve').textContent='Connect '+identity.name;details=data;$('clientName').textContent=data.client.name||'PCC PSC-D — '+identity.name;$('scopes').textContent=scopes.join(', ');$('destination').textContent=new URL(data.redirect_uri).origin;$('consent').hidden=false;$('approve').disabled=false;$('deny').disabled=false;status('Review this request before approving the connection.');
 }
 $('signIn').addEventListener('submit',async event=>{event.preventDefault();$('signInButton').disabled=true;try{const {error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});$('password').value='';if(error){status('Sign-in failed. Check the account credentials.');return;}await review();}catch{status('Sign-in is unavailable. Try again.');}finally{$('signInButton').disabled=false;}});
 async function decide(approve){if(!details)return;$('approve').disabled=true;$('deny').disabled=true;status(approve?'Connecting your office…':'Canceling connection…');try{const result=approve?await client.auth.oauth.approveAuthorization(authorizationId,{skipBrowserRedirect:true}):await client.auth.oauth.denyAuthorization(authorizationId,{skipBrowserRedirect:true});if(result.error||!callbackAllowed(result.data?.redirect_url)){fail('The connection could not finish. Start Connect again from the plugin.');return;}location.replace(result.data.redirect_url);}catch{fail('The connection could not finish. Start Connect again from the plugin.');}}
 $('approve').addEventListener('click',()=>decide(true));$('deny').addEventListener('click',()=>decide(false));
 review().catch(()=>fail('The authorization service is unavailable. Start Connect again from the plugin.'));
})();
