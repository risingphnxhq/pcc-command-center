import { lookup } from "node:dns/promises";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { BlockList } from "node:net";

const denied = new BlockList();
for (const [network, bits] of [
  ["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],
  ["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],
  ["192.88.99.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],
  ["203.0.113.0",24],["224.0.0.0",4],["240.0.0.0",4]
]) denied.addSubnet(network,bits);
const eventName = "pcc.probe.signal";
function callbackTarget(value) {
  if (typeof value !== "string" || value.length > 1500) throw Error("callback");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
    !/^(?:[a-z0-9-]+\.)*(?:openai\.com|chatgpt\.com)$/.test(url.hostname)) throw Error("callback");
  return url;
}
async function signedCallback(url, secret, id, messageId, payload) {
  const signal = AbortSignal.timeout(4500);
  let addresses;
  try { addresses = await lookup(url.hostname, { family: 4, all: true }); }
  catch { throw Error("dns_failed"); }
  if (!addresses.length || addresses.some(({address}) => denied.check(address))) throw Error("address_rejected");
  const address = addresses[0].address;
  const body = JSON.stringify(payload);
  const stamp = String(Math.floor(Date.now()/1000));
  const signature = createHmac("sha256",secret).update(messageId+"."+stamp+"."+body).digest("base64");
  let connection;
  const close = () => { try { connection?.close(); } catch { /* Already closed. */ } };
  signal.addEventListener("abort", close, { once:true });
  try {
    connection = await Deno.connect({hostname:address, port:443});
    signal.throwIfAborted();
    connection = await Deno.startTls(connection, {hostname:url.hostname});
    signal.throwIfAborted();
    const request = new TextEncoder().encode([
      "POST "+url.pathname+url.search+" HTTP/1.0",
      "Host: "+url.host,
      "Connection: close",
      "Content-Type: application/json",
      "Content-Length: "+Buffer.byteLength(body),
      "webhook-id: "+messageId,
      "webhook-timestamp: "+stamp,
      "webhook-signature: v1,"+signature,
      "X-MCP-Subscription-Id: "+id,
      "",body
    ].join("\r\n"));
    for (let offset=0; offset<request.length;) offset+=await connection.write(request.subarray(offset));
    const bytes = new Uint8Array(16384);
    let size=0;
    while(size<bytes.length) {
      const n=await connection.read(bytes.subarray(size));
      if(n===null) break;
      size+=n;
    }
    if(size===bytes.length) throw Error("response_too_large");
    const raw=new TextDecoder().decode(bytes.subarray(0,size));
    const boundary=raw.indexOf("\r\n\r\n");
    const headers=raw.slice(0,boundary);
    const status=/^HTTP\/1\.[01] (\d{3})(?: |\r|$)/.exec(headers);
    if(boundary<0 || !status || /\r\ntransfer-encoding:/i.test(headers)) throw Error("response_http_invalid");
    const data=raw.slice(boundary+4);
    if(Buffer.byteLength(data)>4096) throw Error("response_too_large");
    return {status:Number(status[1]),data};
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  } finally {
    close();
    signal.removeEventListener("abort",close);
  }
}
async function subscriptionStore(action,id,value=null) {
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw Error("store");
  const res=await fetch(base+"/rest/v1/rpc/pcc_signal_probe_subscription_v1",{
    method:"POST", redirect:"error", signal:AbortSignal.timeout(4000),
    headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"},
    body:JSON.stringify({p_action:action,p_id:id,p_value:value})
  });
  if (!res.ok) throw Error("store");
}
async function subscriptionRequest(req,request,id) {
  const stage = name => console.info("PSC_D_PROBE_EVENT_STAGE", request.method, name);
  stage("received");
  if (!await isNewMason(req)) {
    stage("oauth_rejected");
    return unauthorized();
  }
  stage("oauth_verified");
  const params=request.params;
  const fail=(code,message,reason)=>{
    stage(reason ?? (code === -32602 ? "input_rejected" : "storage_failed"));
    return json({jsonrpc:"2.0",id,error:{code,message,...(reason?{data:{reason}}:{})}});
  };
  if(params?.name!==eventName || Object.keys(params.arguments??{}).length!==0) return fail(-32602,"Unknown probe event or filters.");
  let url;
  try {url=callbackTarget(params.delivery?.url);}
  catch {return fail(-32015,"Callback destination rejected.","destination_rejected");}
  const sub="sub_"+createHash("sha256").update(JSON.stringify([eventName,url.href])).digest("hex");
  if(request.method==="events/unsubscribe") {
    try {await subscriptionStore("remove",sub);}
    catch {return fail(-32000,"Probe storage unavailable.");}
    return json({jsonrpc:"2.0",id,result:{}});
  }
  const encoded=params.delivery?.secret;
  if(params.delivery?.mode!=="webhook" || typeof encoded!=="string" ||
    !/^whsec_[A-Za-z0-9+/]{32,88}={0,2}$/.test(encoded)) return fail(-32602,"Invalid webhook signing configuration.");
  const secret=Buffer.from(encoded.slice(6),"base64");
  if(secret.length<24 || secret.length>64) return fail(-32602,"Invalid webhook signing key length.");
  stage("callback_verification_started");
  const challenge=randomUUID();
  try {
    const reply=await signedCallback(url,secret,sub,"verify_"+randomUUID(),{type:"verification",challenge});
    if (reply.status<200 || reply.status>=300) {
      stage("callback_http_"+reply.status);
      throw Error("http_rejected");
    }
    let echo;
    try { echo=JSON.parse(reply.data)?.challenge; } catch { throw Error("response_not_json"); }
    if(typeof echo!=="string" ||
      Buffer.byteLength(echo)!==Buffer.byteLength(challenge) ||
      !timingSafeEqual(Buffer.from(echo),Buffer.from(challenge))) throw Error("challenge_mismatch");
  } catch (error) {
    const known=["dns_failed","address_rejected","http_rejected","response_not_json","challenge_mismatch","response_too_large","response_http_invalid"];
    stage(known.includes(error?.message) ? error.message :
      ["AbortError","TimeoutError"].includes(error?.name) ? "callback_timeout" :
      ["ENOTFOUND","ECONNREFUSED","ECONNRESET","ERR_NOT_IMPLEMENTED","ERR_INVALID_ARG_TYPE"].includes(error?.code)
        ? "transport_"+error.code : "transport_failed");
    return fail(-32015,"Callback verification failed.","challenge_failed");
  }
  stage("callback_verified");
  const refreshBefore=new Date(Date.now()+55*60*1000).toISOString();
  try {await subscriptionStore("store",sub,JSON.stringify({url:url.href,secret:encoded}));}
  catch {return fail(-32000,"Probe storage unavailable.");}
  stage("subscription_stored");
  console.info("PSC_D_SYNTHETIC_CALLBACK_VERIFIED");
  return json({jsonrpc:"2.0",id,result:{id:sub,refreshBefore,cursor:null,truncated:false}});
}
const base = "https://oyjmpbuxvfxusmbouldi.supabase.co";
const endpoint = base + "/functions/v1/pcc-psc-d-stream-signal-probe-v1";
const scopes = ["openid", "profile", "email", "offline_access"];
const challenge = 'Bearer resource_metadata="' + endpoint + '/.well-known/oauth-protected-resource"';
const unauthorized = () => new Response(null, { status: 401, headers: { "WWW-Authenticate": challenge } });
async function isNewMason(req) {
  const token = req.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!token || !key) return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const claims = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (claims.iss !== base + "/auth/v1" || !claims.session_id ||
      !(claims.client_id === "e19d319b-2ad7-4c29-b73d-584a41282ae7")) return false;
    const result = await fetch(base + "/auth/v1/user", { headers: {
      apikey: key, Authorization: "Bearer " + token
    }, signal: AbortSignal.timeout(5000) });
    if (!result.ok) return false;
    const user = await result.json();
    return user.id === claims.sub && user.id === "c8ce89f8-3d1f-47da-bceb-f04ce0cc6bd1";
  } catch { return false; }
}
const versions = ["2025-06-18", "2025-11-25"];
const json = (body, status = 200) => Response.json(body, { status });
async function sendSingleProbe(req) {
  const authorization = req.headers.get("authorization") ?? "";
  const hash = createHash("sha256").update(authorization.replace(/^Bearer /,"")).digest();
  if (req.method !== "POST" || Date.now() > 1794328815390 ||
      !timingSafeEqual(hash,Buffer.from("01f3e350e16ab3b499f1c3700171a3119a01fd2cc2c16faca259587273657cf4","hex"))) return new Response(null,{status:404});
  const input = await req.json().catch(() => null);
  const subscription = input?.subscription;
  const runToken = input?.run_token;
  if (typeof subscription !== "string" || !/^sub_[a-f0-9]{64}$/.test(subscription) ||
      typeof runToken !== "string" || !/^[a-f0-9]{64}$/.test(runToken) ||
      createHash("sha256").update(runToken).digest("hex") !== "b8069240c8c67297afa9cbb9f1712cd7e79c21afe318541e852073be8b58063f") return json({status:"invalid_test_input"},400);
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) return json({status:"storage_unavailable"},502);
  const claim = await fetch(base+"/rest/v1/rpc/pcc_signal_probe_claim_v1",{
    method:"POST",redirect:"error",signal:AbortSignal.timeout(4000),
    headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"},
    body:JSON.stringify({p_id:subscription})
  });
  if (!claim.ok) return json({status:"claim_failed"},502);
  const saved = await claim.json();
  if (!saved) return json({status:"no_active_subscription"},409);
  try {
    const config = JSON.parse(saved);
    const eventId = "evt_"+randomUUID();
    const result = await signedCallback(callbackTarget(config.url),Buffer.from(config.secret.slice(6),"base64"),
      subscription,eventId,{eventId,name:eventName,timestamp:new Date().toISOString(),data:{marker:"PCC_PROBE_OK",run_token:runToken},cursor:null});
    const accepted = result.status>=200 && result.status<300;
    console.info("PSC_D_PROBE_DELIVERY",eventId,result.status);
    return json({status:accepted?"callback_accepted":"callback_rejected",eventId,http:result.status},accepted?200:502);
  } catch {
    console.info("PSC_D_PROBE_DELIVERY transport_failed");
    return json({status:"transport_failed"},502);
  }
}
async function sendBoundChallenge(req) {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supplied = req.headers.get("authorization") ?? "";
  if (req.method !== "POST" || !key ||
      !timingSafeEqual(createHash("sha256").update(supplied).digest(),createHash("sha256").update("Bearer "+key).digest())) {
    return new Response(null,{status:404});
  }
  const input = await req.json().catch(() => null);
  const receiverTest = new URL(req.url).pathname.endsWith('/send-receiver-test');
  const routeProof = receiverTest || new URL(req.url).pathname.endsWith('/send-route-proof');
  const challengeId = input?.challenge_id;
  if (!routeProof && (typeof challengeId !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(challengeId))) return json({status:"invalid_challenge"},400);
  const rpc = (fn,body) => fetch(base+"/rest/v1/rpc/"+fn,{
    method:"POST",redirect:"error",signal:AbortSignal.timeout(5000),
    headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"},
    body:JSON.stringify(body)
  });
  try {
    if (routeProof) {
      let subscription = input?.subscription_id;
      const runtime = input?.runtime_id;
      if ((!receiverTest && (typeof subscription !== "string" || !/^sub_[a-f0-9]{64}$/.test(subscription))) ||
          typeof runtime !== "string" || !/^[0-9a-f-]{36}$/.test(runtime)) return json({status:"invalid_route"},400);
      const proof = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
      const testId = randomUUID();
      const proofHash = createHash("sha256").update(proof).digest("hex");
      const prepared = receiverTest
        ? await rpc("pcc_prepare_receiver_test_v1",{p_runtime_id:runtime,p_proof_sha256:proofHash,p_test_id:testId})
        : await rpc("pcc_prepare_callback_route_proof_v1",{p_subscription_id:subscription,p_runtime_id:runtime,p_proof_sha256:proofHash});
      if (!prepared.ok) return json({status:receiverTest?"verified_route_unavailable_or_test_pending":"route_proof_prepare_failed"},409);
      const route = await prepared.json();
      const config = receiverTest ? route.config : route;
      if (receiverTest) subscription = route.subscription_id;
      const eventId = "evt_"+testId;
      const result = await signedCallback(callbackTarget(config.url),Buffer.from(config.secret.slice(6),"base64"),subscription,eventId,
        {eventId,name:eventName,timestamp:new Date().toISOString(),data:{route_proof:proof},cursor:null});
      const accepted=result.status>=200&&result.status<300;
      return json({status:accepted?"route_proof_callback_accepted":"callback_rejected",eventId,http:result.status},accepted?200:502);
    }
    const prepared = await rpc("pcc_prepare_verified_challenge_callback_v1",{p_challenge_id:challengeId});
    if (!prepared.ok) {
      const failure = await prepared.json().catch(() => null);
      const known = ["VERIFIED_CALLBACK_ROUTE_REQUIRED","PENDING_CHALLENGE_REQUIRED","CURRENT_CHALLENGE_REQUIRED"];
      return json({status:known.includes(failure?.message)?failure.message:"prepare_failed"},409);
    }
    const data = await prepared.json();
    const config = data.callback_config;
    const eventId = "evt_"+data.event_id;
    const result = await signedCallback(callbackTarget(config.url),Buffer.from(config.secret.slice(6),"base64"),
      data.subscription_id,eventId,{eventId,name:eventName,timestamp:new Date().toISOString(),data:{challenge_id:challengeId},cursor:null});
    if (result.status<200 || result.status>=300) return json({status:"callback_rejected",eventId,http:result.status},502);
    const recorded = await rpc("pcc_record_challenge_callback_acceptance_v1",{p_challenge_id:challengeId,p_event_id:data.event_id});
    if (!recorded.ok || await recorded.json() !== true) return json({status:"callback_acceptance_record_failed",eventId},502);
    return json({status:"callback_accepted",eventId});
  } catch {
    return json({status:"challenge_transport_failed"},502);
  }
}
Deno.serve(async (req) => {
  if (["/send-challenge","/send-route-proof","/send-receiver-test"].some(path=>new URL(req.url).pathname.endsWith(path))) return await sendBoundChallenge(req);
  if (new URL(req.url).pathname.endsWith("/send-once")) return await sendSingleProbe(req);
  if (new URL(req.url).pathname.endsWith("/.well-known/oauth-protected-resource")) {
    return json({resource: endpoint + "/mcp", authorization_servers: [base + "/auth/v1"],
      scopes_supported: scopes, bearer_methods_supported: ["header"]});
  }
  if (req.method === "GET") {
    if (!await isNewMason(req)) return unauthorized();
    if (!req.headers.get("accept")?.includes("text/event-stream")) {
      return new Response(null, { status: 406 });
    }
    console.info("PSC_D_SYNTHETIC_AUTHENTICATED_LISTENER_OPENED", {
      session_header_present: req.headers.has("mcp-session-id")
    });
    const encoder = new TextEncoder();
    const probeId = crypto.randomUUID();
    let timer;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(": PCC synthetic signal probe\n\n"));
        timer = setTimeout(() => {
          const message = { jsonrpc: "2.0", method: "notifications/message",
            params: { level: "info", logger: "pcc-stream-probe",
              data: { probe_id: probeId, synthetic: true } } };
          controller.enqueue(encoder.encode("event: message\ndata: " + JSON.stringify(message) + "\n\n"));
          console.info("PSC_D_SYNTHETIC_SIGNAL_EMITTED");
          controller.close();
        }, 3000);
      },
      cancel() { clearTimeout(timer); }
    });
    return new Response(stream, { headers: {
      "Content-Type": "text/event-stream", "Cache-Control": "no-store"
    } });
  }
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
  let request;
  try { request = await req.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON" } }, 400); }
  if (request?.method === "notifications/initialized") return new Response(null, { status: 202 });
  const id = request?.id ?? null;
  if (request?.method === "initialize") {
    console.info(Object.hasOwn(request.params?.capabilities ?? {}, "sampling")
      ? "PSC_D_PROBE_SAMPLING_ADVERTISED" : "PSC_D_PROBE_SAMPLING_NOT_ADVERTISED");

    const requested = request.params?.protocolVersion;
    return Response.json({ jsonrpc: "2.0", id, result: {
      protocolVersion: versions.includes(requested) ? requested : versions[1],
      capabilities: { logging: {}, tools: {}, events: {} },
      serverInfo: { name: "pcc-stream-signal-probe", version: "1.1.0" }
    } }, { headers: { "Mcp-Session-Id": crypto.randomUUID(), "Cache-Control": "no-store" } });
  }
  if (request?.method === "events/list") {
    if (!await isNewMason(req)) return unauthorized();
    console.info("PSC_D_SYNTHETIC_EVENTS_CATALOG_READ");
    return json({ jsonrpc: "2.0", id, result: { events: [{
      name: "pcc.probe.signal",
      description: "Synthetic PCC signal for a one-event delivery test in the subscribed Communications chat.",
      delivery: ["webhook"],
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      payloadSchema: {
        type: "object",
        properties: { marker: { type: "string", const: "PCC_PROBE_OK" }, run_token: {type:"string",pattern:"^[a-f0-9]{64}$"} },
        required: ["marker"], additionalProperties: false
      }
    }] } });
  }
  if (request?.method === "events/subscribe" || request?.method === "events/unsubscribe") {
    return await subscriptionRequest(req,request,id);
  }
  if (request?.method === "tools/list") return json({ jsonrpc: "2.0", id, result: { tools: [{
    name: "psc_d_probe_status", description: "Check authenticated access to the synthetic PSC-D signal probe.",
    inputSchema: {type: "object", properties: {}, additionalProperties: false},
    securitySchemes: [{type: "oauth2", scopes}], annotations: {readOnlyHint: true}
  },{
    name: "psc_d_probe_link_child",
    description: "Redeem the one-time synthetic event token and record this chat as a child of its PCC parent stream.",
    inputSchema: {type:"object",properties:{run_token:{type:"string",pattern:"^[a-f0-9]{64}$"}},required:["run_token"],additionalProperties:false},
    securitySchemes: [{type:"oauth2",scopes}], annotations:{readOnlyHint:false,idempotentHint:true}
  }] } });
  if (request?.method === "tools/call" && request.params?.name === "psc_d_probe_link_child") {
    if (!await isNewMason(req)) return unauthorized();
    const session = request.params?._meta?.["openai/session"];
    const token = request.params?.arguments?.run_token;
    const reply = (value, isError=false) => json({jsonrpc:"2.0",id,result:{content:[{type:"text",text:JSON.stringify(value)}],isError}});
    if (typeof session !== "string" || !session.length || session.length > 512 ||
        typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return reply({status:"TOKEN_OR_CHAT_CORRELATION_MISSING"},true);
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!key) return reply({status:"STORAGE_UNAVAILABLE"},true);
    try {
      const res = await fetch(base+"/rest/v1/rpc/pcc_signal_probe_link_child_v1",{
        method:"POST",redirect:"error",signal:AbortSignal.timeout(4000),
        headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"},
        body:JSON.stringify({
          p_token_hash:createHash("sha256").update(token).digest("hex"),
          p_fingerprint:createHash("sha256").update(session).digest("hex")
        })
      });
      if (!res.ok) return reply({status:"STORAGE_UNAVAILABLE"},true);
      const receipt = await res.json();
      return receipt ? reply({status:"CHILD_LINKED",receipt}) : reply({status:"RUN_TOKEN_REJECTED"},true);
    } catch { return reply({status:"STORAGE_UNAVAILABLE"},true); }
  }
  if (request?.method === "tools/call" && request.params?.name === "psc_d_probe_status") {
    if (!await isNewMason(req)) return unauthorized();
    return json({jsonrpc: "2.0", id, result: {content: [{type: "text", text: "AUTHENTICATED_SYNTHETIC_PROBE_READY"}]}});
  }
  if (request?.method === "ping" || request?.method === "logging/setLevel") return json({ jsonrpc: "2.0", id, result: {} });
  return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
});
