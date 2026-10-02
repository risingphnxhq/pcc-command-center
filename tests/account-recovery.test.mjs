import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../recover-account.js',import.meta.url),'utf8');
async function page(hash='',event='INITIAL_SESSION',updateError=null){
  const nodes={}; let callback,updates=0,requests=0,options;
  const document={getElementById(id){return nodes[id]??=( {hidden:true,value:'',disabled:false,addEventListener(type,fn){this[type]=fn}} );}};
  for(const id of ['email','password','confirm','saveButton','requestButton']) document.getElementById(id);
  const auth={onAuthStateChange(fn){callback=fn;},getSession:async()=>{callback(event,{user:{id:'existing'}});return {data:{session:{}},error:null};},updateUser:async()=>{updates++;return {error:updateError};},resetPasswordForEmail:async()=>{requests++;return {error:{status:429}};},signOut:async()=>({error:null})};
  const history={replaceState(){this.cleaned=true;}};
  vm.runInNewContext(source,{document,URLSearchParams,location:{hash,search:'',pathname:'/recover-account.html'},history,window:{supabase:{createClient(url,key,o){options=o;return {auth};}}}});
  await new Promise(resolve=>setImmediate(resolve));
  return {nodes,history,options,updates:()=>updates,requests:()=>requests};
}
test('normal or forged sign-in cannot enable password mutation',async()=>{
  for(const hash of ['', '#type=recovery']){const p=await page(hash,'SIGNED_IN');await p.nodes.passwordForm.submit({preventDefault(){}});assert.equal(p.updates(),0);assert.equal(p.nodes.passwordForm.hidden,true);}
});
test('verified recovery changes existing user without persistent session and clears secrets',async()=>{
  const p=await page('#type=recovery&access_token=synthetic','PASSWORD_RECOVERY');
  assert.equal(p.nodes.passwordForm.hidden,false);assert.equal(p.history.cleaned,true);assert.equal(p.options.auth.persistSession,false);
  p.nodes.password.value='test-only-long-password';p.nodes.confirm.value=p.nodes.password.value;
  await p.nodes.passwordForm.submit({preventDefault(){}});
  assert.equal(p.updates(),1);assert.equal(p.nodes.password.value,'');assert.equal(p.nodes.confirm.value,'');assert.match(p.nodes.status.textContent,/has been updated/);
  await p.nodes.passwordForm.submit({preventDefault(){}});assert.equal(p.updates(),1);
});
test('mismatched passwords cannot change account; provider rejection clears password',async()=>{
  const p=await page('#type=recovery','PASSWORD_RECOVERY',{status:422});
  p.nodes.password.value='test-only-long-password';p.nodes.confirm.value='mismatch';await p.nodes.passwordForm.submit({preventDefault(){}});assert.equal(p.updates(),0);
  p.nodes.confirm.value=p.nodes.password.value;await p.nodes.passwordForm.submit({preventDefault(){}});assert.equal(p.updates(),1);assert.equal(p.nodes.password.value,'');assert.match(p.nodes.status.textContent,/not been changed/);
});
test('rate-limit rejection performs no automatic email retry',async()=>{
  const p=await page();p.nodes.email.value='synthetic@example.test';await p.nodes.requestForm.submit({preventDefault(){}});assert.equal(p.requests(),1);assert.equal(p.nodes.requestButton.disabled,true);assert.match(p.nodes.status.textContent,/limit reached/);
});
