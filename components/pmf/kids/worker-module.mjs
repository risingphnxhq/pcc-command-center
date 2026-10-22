// Channel-scoped, one-use, exact-content upload. No broad queue execution.
const KIDS_CHANNEL_ID='UCbq_0JCn_0P5cnCVwhIKUOQ';
async function kidsRpc(env,action,args){return sbFetch(env,'/rest/v1/rpc/pmf_kids_slot_v1',{method:'POST',body:JSON.stringify({p_action:action,p_args:args})});}
async function kidsUpload(request,env,url){
 const slot=url.searchParams.get('slot')||'';
 const bearer=request.headers.get('authorization')||'';
 if(request.method!=='POST'||! /^[0-9a-f-]{36}$/.test(slot)||! /^Bearer [a-zA-Z0-9_-]{40,100}$/.test(bearer))return json({ok:false,error:'KIDS_UNAUTHORIZED'},401);
 const length=Number(request.headers.get('content-length'));
 if(!Number.isSafeInteger(length)||length<1000||length>67108864||request.headers.get('content-type')!=='video/mp4')return json({ok:false,error:'KIDS_MEDIA_INVALID'},400);
 const tokenHash=await cmHash(bearer.slice(7));
 const row=await kidsRpc(env,'claim',{slot_id:slot,token_hash:tokenHash});
 if(!row)return json({ok:false,error:'KIDS_NOT_ADMITTED_OR_ALREADY_CLAIMED'},409);
 let googleUploadStarted=false,videoId=null;
 try{
  if(row.size_bytes!==length)throw Error('MEDIA_SIZE_MISMATCH');
  const bytes=await request.arrayBuffer();
  if(bytes.byteLength!==length)throw Error('MEDIA_SIZE_MISMATCH');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  if(digest!==row.sha256)throw Error('MEDIA_HASH_MISMATCH');
  const runtime=await cmRuntimeEnv(env),resolved=resolveYouTubeChannel('phnx_kids',runtime);
  if(resolved.channel_id!==KIDS_CHANNEL_ID||!resolved.refresh_token)throw Error('KIDS_CONNECTION_MISMATCH');
  const token=await exchangeYouTubeRefreshToken(resolved.refresh_token,runtime);
  const auth={Authorization:'Bearer '+token};
  const identity=await fetch('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true',{headers:auth});
  const who=await identity.json();
  if(!identity.ok||who.items?.length!==1||who.items[0].id!==KIDS_CHANNEL_ID)throw Error('KIDS_LIVE_IDENTITY_MISMATCH');
  const init=await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',{method:'POST',headers:{...auth,'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Length':String(length),'X-Upload-Content-Type':'video/mp4'},body:JSON.stringify({snippet:{title:row.title,description:row.description,categoryId:'1'},status:{privacyStatus:'private',publishAt:row.publish_at,selfDeclaredMadeForKids:true,containsSyntheticMedia:true}})});
  if(!init.ok)throw Error('YOUTUBE_SESSION_FAILED_'+init.status);
  const location=init.headers.get('location');
  if(!location||new URL(location).protocol!=='https:'||new URL(location).hostname!=='www.googleapis.com')throw Error('YOUTUBE_SESSION_URI_INVALID');
  googleUploadStarted=true;
  const uploaded=await fetch(location,{method:'PUT',headers:{...auth,'Content-Type':'video/mp4','Content-Length':String(length)},body:bytes});
  const data=await uploaded.json();
  if(!uploaded.ok||!data.id)throw Error('YOUTUBE_UPLOAD_FAILED_'+uploaded.status);
  videoId=data.id;
  const check=await fetch('https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id='+encodeURIComponent(videoId),{headers:auth});
  const result=await check.json(),v=result.items?.[0];
  if(!check.ok||v?.snippet?.channelId!==KIDS_CHANNEL_ID||v?.status?.privacyStatus!=='private'||Date.parse(v?.status?.publishAt)!==Date.parse(row.publish_at))throw Error('YOUTUBE_SCHEDULE_READBACK_FAILED');
  const receipt={channel_id:KIDS_CHANNEL_ID,video_id:videoId,publish_at:row.publish_at,sha256:digest,bytes:length,verified_at:nowIso(),state:'SCHEDULED_PRIVATE_PENDING_RELEASE',source_evidence:row.source_evidence};
  const saved=await kidsRpc(env,'finish',{slot_id:slot,state:'scheduled',video_id:videoId,receipt});
  if(!saved)throw Error('RECEIPT_WRITE_FAILED');
  return json({ok:true,slot_id:slot,...receipt});
 }catch(error){
  const state=googleUploadStarted?'uncertain':'failed';
  try{await kidsRpc(env,'finish',{slot_id:slot,state,video_id:videoId,receipt:{error:error.message,checked_at:nowIso(),no_blind_retry:true}});}catch{}
  return json({ok:false,slot_id:slot,state,video_id:videoId,error:error.message},502);
 }
}

