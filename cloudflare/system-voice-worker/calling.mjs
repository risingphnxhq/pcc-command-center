// Conversational dispatch uses the same authenticated, bounded transport as manual calling.
import {subject, telephony, validDestination, offices} from './telephony.mjs';
const origin='https://command.risingphoenixhq.com';
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':origin,Vary:'Origin'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
export const isCallCommand=text=>/^(?:nace[,\s:]*)?(?:(?:please|can you|could you)\s+)?(?:call|phone|dial)\b/i.test(String(text).trim());
export function resolveStored(message,contacts){
 const order=String(message).trim().replace(/^(?:nace[,\s:]*)?(?:(?:please|can you|could you)\s+)?(?:call|phone|dial)\s+/i,'');
 const [target,...purposeParts]=order.split(/\s+(?:about|regarding|to discuss)\s+/i);
 const normalize=x=>String(x).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const name=normalize(target.replace(/[.!?]+$/,''));
 const matches=contacts.filter(c=>{let aliases=[];try{aliases=JSON.parse(c.aliases||'[]')}catch{}return [c.label,...aliases].some(alias=>normalize(alias)===name)});
 return matches.length===1?{contact_id:matches[0].contact_id,purpose:purposeParts.join(' ').trim()||'Requested conversation',clarification:''}:{contact_id:'',purpose:'',clarification:matches.length?'Which contact do you mean?':'I need a verified contact matching that name before calling.'};
}
export async function calling(request,env,ctx,voices){
 const url=new URL(request.url);if(url.pathname!=='/telephony/command')return null;
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, content-type'}});
 if(request.headers.get('Origin')!==origin)return json({error:'ORIGIN_DENIED'},403);
 if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 const owner=await subject(request,env);if(!owner)return json({error:'INDIVIDUAL_CALL_AUTH_REQUIRED'},403);
 if(!env.CALL_RECEIPTS)return json({error:'CALL_COMMAND_NOT_CONFIGURED'},503);
 let body;try{const raw=await request.text();if(raw.length>4096)throw Error();body=JSON.parse(raw);}catch{return json({error:'INVALID_COMMAND'},400);}
 if(!isCallCommand(body.message)||body.message.length>1000||!offices[body.persona||'nace']||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.request_id||''))return json({error:'EXPLICIT_CALL_COMMAND_REQUIRED'},400);
 const prior=await env.CALL_RECEIPTS.prepare('SELECT subject,state,call_sid FROM calls WHERE request_id=?').bind(body.request_id).first();
 if(prior)return prior.subject===owner?json({call:prior,replayed:true,message:'This call request already exists. Check its outcome; it will not be dialed again.'}):json({error:'REQUEST_CONFLICT'},409);
 const rows=await env.CALL_RECEIPTS.prepare('SELECT contact_id,label,aliases FROM call_contacts WHERE subject=? AND state=?').bind(owner,'VERIFIED').all();
 const plan=resolveStored(body.message,rows.results||[]);
 if(!plan.contact_id)return json({state:'NEEDS_CONTACT_VERIFICATION',message:plan.clarification||'I need a verified contact before placing this call.',placed:false});
 const contact=await env.CALL_RECEIPTS.prepare('SELECT contact_id,label,number,source_ref FROM call_contacts WHERE subject=? AND contact_id=? AND state=?').bind(owner,plan.contact_id,'VERIFIED').first();
 if(!contact)return json({error:'CONTACT_NOT_VERIFIED'},409);
 if(!validDestination(contact.number,env))return json({state:'PILOT_DESTINATION_HOLD',message:'The contact is stored, but calling this destination has not passed acceptance yet.',placed:false});
 if(typeof plan.purpose!=='string'||!plan.purpose.trim()||plan.purpose.length>400)return json({error:'CALL_PURPOSE_UNRESOLVED'},409);
 await env.CALL_RECEIPTS.prepare('INSERT OR IGNORE INTO call_command_evidence(request_id,subject,contact_id,persona,purpose,source_ref) VALUES(?,?,?,?,?,?)').bind(body.request_id,owner,contact.contact_id,body.persona||'nace',plan.purpose,contact.source_ref).run();
 const transport=new Request(url.origin+'/telephony/calls',{method:'POST',headers:request.headers,body:JSON.stringify({request_id:body.request_id,to:contact.number,persona:body.persona||'nace',purpose:plan.purpose})});
 const result=await telephony(transport,env,ctx,voices);const data=await result.json();
 return json({...data,contact:contact.label,message:result.ok?'The call request was submitted. Answer your phone; the outcome still needs verification.':data.error},result.status);
}
