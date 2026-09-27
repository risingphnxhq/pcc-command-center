import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const allowedOrigin = "https://command.risingphoenixhq.com";
const allowedVoices = new Set(["alloy","ash","ballad","coral","echo","sage","shimmer","verse","marin","cedar"]);
// Exact Founder-supplied provider mappings. No caller-selected voice ID is accepted.
const elevenlabs = new Map([
  ["ALEXIS_VALE","AgHBZjWY3b5qxxQ4vcKs"],["MICHAEL_CARRINGTON","CZ78DWjyEx9eQimOPqPi"],
  ["CHAD_G_PENNINGTON","QFXXcK8p6cIl5Dtc2XE7"],["JORDAN_HALE","WGINef1wh4Hi6O62bfO8"],
  ["PATRICK_ROSS","Noo2D0uxFyzbTIA6RY8t"],["AIDEN_MERCER","5lm1mr2qVzTTtc8lNLgo"],
  ["REBECCA_LAWSON","VCUa8W1mPO0QcgrSewvs"],["OLIVER_GRANT","tw43HEeA0n5kOjSqCFT9"],
  ["ADRIAN_BLACKWELL","Gympn2UbmkJD4IHh5kzM"],["MARCUS_BELL","3jR9BuQAOPMWUjWpi0ll"],
  ["AVERY_COLE","KzOeyayOIrEe4EKNJvGq"],["JULIAN_ROWE","emNETt9bfkECEZrrqDQS"],
  ["DERRICK_THOMPSON","lGMJWfnL2SVUwU7i6zQ7"],["SIMONE_HARPER","i7vPmJ2yNcoEVAdpHcQa"],
  ["VICTOR_LANG","aCF7fSyJwGn1etojgoux"],["PEGGY_WILSON","FrzKLwOr0y3qieiphjs2"],
  ["SYLVIA_SOMERS","4RZ84U1b4WCqpu57LvIq"],["NACE","H1GhCI6GEKiSXZcwmUkc"],
]);
const personas = new Map([
  ["NACE","NACE"],["ALEXIS_VALE","Alexis Vale"],["MICHAEL_CARRINGTON","Michael Carrington"],
  ["CHAD_G_PENNINGTON","Chad G. Pennington"],["WARREN_LONG","Warren Long"],["JORDAN_HALE","Jordan Hale"],
  ["PATRICK_ROSS","Patrick Ross"],["AIDEN_MERCER","Aiden Mercer"],["REBECCA_LAWSON","Rebecca Lawson"],
  ["OLIVER_GRANT","Oliver Grant"],["ADRIAN_BLACKWELL","Adrian Blackwell"],["MARCUS_BELL","Marcus Bell"],
  ["AVERY_COLE","Avery Cole"],["JULIAN_ROWE","Julian Rowe"],["DERRICK_THOMPSON","Derrick Thompson"],
  ["SIMONE_HARPER","Simone Harper"],["VICTOR_LANG","Victor Lang"],["PEGGY_WILSON","Peggy Wilson"],
  ["SYLVIA_SOMERS","Sylvia Somers"],["MASON_BRIGGS","Mason Briggs"],["LEXINGTON_MARTIN","Lexington Martin"],
]);
const governingPsc = "PSC-A-CORPORATE-PCC-AI-STAFF-VOICE-BANK-CASTING-PURPOSE-2026-09-25-001";
const encoder = new TextEncoder();
const cors = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-voice-approval",
  "Access-Control-Max-Age": "600",
  Vary: "Origin",
};
function reply(body: unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}})}
function b64url(bytes:Uint8Array){let b="";for(const x of bytes)b+=String.fromCharCode(x);return btoa(b).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
function unb64url(value:string){const normalized=value.replace(/-/g,"+").replace(/_/g,"/");const binary=atob(normalized.padEnd(Math.ceil(normalized.length/4)*4,"="));return Uint8Array.from(binary,c=>c.charCodeAt(0))}
async function hmacKey(secret:string){return crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"])}
async function verifyToken(token:string,secret:string,scope:string){
  const parts=token.split(".");if(parts.length!==2||parts[0].length>2048||parts[1].length>128)return null;
  try{if(!await crypto.subtle.verify("HMAC",await hmacKey(secret),unb64url(parts[1]),encoder.encode(parts[0])))return null;
    const p=JSON.parse(new TextDecoder().decode(unb64url(parts[0])));
    if(p.scope!==scope||!Number.isFinite(p.exp)||p.exp<=Date.now()||p.exp>Date.now()+10*60_000)return null;return p
  }catch{return null}
}
async function issueApproval(secret:string,candidateId:string,digest:string){
  const payload=b64url(encoder.encode(JSON.stringify({scope:"PCC_VOICE_BANK_APPROVE",candidate_id:candidateId,candidate_digest:digest,exp:Date.now()+2*60_000,nonce:crypto.randomUUID()})));
  const sig=b64url(new Uint8Array(await crypto.subtle.sign("HMAC",await hmacKey(secret),encoder.encode(payload))));
  return payload+"."+sig
}
async function equalSecrets(a:string,b:string){const ah=new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(a))),bh=new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(b)));let d=0;for(let i=0;i<ah.length;i++)d|=ah[i]^bh[i];return d===0}
async function sha256(value:string){return [...new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(value)))].map(x=>x.toString(16).padStart(2,"0")).join("")}

