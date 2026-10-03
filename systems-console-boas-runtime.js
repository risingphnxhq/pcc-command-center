(()=>{"use strict";
const PROJECT_URL="https://oyjmpbuxvfxusmbouldi.supabase.co";
const PUBLISHABLE_KEY="sb_publishable_rwTE4QRlQkzr0R0f5t5ylA_a9zuj0eE";
const FUNCTION_NAME="pcc-boas-control-v1";
const PRIME="277a74df-5c86-4a16-8e00-1636dad052db",CATE="c8ce89f8-3d1f-47da-bceb-f04ce0cc6bd1";
const client=window.supabase.createClient(PROJECT_URL,PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=id=>document.getElementById(id);
const controls=()=>[$("boasRegisterStream"),$("boasList"),$("boasSignOut")].filter(Boolean);
const output=v=>$("boasOutput").textContent=typeof v==="string"?v:JSON.stringify(v,null,2);
const lane=id=>id===PRIME?"PRIME_MASON_ACCOUNT / CSE":id===CATE?"NEW_MASON_ACCOUNT / CATE":"UNRECOGNIZED";
async function sessionState(){
 const {data:{session}}=await client.auth.getSession(),id=session?.user?.id;
 const recognized=[PRIME,CATE].includes(id);
 $("boasRuntimeStatus").textContent=recognized?"MASON RUNTIME VERIFIED":id?"RUNTIME NOT AUTHORIZED":"AUTHENTICATION REQUIRED";
 $("boasSession").textContent=id?("Subject: "+id+" · "+lane(id)):"No authenticated Systems session.";
 controls().forEach(x=>x.disabled=!recognized);
 if($("boasSignOut"))$("boasSignOut").disabled=!id;
 return session;
}
async function invoke(action,payload={}){
 const session=await sessionState();
 if(!session?.access_token)throw new Error("AUTHENTICATED_SESSION_REQUIRED");
 const r=await fetch(PROJECT_URL+"/functions/v1/"+FUNCTION_NAME,{method:"POST",headers:{Authorization:"Bearer "+session.access_token,apikey:PUBLISHABLE_KEY,"Content-Type":"application/json"},body:JSON.stringify({action,payload}),cache:"no-store"});
 const body=await r.json().catch(()=>({error:"INVALID_BOAS_RESPONSE"}));
 if(!r.ok)throw Object.assign(new Error(body.error||("HTTP_"+r.status)),{body});
 return body;
}
$("boasLoginForm")?.addEventListener("submit",async e=>{e.preventDefault();$("boasRuntimeStatus").textContent="AUTHENTICATING";const {error}=await client.auth.signInWithPassword({email:$("boasEmail").value.trim(),password:$("boasPassword").value});$("boasPassword").value="";if(error){$("boasRuntimeStatus").textContent="AUTHENTICATION FAILED";output({error:error.message});return;}await sessionState();});
$("boasSignOut")?.addEventListener("click",async()=>{await client.auth.signOut({scope:"local"});output("Signed out of Systems BOAS runtime.");await sessionState();});
$("boasRegisterStream")?.addEventListener("click",async()=>{try{output(await invoke("REGISTER_SYSTEM_STREAM",{system_stream_id:$("boasStreamId").value.trim(),system_code:$("boasSystemCode").value.trim(),system_name:$("boasSystemName").value.trim(),system_class:$("boasSystemClass").value.trim(),canon_id:$("boasCanonId").value.trim()}));}catch(e){output(e.body||{error:e.message});}});
$("boasList")?.addEventListener("click",async()=>{try{output(await invoke("LIST",{}));}catch(e){output(e.body||{error:e.message});}});
client.auth.onAuthStateChange(()=>setTimeout(sessionState,0));sessionState();
})();