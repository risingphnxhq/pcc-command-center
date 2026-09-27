import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const origin = "https://command.risingphoenixhq.com";
const voiceId = "H1GhCI6GEKiSXZcwmUkc"; // Founder NACE / System Operator voice.
const greeting = "Phoenix King, welcome aboard. I am NACE, the system voice of Phoenix Command Center. Your entry is verified. I am ready to assist.";
const encoder = new TextEncoder();
const headers = {"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"POST, OPTIONS",
  "Access-Control-Allow-Headers":"authorization, content-type","Access-Control-Max-Age":"600",Vary:"Origin",
  "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...headers,"Content-Type":"application/json"}})}
function bytes(value:string){const normalized=value.replace(/-/g,"+").replace(/_/g,"/");
  return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length/4)*4,"=")),c=>c.charCodeAt(0))}
async function validSession(token:string,secret:string){const parts=token.split(".");
  if(parts.length!==2||parts[0].length>2048||parts[1].length>128)return false;
  try{const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
    if(!await crypto.subtle.verify("HMAC",key,bytes(parts[1]),encoder.encode(parts[0])))return false;
    const p=JSON.parse(new TextDecoder().decode(bytes(parts[0])));
    return p.scope==="PCC_REGISTERED_READ"&&Number.isFinite(p.exp)&&p.exp>Date.now()&&p.exp<Date.now()+10*60_000;
  }catch{return false}}

Deno.serve(async request=>{
  if(request.headers.get("Origin")!==origin)return json({error:"ORIGIN_DENIED"},403);
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
  if(request.method!=="POST"||new URL(request.url).pathname.split("/").pop()!=="greeting")return json({error:"ROUTE_NOT_FOUND"},404);
  const signing=Deno.env.get("PCC_GATE_SIGNING_KEY");
  if(!signing||signing.length<32)return json({error:"ENTRY_VALIDATION_UNAVAILABLE"},503);
  const token=(request.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if(!await validSession(token,signing))return json({error:"ENTRY_REQUIRED"},401);
  const url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),apiKey=Deno.env.get("ELEVENLABS_API_KEY");
  if(!url||!service||!apiKey)return json({error:"VOICE_SERVICE_UNAVAILABLE"},503);
  const admin=createClient(url,service,{auth:{persistSession:false}});
  const {data:binding,error}=await admin.rpc("pcc_voice_bank_resolve_surface",{p_persona_id:"NACE",p_surface:"PCC_ENTRY"});
  if(error||binding?.provider!=="elevenlabs"||binding?.provider_voice_ref!==voiceId)
    return json({error:"NACE_ENTRY_VOICE_NOT_APPROVED"},409);
  const lookup=await fetch(`https://api.elevenlabs.io/v1/voices/${voiceId}`,{headers:{"xi-api-key":apiKey,Accept:"application/json"}}).catch(()=>null);
  if(!lookup?.ok)return json({error:"PROVIDER_LOOKUP_FAILED",provider_status:lookup?.status||0},502);
  let metadata:{voice_id?:string};try{metadata=await lookup.json()}catch{return json({error:"PROVIDER_RESPONSE_UNREADABLE"},502)}
  if(metadata.voice_id!==voiceId)return json({error:"PROVIDER_ID_MISMATCH"},502);
  const rendered=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,{
    method:"POST",headers:{"xi-api-key":apiKey,"Content-Type":"application/json",Accept:"audio/mpeg"},
    body:JSON.stringify({text:greeting,model_id:"eleven_flash_v2_5"})}).catch(()=>null);
  if(!rendered?.ok||!rendered.body)return json({error:"VOICE_RENDER_FAILED",provider_status:rendered?.status||0},502);
  return new Response(rendered.body,{status:200,headers:{...headers,"Content-Type":"audio/mpeg",
    "X-PCC-Persona":"NACE","X-PCC-Surface":"PCC_ENTRY","X-PCC-Voice-Binding":String(binding.binding_id)}});
});