Deno.serve(async req=>{
  if(req.headers.get("Origin")!==allowedOrigin)return reply({error:"ORIGIN_DENIED"},403);
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  const signing=Deno.env.get("PCC_GATE_SIGNING_KEY"),gate=Deno.env.get("PCC_GATE_PASSPHRASE");
  const url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!signing||signing.length<32||!gate||gate.length<20||!url||!service)return reply({error:"VOICE_BANK_NOT_CONFIGURED"},503);
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if(!await verifyToken(token,signing,"PCC_REGISTERED_READ"))return reply({error:"ENTRY_REQUIRED"},401);
  const path=new URL(req.url).pathname.split("/").pop()||"";
  const admin=createClient(url,service,{auth:{persistSession:false}});

  if(path==="elevenlabs-candidate"&&req.method==="POST"){
    let body:any;try{body=await req.json()}catch{return reply({error:"INVALID_REQUEST"},400)}
    const personaId=String(body.persona_id||""),personaName=personas.get(personaId),voice=elevenlabs.get(personaId);
    if(!personaName||!voice)return reply({error:"PERSONA_NOT_IN_FOUNDER_VOICE_ROSTER"},404);
    const apiKey=Deno.env.get("ELEVENLABS_API_KEY");
    if(!apiKey)return reply({error:"ELEVENLABS_MANAGED_SECRET_REQUIRED"},503);
    const lookup=await fetch(`https://api.elevenlabs.io/v1/voices/${voice}`,{
      headers:{"xi-api-key":apiKey,Accept:"application/json"}
    }).catch(()=>null);
    if(!lookup||!lookup.ok)return reply({error:"PROVIDER_LOOKUP_FAILED",provider_status:lookup?.status||0},502);
    let providerVoice:any;try{providerVoice=await lookup.json()}catch{return reply({error:"PROVIDER_RESPONSE_UNREADABLE"},502)}
    if(providerVoice.voice_id!==voice)return reply({error:"PROVIDER_ID_MISMATCH"},502);
    const canonical=JSON.stringify({persona_id:personaId,persona_name:personaName,candidate_kind:"REFERENCE_VOICE",
      provider:"elevenlabs",provider_voice_ref:voice,provider_model:"eleven_flash_v2_5",governing_psc:governingPsc});
    const digest=await sha256(canonical);
    const {data,error}=await admin.rpc("pcc_voice_bank_submit_candidate",{
      p_persona_id:personaId,p_persona_name:personaName,p_candidate_kind:"REFERENCE_VOICE",
      p_provider:"elevenlabs",p_provider_voice_ref:voice,p_provider_model:"eleven_flash_v2_5",
      p_source_asset_refs:[],p_generation_config:{source:"FOUNDER_SUPPLIED_ORIGINAL_VOICE_ID",provider_lookup_name:providerVoice.name||null},
      p_rights_context:{scope:"RPE_CORPORATE_STAFF",activation_requires:"EXACT_CANDIDATE_FOUNDER_APPROVAL"},
      p_lineage:{canonical_projection:canonical,governing_psc_id:governingPsc,source_roster:"docs/corporate-elevenlabs-voice-roster-2026-09-26.json"},
      p_candidate_digest:digest,p_proposed_by:"PHOENIX_KING_PCC_SESSION"
    });
    if(error)return reply({error:"CANDIDATE_WRITE_FAILED",detail:error.code},503);
    return reply({...data,persona_id:personaId,persona_name:personaName,provider:"elevenlabs",
      provider_voice_ref:voice,provider_name:providerVoice.name||null,activation:"UNCHANGED"},201)
  }

  if(path==="candidate"&&req.method==="POST"){
    let body:any;try{body=await req.json()}catch{return reply({error:"INVALID_REQUEST"},400)}
    const personaId=String(body.persona_id||""),voice=String(body.provider_voice_ref||"");
    const personaName=personas.get(personaId);
    if(!personaName)return reply({error:"PERSONA_NOT_ALLOWED"},400);
    if(!allowedVoices.has(voice))return reply({error:"VOICE_NOT_ALLOWED"},400);
    const canonical=JSON.stringify({persona_id:personaId,persona_name:personaName,candidate_kind:"REFERENCE_VOICE",provider:"openai",provider_voice_ref:voice,provider_model:"gpt-realtime-2.1",governing_psc:governingPsc});
    const digest=await sha256(canonical);
    const {data,error}=await admin.rpc("pcc_voice_bank_submit_candidate",{
      p_persona_id:personaId,p_persona_name:personaName,p_candidate_kind:"REFERENCE_VOICE",
      p_provider:"openai",p_provider_voice_ref:voice,p_provider_model:"gpt-realtime-2.1",
      p_source_asset_refs:[],p_generation_config:{audition_source:"pcc-voice-realtime-session",candidate_class:"REFERENCE_NOT_CUSTOM_GENERATED"},
      p_rights_context:{scope:"INTERNAL_CASTING_CANDIDATE",activation_requires:"FOUNDER_APPROVAL"},
      p_lineage:{canonical_projection:canonical,governing_psc_id:governingPsc},
      p_candidate_digest:digest,p_proposed_by:"PHOENIX_KING_PCC_SESSION"
    });
    if(error)return reply({error:"CANDIDATE_WRITE_FAILED",detail:error.code},503);
    return reply({...data,persona_id:personaId,persona_name:personaName,provider_voice_ref:voice,candidate_kind:"REFERENCE_VOICE"},201)
  }

  if(path==="approval-session"&&req.method==="POST"){
    let body:any;try{body=await req.json()}catch{return reply({error:"INVALID_REQUEST"},400)}
    const candidateId=String(body.candidate_id||""),digest=String(body.candidate_digest||""),passphrase=body.passphrase;
    if(!/^[0-9a-f-]{36}$/i.test(candidateId)||!/^[0-9a-f]{64}$/.test(digest)||typeof passphrase!=="string"||passphrase.length>256)return reply({error:"INVALID_REQUEST"},400);
    if(!await equalSecrets(passphrase,gate))return reply({error:"FOUNDER_REAUTH_DENIED"},401);
    return reply({approval_session:await issueApproval(signing,candidateId,digest),expires_in:120},200)
  }

  if(path==="decide"&&req.method==="POST"){
    let body:any;try{body=await req.json()}catch{return reply({error:"INVALID_REQUEST"},400)}
    const approval=await verifyToken(req.headers.get("X-Voice-Approval")||"",signing,"PCC_VOICE_BANK_APPROVE");
    const candidateId=String(body.candidate_id||""),digest=String(body.candidate_digest||""),decision=String(body.decision||"");
    if(!approval||approval.candidate_id!==candidateId||approval.candidate_digest!==digest)return reply({error:"FOUNDER_APPROVAL_REQUIRED"},403);
    if(!["APPROVE","REJECT"].includes(decision))return reply({error:"INVALID_DECISION"},400);
    const {data,error}=await admin.rpc("pcc_voice_bank_decide_and_activate",{
      p_candidate_id:candidateId,p_candidate_digest:digest,p_decision:decision,
      p_approver_actor_id:"PHOENIX_KING",p_authority_evidence:"PCC_GATE_REAUTH_BOUND_TO_CANDIDATE_DIGEST",
      p_conditions:{candidate_kind:"REFERENCE_VOICE",production_limit:"PCC_OFFICE_PILOT"},
      p_allowed_surfaces:["PCC_OFFICE_PILOT"],p_governing_psc_id:governingPsc
    });
    if(error)return reply({error:"VOICE_DECISION_FAILED",detail:error.message?.includes("CANDIDATE")?error.message:"DATABASE_REJECTED"},409);
    return reply(data,200)
  }

  if(path==="approve-rooms"&&req.method==="POST"){
    let body:any;try{body=await req.json()}catch{return reply({error:"INVALID_REQUEST"},400)}
    if(!body||typeof body!=="object")return reply({error:"INVALID_REQUEST"},400);
    const approval=await verifyToken(req.headers.get("X-Voice-Approval")||"",signing,"PCC_VOICE_BANK_APPROVE");
    const candidateId=String(body.candidate_id||""),digest=String(body.candidate_digest||"");
    if(!/^[0-9a-f-]{36}$/i.test(candidateId)||!/^[0-9a-f]{64}$/.test(digest))return reply({error:"INVALID_REQUEST"},400);
    if(!approval||approval.candidate_id!==candidateId||approval.candidate_digest!==digest)return reply({error:"FOUNDER_APPROVAL_REQUIRED"},403);
    const {data,error}=await admin.rpc("pcc_voice_bank_approve_room_surfaces",{
      p_candidate_id:candidateId,p_candidate_digest:digest,p_governing_psc_id:governingPsc
    });
    if(error)return reply({error:"ROOM_BINDING_REJECTED",detail:error.message?.includes("BINDING_EXISTS")?"GOVERNED_ROLLBACK_REQUIRED":"CANDIDATE_OR_APPROVAL_REJECTED"},409);
    return reply(data,200)
  }

  if(path==="resolve"&&req.method==="GET"){
    const u=new URL(req.url),personaId=u.searchParams.get("persona_id")||"",surface=u.searchParams.get("surface")||"";
    if(!personas.has(personaId)||!/^PCC_[A-Z0-9_]{2,60}$/.test(surface))return reply({error:"INVALID_RESOLUTION_REQUEST"},400);
    const room=surface==="PCC_BOARD_ROOM"||surface==="PCC_WAR_ROOM";
    const {data,error}=await admin.rpc(room?"pcc_voice_bank_resolve_surface":"pcc_voice_bank_resolve",{p_persona_id:personaId,p_surface:surface});
    if(error)return reply({error:error.message?.includes("NOT_ACTIVE")?"VOICE_IDENTITY_NOT_ACTIVE":error.message?.includes("SURFACE")?"SURFACE_NOT_AUTHORIZED":"VOICE_RESOLUTION_FAILED"},404);
    return reply(data,200)
  }

  return reply({error:"ROUTE_NOT_FOUND"},404)
});
