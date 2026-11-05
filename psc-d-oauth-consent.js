// Consent only. Supabase owns PKCE, code redemption and token issuance.
const $=id=>document.getElementById(id);
const id=new URLSearchParams(location.search).get('authorization_id');
const client=window.supabase.createClient('https://oyjmpbuxvfxusmbouldi.supabase.co','sb_publishable_rwTE4QRlQkzr0R0f5t5ylA_a9zuj0eE',{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
let ready=false,busy=false,epoch=0;
const status=text=>{$('status').textContent=text;};
function disable(){ready=false;$('approve').disabled=true;$('deny').disabled=true;$('consent').hidden=true;}
function safeRedirect(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)throw Error('Unsupported callback');return u.href;}
async function load(){
 const current=++epoch;disable();
 if(!id||!/^[A-Za-z0-9_-]{1,256}$/.test(id)){status('A valid authorization request is required. Start the connection from the PSC-D plugin.');return;}
 try{
  const {data:user,error:authError}=await client.auth.getUser();
  if(current!==epoch)return;
  if(authError||!user?.user){$('login').hidden=false;status('Sign in with your existing authorized PCC account.');return;}
  $('login').hidden=true;
  if(!client.auth.oauth)throw Error('OAuth SDK unavailable');
  const {data,error}=await client.auth.oauth.getAuthorizationDetails(id);
  if(current!==epoch)return;
  if(error||!data)throw Error('Authorization unavailable');
  // Do not automatically accept or follow a previously approved redirect.
  if(!data.authorization_id){status('This authorization request has already been processed. Restart the plugin connection.');return;}
  if(data.authorization_id!==id||!data.client?.id||!data.redirect_uri||data.user?.id!==user.user.id)throw Error('Invalid authorization');
  safeRedirect(data.redirect_uri);
  $('account').textContent=user.user.email||user.user.id;
  $('client').textContent=data.client.name||'Unnamed client';
  $('clientId').textContent=data.client.id;
  $('redirect').textContent=data.redirect_uri;
  $('scope').textContent=data.scope||'No additional identity scopes requested';
  ready=true;$('consent').hidden=false;$('approve').disabled=false;$('deny').disabled=false;status('Review the application and return address before choosing.');
 }catch{disable();status('Authorization unavailable or expired. Restart the connection after PCC OAuth setup is complete.');}
}
$('signin').addEventListener('submit',async event=>{event.preventDefault();if(busy)return;busy=true;$('signinButton').disabled=true;try{const {error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});$('password').value='';if(error)status('PCC sign-in failed. Check your credentials.');else await load();}catch{status('PCC sign-in unavailable.');}finally{$('password').value='';busy=false;$('signinButton').disabled=false;}});
async function decide(approve){if(!ready||busy)return;busy=true;const current=epoch;$('approve').disabled=true;$('deny').disabled=true;try{const {data,error}=approve?await client.auth.oauth.approveAuthorization(id,{skipBrowserRedirect:true}):await client.auth.oauth.denyAuthorization(id,{skipBrowserRedirect:true});if(current!==epoch)return;if(error||!data?.redirect_url)throw Error('Decision failed');location.assign(safeRedirect(data.redirect_url));}catch{disable();status('The authorization decision could not be completed. Restart the plugin connection.');}finally{busy=false;}}
$('approve').addEventListener('click',()=>decide(true));$('deny').addEventListener('click',()=>decide(false));
$('signout').addEventListener('click',async()=>{++epoch;disable();$('password').value='';await client.auth.signOut();await load();});
client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){++epoch;disable();$('login').hidden=false;status('Signed out. Sign in to continue.');}});
load();