async function kidsPccApi(request,env){
 const origin='https://command.risingphoenixhq.com';
 const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600','Vary':'Origin'};
 const out=(body,status=200)=>cmJson(body,status,cors);
 if(request.headers.get('Origin')!==origin)return cmJson({message:'PCC origin required.'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(request.method!=='POST')return out({message:'Method not allowed.'},405);
 try{
  const b=await cmBody(request);
  if(!['status','pause','resume','retry'].includes(b.action))return out({message:'Unknown Kids action.'},400);
  if(typeof b.entry!=='string'||typeof b.individual!=='string'||!b.entry||!b.individual)return out({message:'Sign in with your existing Founder account on the Command Floor.'},401);
  const verify=await fetch('https://ttkceizmjeckrorhkhfr.supabase.co/functions/v1/pcc-entry-gateway/authorize-private',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+b.entry,'X-PCC-Individual-Authorization':'Bearer '+b.individual},signal:AbortSignal.timeout(15000)});
  if(!verify.ok)return out({message:'PCC Founder authorization is required. Return to the Command Floor to sign in.'},verify.status===503?503:403);
  const proof=await verify.json();
  if(typeof proof.session!=='string')return out({message:'Founder verification unavailable.'},503);
  const identity=JSON.parse(new TextDecoder().decode(cmUnb64(proof.session.split('.')[0])));
  if(identity.scope!=='PCC_FOUNDER_PRIVATE'||!identity.sub||identity.exp<=Date.now())return out({message:'Founder authority required.'},403);
  const args={actor:'PCC Founder '+identity.sub};
  if(b.action==='pause'||b.action==='resume'){
   if(!Number.isInteger(b.expected_version)||b.expected_version<1)return out({message:'Refresh the workspace before changing production.'},400);
   args.expected_version=b.expected_version;
  }
  if(b.action==='retry'){
   if(!/^[0-9a-f-]{36}$/.test(b.slot_id||''))return out({message:'Invalid production slot.'},400);
   args.slot_id=b.slot_id;
  }
  const data=await sbFetch(env,'/rest/v1/rpc/pmf_kids_dashboard_v1',{method:'POST',body:JSON.stringify({p_action:b.action,p_args:args})});
  if(b.action!=='status')return out({ok:true,data});
  let metrics={available:false,reason:'Channel statistics could not be refreshed.'};
  try{
   const runtime=await cmRuntimeEnv(env),c=resolveYouTubeChannel('phnx_kids',runtime);
   if(c.channel_id!==KIDS_CHANNEL_ID)throw Error('wrong channel');
   const token=await exchangeYouTubeRefreshToken(c.refresh_token,runtime);
   const r=await fetch('https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
   const body=await r.json(),item=body.items?.[0];
   if(!r.ok||body.items?.length!==1||item.id!==KIDS_CHANNEL_ID)throw Error('wrong channel');
   metrics={available:true,views:item.statistics.viewCount,videos:item.statistics.videoCount,subscribers:item.statistics.hiddenSubscriberCount?null:item.statistics.subscriberCount,checked_at:nowIso()};
  }catch{}
  return out({ok:true,...data,metrics,automation:{executor:'ChatGPT Work production task',configured:true,cadence:'Daily at 6 a.m. Central',window_start:'2026-10-23',window_end:'2026-11-19',verification:data.production_evidence?'Execution evidence recorded':'First unattended run pending',live_task_status_verified:false},channel:{key:'phnx_kids',id:KIDS_CHANNEL_ID,name:'Phoenix Kids'},checked_at:nowIso()});
 }catch(error){
  const conflict=String(error.message).includes('CONTROL_VERSION_CONFLICT');
  const retry=String(error.message).includes('RETRY_NOT_SAFE');
  return out({message:conflict?'Controls changed elsewhere. Refresh and try again.':retry?'This slot cannot be retried automatically. Inspect its receipt first.':'Kids workspace is temporarily unavailable.'},conflict||retry?409:503);
 }
}
