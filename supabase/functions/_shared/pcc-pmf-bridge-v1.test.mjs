import test from "node:test";
import assert from "node:assert/strict";
import { postHeldAnimationHandoff, readLatestRunPodAvailabilitySnapshot, readPmfAnimationProductionReadiness, readRunPodAnimationConnection, requestPmfAnimationReviewUrl, requestPmfPhanimationBatchPreparation, registerPmfPhanimationEpisodeSourceReferences, resolveVerifiedAnimationPolicySource, searchRunPodGpuAvailability } from "./pcc-pmf-bridge-v1.mjs";

const secret = "0123456789abcdef0123456789abcdef";
const policy = {
  policy_id: "123e4567-e89b-42d3-a456-426614174001",
  channel_key: "phnx_kids", output_type: "SERIES_EPISODE", production_intent: "NARRATIVE",
  policy_revision: "r1", approval_psc_id: "PSC-CHANNEL-001",
  boas_id: "BOAS-PHXN-KIDS", boas_revision: "v1", boas_psc_id: "PSC-BOAS-001",
  knoas_id: "KNOAS-PHXN-KIDS", knoas_revision: "v1", knoas_psc_id: "PSC-KNOAS-001",
  channel_profile: { audience: "8-10" }, output_spec: { minimum_segments: 1 },
};
const verification = {
  status: "VERIFIED", channel_key: policy.channel_key, output_type: policy.output_type,
  production_intent: policy.production_intent, policy_id: policy.policy_id,
  policy_revision: policy.policy_revision, approval_psc_id: policy.approval_psc_id,
  boas_id: policy.boas_id, boas_revision: policy.boas_revision, boas_psc_id: policy.boas_psc_id,
  knoas_id: policy.knoas_id, knoas_revision: policy.knoas_revision, knoas_psc_id: policy.knoas_psc_id,
  evidence_psc_ids: [policy.approval_psc_id, policy.boas_psc_id, policy.knoas_psc_id],
  registry_state: "ACTIVE",
};
const packet = {
  state: "HELD_PMF_ADMISSION_REQUIRED",
  admission_snapshot: { render_dispatch: "DISABLED" },
};

test("sends a signed source-resolution request and accepts only exact verified provenance", async () => {
  let sent;
  const result = await resolveVerifiedAnimationPolicySource({
    url: "https://systems.example/functions/v1/pcc-animation-bridge-v1",
    secret, policy, now: 1793222400000, nonce: "11111111-1111-4111-8111-111111111111",
    fetchImpl: async (url, options) => {
      sent = { url, options };
      return new Response(JSON.stringify({ ok: true, protocol: "pcc-pmf-animation-bridge/v1", verification }), { status: 200 });
    },
  });
  assert.deepEqual(result, verification);
  assert.equal(JSON.parse(sent.options.body).action, "RESOLVE_POLICY");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signature = Uint8Array.from(sent.options.headers["x-pcc-bridge-signature"].match(/.{2}/g), byte => parseInt(byte, 16));
  assert.equal(await crypto.subtle.verify("HMAC", key, signature,
    new TextEncoder().encode(`${sent.options.headers["x-pcc-bridge-timestamp"]}\n${sent.options.headers["x-pcc-bridge-nonce"]}\n${sent.options.body}`)), true);
});

test("rejects missing, failed, or mismatched source evidence", async () => {
  await assert.rejects(resolveVerifiedAnimationPolicySource({
    url: "https://systems.example/bridge", secret, policy,
    fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: "ANIMATION_POLICY_SOURCE_NOT_VERIFIED" }), { status: 409 }),
  }), /ANIMATION_POLICY_SOURCE_NOT_VERIFIED/);
  await assert.rejects(resolveVerifiedAnimationPolicySource({
    url: "https://systems.example/bridge", secret, policy,
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, protocol: "pcc-pmf-animation-bridge/v1", verification: { ...verification, channel_key: "rpe" } }), { status: 200 }),
  }), /ANIMATION_POLICY_SOURCE_RESPONSE_BINDING_MISMATCH/);
});

test("rejects non-HTTPS endpoints, incomplete policy, and bad bridge configuration", async () => {
  await assert.rejects(resolveVerifiedAnimationPolicySource({ url: "http://systems.example/bridge", secret, policy }), /HTTPS_REQUIRED/);
  await assert.rejects(resolveVerifiedAnimationPolicySource({ url: "https://systems.example/bridge", secret, policy: {} }), /INPUT_INVALID/);
  await assert.rejects(resolveVerifiedAnimationPolicySource({ url: "https://systems.example/bridge", secret: "short", policy }), /CONFIGURATION_INVALID/);
});

test("sends a signed held-intake envelope and accepts only PMF held receipt", async () => {
  let sent;
  const receipt = {
    request_id: "123e4567-e89b-42d3-a456-426614174000",
    state: "HELD_PMF_ADMISSION_REQUIRED", render_dispatch: "DISABLED", cep_enqueue: "DISABLED",
  };
  const output = await postHeldAnimationHandoff({
    url: "https://systems.example/functions/v1/pcc-animation-bridge-v1",
    secret, packet, now: 1793222400000, nonce: "11111111-1111-4111-8111-111111111111",
    fetchImpl: async (url, options) => {
      sent = { url, options };
      return new Response(JSON.stringify({ ok: true, receipt }), { status: 202 });
    },
  });
  assert.deepEqual(output, receipt);
  assert.equal(sent.url, "https://systems.example/functions/v1/pcc-animation-bridge-v1");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signature = Uint8Array.from(sent.options.headers["x-pcc-bridge-signature"].match(/.{2}/g), byte => parseInt(byte, 16));
  assert.equal(await crypto.subtle.verify("HMAC", key, signature,
    new TextEncoder().encode(`${sent.options.headers["x-pcc-bridge-timestamp"]}\n${sent.options.headers["x-pcc-bridge-nonce"]}\n${sent.options.body}`)), true);
});

test("rejects attempts to bypass the PMF hold or accepts a non-held receipt", async () => {
  await assert.rejects(postHeldAnimationHandoff({ url: "http://systems.example/bridge", secret, packet }), /HTTPS_REQUIRED/);
  await assert.rejects(postHeldAnimationHandoff({ url: "https://systems.example/bridge", secret, packet: { ...packet, state: "READY" } }), /MUST_REMAIN_HELD/);
  await assert.rejects(postHeldAnimationHandoff({
    url: "https://systems.example/bridge", secret, packet,
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, receipt: { state: "READY", render_dispatch: "ENABLED" } }), { status: 200 }),
  }), /HELD_INTAKE_FAILED/);
});

test("requests Systems Phanimation source preparation only by signed PCC and job identifiers", async () => {
  let sent;
  const requestId = "123e4567-e89b-42d3-a456-426614174099";
  const output = await requestPmfPhanimationBatchPreparation({
    url: "https://systems.example/functions/v1/pcc-animation-bridge-v1",
    secret, requestId, pccJobId: requestId,
    now: 1_800_000_000_000, nonce: "123e4567-e89b-42d3-a456-426614174088",
    fetchImpl: async (url, init) => {
      sent = { url, init };
      return new Response(JSON.stringify({
        ok: true, protocol: "pcc-pmf-animation-bridge/v1", action: "REQUEST_PHANIMATION_BATCH_PREPARATION",
        preparation: { state: "QUEUED", pcc_request_id: requestId, pcc_job_id: requestId, render_dispatch: "DISABLED" },
        render_dispatch: "DISABLED", gpu_search_performed: false, gpu_launch_performed: false,
      }), { status: 200 });
    },
  });
  assert.deepEqual(output, { state: "QUEUED", pcc_request_id: requestId, pcc_job_id: requestId, render_dispatch: "DISABLED" });
  assert.deepEqual(JSON.parse(sent.init.body), {
    protocol: "pcc-pmf-animation-bridge/v1", action: "REQUEST_PHANIMATION_BATCH_PREPARATION",
    payload: { request_id: requestId, pcc_job_id: requestId },
  });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signature = Uint8Array.from(sent.init.headers["x-pcc-bridge-signature"].match(/.{2}/g), byte => parseInt(byte, 16));
  assert.equal(await crypto.subtle.verify("HMAC", key, signature,
    new TextEncoder().encode(`${sent.init.headers["x-pcc-bridge-timestamp"]}\n${sent.init.headers["x-pcc-bridge-nonce"]}\n${sent.init.body}`)), true);
});

test("surfaces missing Phanimation source references and rejects any preparation dispatch", async () => {
  const requestId = "123e4567-e89b-42d3-a456-426614174099";
  const base = { url: "https://systems.example/bridge", secret, requestId, pccJobId: requestId };
  await assert.rejects(requestPmfPhanimationBatchPreparation({ ...base,
    fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: "PMF_EPISODE_BATCH_SOURCE_REFERENCES_NOT_FOUND" }), { status: 409 }),
  }), /PMF_EPISODE_BATCH_SOURCE_REFERENCES_NOT_FOUND/);
  await assert.rejects(requestPmfPhanimationBatchPreparation({ ...base,
    fetchImpl: async () => new Response(JSON.stringify({
      ok: true, protocol: "pcc-pmf-animation-bridge/v1", action: "REQUEST_PHANIMATION_BATCH_PREPARATION",
      preparation: { state: "QUEUED", pcc_request_id: requestId, pcc_job_id: requestId, render_dispatch: "ENABLED" },
      render_dispatch: "ENABLED", gpu_search_performed: true, gpu_launch_performed: false,
    }), { status: 200 }),
  }), /PMF_PHANIMATION_PREPARATION_RESPONSE_INVALID/);
  await assert.rejects(requestPmfPhanimationBatchPreparation({ ...base,
    pccJobId: "123e4567-e89b-42d3-a456-426614174098", fetchImpl: async () => { throw new Error("must not call"); },
  }), /PMF_PHANIMATION_PREPARATION_REQUEST_INVALID/);
});


const blockedReadiness = {
  state: "PRODUCTION_BLOCKED",
  production_enabled: false,
  render_dispatch: "DISABLED",
  failures: ["PMF_AUDIT_NOT_ADMITTED", "PMF_VERSION_NOT_CERTIFIED"],
  evidence: null,
};

test("production readiness uses signed read-only action and returns PMF block", async () => {
  let request;
  const result = await readPmfAnimationProductionReadiness({
    url: "https://systems.example/functions/v1/bridge",
    secret,
    now: 1_700_000_000_000,
    nonce: "123e4567-e89b-42d3-a456-426614174099",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({
        ok: true,
        protocol: "pcc-pmf-animation-bridge/v1",
        action: "PRODUCTION_READINESS",
        readiness: blockedReadiness,
        contract: { version: "0.3.0" },
      }), { status: 200 });
    },
  });
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers["x-pcc-bridge-signature"].length, 64);
  assert.deepEqual(JSON.parse(request.init.body), {
    protocol: "pcc-pmf-animation-bridge/v1",
    action: "PRODUCTION_READINESS",
  });
  assert.equal(result.readiness.state, "PRODUCTION_BLOCKED");
  assert.equal(result.readiness.render_dispatch, "DISABLED");
});

test("production readiness rejects malformed, admitted-but-disabled and failed bridge results", async () => {
  const base = {
    url: "https://systems.example/bridge", secret,
    now: 1_700_000_000_000,
    nonce: "123e4567-e89b-42d3-a456-426614174098",
  };
  await assert.rejects(() => readPmfAnimationProductionReadiness({
    ...base, fetchImpl: async () => new Response("{}", { status: 503 }),
  }), /PMF_ADMISSION_RESPONSE_INVALID/);
  await assert.rejects(() => readPmfAnimationProductionReadiness({
    ...base, fetchImpl: async () => new Response(JSON.stringify({
      ok: true, protocol: "pcc-pmf-animation-bridge/v1", action: "PRODUCTION_READINESS",
      readiness: { state: "PRODUCTION_ADMITTED", production_enabled: true, render_dispatch: "DISABLED" },
    }), { status: 200 }),
  }), /PMF_ADMISSION_RESPONSE_INVALID/);
  await assert.rejects(() => readPmfAnimationProductionReadiness({
    ...base, url: "http://systems.example/bridge",
  }), /PMF_BRIDGE_HTTPS_REQUIRED/);
});


const reviewIds = {
  pccRequestId: "123e4567-e89b-42d3-a456-426614174000",
  executionId: "123e4567-e89b-42d3-a456-426614174001",
  resultReceiptId: "123e4567-e89b-42d3-a456-426614174001",
  artifactSha256: "a".repeat(64),
};
test("requests only an exact private review video using a signed PCC bridge call", async () => {
  let sent;
  const now = 1_800_000_000_000;
  const output = await requestPmfAnimationReviewUrl({
    url: "https://systems.example/functions/v1/pcc-animation-bridge-v1",
    secret, ...reviewIds, now, nonce: "123e4567-e89b-42d3-a456-426614174099",
    fetchImpl: async (url, init) => {
      sent = { url, init };
      return new Response(JSON.stringify({
        ok: true, protocol: "pcc-pmf-animation-bridge/v1", action: "CREATE_RENDER_REVIEW_URL",
        state: "REVIEW_REQUIRED", pcc_request_id: reviewIds.pccRequestId,
        execution_id: reviewIds.executionId, result_receipt_id: reviewIds.resultReceiptId,
        sha256: reviewIds.artifactSha256, mime_type: "video/mp4",
        signed_url: "https://systems.example/storage/v1/object/sign/pmf-animation-private/"
          +reviewIds.executionId+"/scene.mp4?token=short",
        expires_at: new Date(now + 90_000).toISOString(),
      }), { status: 200 });
    },
  });
  assert.equal(JSON.parse(sent.init.body).action, "CREATE_RENDER_REVIEW_URL");
  assert.equal(sent.init.headers["x-pcc-bridge-signature"].length, 64);
  assert.equal(output.state, "REVIEW_REQUIRED");
  assert.equal(output.signed_url.includes("token=short"), true);
});
test("rejects wrong target, wrong origin, or long-lived review URLs", async () => {
  const base={url:"https://systems.example/bridge",secret,...reviewIds,now:1_800_000_000_000};
  await assert.rejects(requestPmfAnimationReviewUrl({...base,resultReceiptId:"other",
    fetchImpl:async()=>{throw new Error("must not call");}}),/PMF_REVIEW_REQUEST_INVALID/);
  const result={
    ok:true,protocol:"pcc-pmf-animation-bridge/v1",action:"CREATE_RENDER_REVIEW_URL",
    state:"REVIEW_REQUIRED",pcc_request_id:reviewIds.pccRequestId,execution_id:reviewIds.executionId,
    result_receipt_id:reviewIds.resultReceiptId,sha256:reviewIds.artifactSha256,mime_type:"video/mp4",
    signed_url:"https://attacker.example/storage/v1/object/sign/pmf-animation-private/"+reviewIds.executionId+"/scene.mp4?token=x",
    expires_at:new Date(base.now+90_000).toISOString()
  };
  await assert.rejects(requestPmfAnimationReviewUrl({...base,fetchImpl:async()=>new Response(JSON.stringify(result),{status:200})}),/PMF_REVIEW_URL_RESPONSE_INVALID/);
  await assert.rejects(requestPmfAnimationReviewUrl({...base,fetchImpl:async()=>new Response(JSON.stringify({...result,signed_url:result.signed_url.replace("attacker.example","systems.example"),expires_at:new Date(base.now+300_000).toISOString()}),{status:200})}),/PMF_REVIEW_URL_RESPONSE_INVALID/);
});


test("RunPod status sends a signed read-only request and preserves stopped-versus-ready distinction", async () => {
  let sent;
  const connection = {
    state: "POD_STOPPED", control_plane: "CONNECTED", worker_api: "NOT_REACHABLE",
    render_ready: false, pod_status: "STOPPED", cost_per_hour_usd: 0.72,
  };
  const result = await readRunPodAnimationConnection({
    url: "https://systems.example/functions/v1/bridge", secret,
    now: 1_800_000_000_000, nonce: "123e4567-e89b-42d3-a456-426614174097",
    fetchImpl: async (url, init) => {
      sent = {url, init};
      return new Response(JSON.stringify({
        ok: true, protocol: "pcc-pmf-animation-bridge/v1",
        action: "RUNPOD_CONNECTION_STATUS", connection,
      }), {status: 200});
    },
  });
  assert.equal(sent.init.method, "POST");
  assert.equal(JSON.parse(sent.init.body).action, "RUNPOD_CONNECTION_STATUS");
  assert.equal(sent.init.headers["x-pcc-bridge-signature"].length, 64);
  assert.deepEqual(result, connection);
  assert.equal(result.render_ready, false);
});

test("RunPod connection accepts Systems' selected-candidate response and strips private volume identifiers", async () => {
  const candidate = {
    gpu_id: "NVIDIA RTX A6000", gpu_name: "RTX A6000", vram_gb: 48,
    cloud_tier: "COMMUNITY", hourly_rate_usd: 0.72, availability: "MEDIUM",
    data_center_id: "US-KS-2", storage_gb: 50, storage_volume_id: "private-volume-id",
    storage_match: "EXISTING_NETWORK_VOLUME",
    availability_scope: "GPU_AND_DATACENTER_AGGREGATE_CLOUD_TIER_NOT_GUARANTEED",
    availability_snapshot_at: new Date(1_800_000_000_000).toISOString(),
    availability_guaranteed: false,
  };
  const result = await readRunPodAnimationConnection({
    url: "https://systems.example/bridge", secret,
    now: 1_800_000_000_000, nonce: "123e4567-e89b-42d3-a456-426614174095",
    fetchImpl: async () => new Response(JSON.stringify({
      ok: true, protocol: "pcc-pmf-animation-bridge/v1", action: "RUNPOD_CONNECTION_STATUS",
      connection: {
        state: "API_CONNECTED", control_plane: "CONNECTED", worker_api: "NOT_CHECKED",
        render_ready: false, gpu_count: 1, worker_port: 8765, max_hourly_usd: 0.8,
        dispatch: "READ_ONLY_NO_RESERVATION_NO_START",
        inventory: {
          state: "CANDIDATE_SELECTED", hard_max_hourly_usd: 0.8, applied_max_hourly_usd: 0.8,
          required_storage_gb: 50, availability_guaranteed: false, candidate_count: 1,
          selected_candidate: candidate, candidates: [candidate],
        },
      },
    }), {status: 200}),
  });
  assert.equal(result.state, "API_CONNECTED");
  assert.equal(result.inventory.state, "CANDIDATE_SELECTED");
  assert.equal(result.inventory.selected_candidate.gpu_name, "RTX A6000");
  assert.equal("storage_volume_id" in result.inventory.selected_candidate, false);
});

test("RunPod status rejects contradictory or unsafe bridge responses", async () => {
  const base = {
    url: "https://systems.example/bridge", secret,
    now: 1_800_000_000_000, nonce: "123e4567-e89b-42d3-a456-426614174096",
  };
  await assert.rejects(readRunPodAnimationConnection({
    ...base,
    fetchImpl: async () => new Response(JSON.stringify({
      ok: true, protocol: "pcc-pmf-animation-bridge/v1", action: "RUNPOD_CONNECTION_STATUS",
      connection: {state:"WORKER_READY",control_plane:"CONNECTED",worker_api:"REACHABLE",render_ready:false},
    }), {status:200}),
  }), /RUNPOD_CONNECTION_RESPONSE_INVALID/);
  await assert.rejects(readRunPodAnimationConnection({
    ...base, url: "http://systems.example/bridge",
  }), /PMF_BRIDGE_HTTPS_REQUIRED/);
});


test("RunPod availability search accepts only signed in-budget offers with 50GB colocated storage", async () => {
  let sent;
  const now=1_800_000_000_000;
  const candidate={
    gpu_id:"NVIDIA RTX A6000",gpu_name:"RTX A6000",vram_gb:48,cloud_tier:"COMMUNITY",
    hourly_rate_usd:0.72,availability:"MEDIUM",data_center_id:"US-KS-2",
    storage_gb:50,storage_volume_id:"vol-1",estimated_pod_hourly_usd:0.76,storage_match:"EXISTING_NETWORK_VOLUME",availability_scope:"GPU_AND_DATACENTER_AGGREGATE_CLOUD_TIER_NOT_GUARANTEED",
    availability_snapshot_at:new Date(now).toISOString(),availability_guaranteed:false,
  };
  const out=await searchRunPodGpuAvailability({
    url:"https://systems.example/functions/v1/bridge",secret,scheduled:true,now,
    nonce:"123e4567-e89b-42d3-a456-426614174098",
    fetchImpl:async(url,init)=>{
      sent={url,init};
      return new Response(JSON.stringify({
        ok:true,protocol:"pcc-pmf-animation-bridge/v1",action:"SEARCH_RUNPOD_AVAILABILITY",
        dispatch:"READ_ONLY_NO_RESERVATION_NO_START",
        schedule:{state:"SCHEDULED_WINDOW_CHECK",search_window:{start_local:"00:00",end_local:"06:00",time_zone:"America/Chicago"}},
        inventory:{state:"CANDIDATE_SELECTED",hard_max_hourly_usd:0.8,applied_max_hourly_usd:0.8,
          required_storage_gb:50,candidate_count:1,selected_candidate:candidate,candidates:[candidate],warnings:[],
          snapshot_at:new Date(now).toISOString(),availability_guaranteed:false,
          dispatch:"READ_ONLY_NO_RESERVATION_NO_START"},
      }),{status:200});
    },
  });
  assert.equal(JSON.parse(sent.init.body).action,"SEARCH_RUNPOD_AVAILABILITY");
  assert.equal(JSON.parse(sent.init.body).payload.scheduled,true);
  assert.equal(out.inventory.candidates[0].hourly_rate_usd,0.72);
  assert.equal(out.inventory.selected_candidate.gpu_name,"RTX A6000");
  assert.equal("storage_volume_id" in out.inventory.selected_candidate,false);
  assert.equal(out.dispatch,"READ_ONLY_NO_RESERVATION_NO_START");
});

test("RunPod availability bridge rejects an over-budget candidate using the canonical selected-candidate shape", async () => {
 const candidate={gpu_id:"gpu",gpu_name:"GPU",cloud_tier:"SECURE",hourly_rate_usd:0.81,
   estimated_pod_hourly_usd:0.81,data_center_id:"US-KS-2",storage_gb:50,
   storage_match:"EXISTING_NETWORK_VOLUME",availability_scope:"GPU_AND_DATACENTER_AGGREGATE_CLOUD_TIER_NOT_GUARANTEED",
   availability_guaranteed:false};
 const base={url:"https://systems.example/bridge",secret,fetchImpl:async()=>new Response(JSON.stringify({
  ok:true,protocol:"pcc-pmf-animation-bridge/v1",action:"SEARCH_RUNPOD_AVAILABILITY",
  dispatch:"READ_ONLY_NO_RESERVATION_NO_START",inventory:{
   state:"CANDIDATE_SELECTED",hard_max_hourly_usd:0.8,applied_max_hourly_usd:0.8,required_storage_gb:50,
   candidate_count:1,selected_candidate:candidate,candidates:[candidate],
  },
 }),{status:200})};
 await assert.rejects(searchRunPodGpuAvailability(base),/RUNPOD_AVAILABILITY_RESPONSE_INVALID/);
});

test("RunPod scheduled search returns outside-window without inventing candidates",async()=>{
 const out=await searchRunPodGpuAvailability({
  url:"https://systems.example/bridge",secret,scheduled:true,
  fetchImpl:async()=>new Response(JSON.stringify({ok:true,action:"SEARCH_RUNPOD_AVAILABILITY",
   dispatch:"READ_ONLY_NO_RESERVATION_NO_START",state:"OUTSIDE_SEARCH_WINDOW",
   search_window:{start_local:"00:00",end_local:"06:00",time_zone:"America/Chicago"}}),{status:200}),
 });
 assert.equal(out.state,"OUTSIDE_SEARCH_WINDOW");
 assert.equal(out.inventory,null);
});

test("latest RunPod snapshot validates the canonical selected-candidate response", async () => {
  const now=1793308800000;
  let sent;
  const candidate={gpu_id:"gpu-1",gpu_name:"A6000",vram_gb:48,cloud_tier:"SECURE",
    hourly_rate_usd:0.72,availability:"HIGH",data_center_id:"US-KS-2",storage_gb:50,
    storage_match:"EXISTING_NETWORK_VOLUME",
    availability_scope:"GPU_AND_DATACENTER_AGGREGATE_CLOUD_TIER_NOT_GUARANTEED",
    availability_guaranteed:false,storage_volume_id:"private-volume-id"};
  const snapshot={
    ok:true,protocol:"pcc-pmf-animation-bridge/v1",action:"READ_RUNPOD_AVAILABILITY_SNAPSHOT",
    state:"SNAPSHOT_FOUND",snapshot_id:"123e4567-e89b-42d3-a456-426614174099",
    snapshot_at:new Date(now-60_000).toISOString(),
    search_window:{start_local:"00:00",end_local:"06:00",time_zone:"America/Chicago"},
    limits:{max_hourly_usd:0.8,required_storage_gb:50},availability_guaranteed:false,
    dispatch:"READ_ONLY_NO_RESERVATION_NO_START",
    inventory:{state:"CANDIDATE_SELECTED",hard_max_hourly_usd:0.8,applied_max_hourly_usd:0.8,
      required_storage_gb:50,candidate_count:1,warnings:[],availability_guaranteed:false,
      selected_candidate:candidate,candidates:[candidate]},
  };
  const out=await readLatestRunPodAvailabilitySnapshot({
    url:"https://systems.example/functions/v1/pcc-animation-bridge-v1",secret,now,
    nonce:"123e4567-e89b-42d3-a456-426614174098",
    fetchImpl:async(url,init)=>{sent={url,init};return new Response(JSON.stringify(snapshot),{status:200});},
  });
  assert.equal(JSON.parse(sent.init.body).action,"READ_RUNPOD_AVAILABILITY_SNAPSHOT");
  assert.equal(out.inventory.candidates[0].hourly_rate_usd,0.72);
  assert.equal(out.inventory.candidates[0].storage_volume_id,undefined);
  assert.equal(out.dispatch,"READ_ONLY_NO_RESERVATION_NO_START");
});

test("latest RunPod snapshot fails closed for stale data or candidates outside approved limits", async () => {
  const now=1793308800000;
  const base={ok:true,protocol:"pcc-pmf-animation-bridge/v1",action:"READ_RUNPOD_AVAILABILITY_SNAPSHOT",
    state:"SNAPSHOT_FOUND",snapshot_id:"123e4567-e89b-42d3-a456-426614174099",
    snapshot_at:new Date(now-49*60*60*1000).toISOString(),
    search_window:{start_local:"00:00",end_local:"06:00",time_zone:"America/Chicago"},
    limits:{max_hourly_usd:0.8,required_storage_gb:50},availability_guaranteed:false,
    dispatch:"READ_ONLY_NO_RESERVATION_NO_START",
    inventory:{state:"CANDIDATE_SELECTED",hard_max_hourly_usd:0.8,applied_max_hourly_usd:0.8,
      required_storage_gb:50,candidate_count:1,warnings:[],availability_guaranteed:false,
      selected_candidate:{gpu_id:"gpu-1",gpu_name:"A6000",vram_gb:48,cloud_tier:"SECURE",hourly_rate_usd:0.72,data_center_id:"US-KS-2"},
      candidates:[{gpu_id:"gpu-1",gpu_name:"A6000",vram_gb:48,cloud_tier:"SECURE",hourly_rate_usd:0.72,
        availability:"HIGH",data_center_id:"US-KS-2",storage_gb:50,storage_match:"EXISTING_NETWORK_VOLUME",
        availability_scope:"GPU_AND_DATACENTER_AGGREGATE_CLOUD_TIER_NOT_GUARANTEED",availability_guaranteed:false}]}};
  const call=async value=>readLatestRunPodAvailabilitySnapshot({url:"https://systems.example/bridge",secret,now,
    fetchImpl:async()=>new Response(JSON.stringify(value),{status:200})});
  await assert.rejects(call(base),/RUNPOD_SNAPSHOT_RESPONSE_INVALID/);
  const fresh={...base,snapshot_at:new Date(now-1000).toISOString(),
    inventory:{...base.inventory,candidates:[{...base.inventory.candidates[0],hourly_rate_usd:0.81}]}};
  await assert.rejects(call(fresh),/RUNPOD_SNAPSHOT_RESPONSE_INVALID/);
});



test("registers Phanimation source pointers over the signed bridge and requires pointer-only receipt", async () => {
  let sent;
  const requestId = "123e4567-e89b-42d3-a456-426614174000";
  const sourceRefs = { production_order: { order_id: "ORDER-1" }, episodes: [{ episode_id: "EP-1" }] };
  const registration = {
    state: "SOURCE_REFERENCES_ONLY", pcc_request_id: requestId, pcc_job_id: requestId,
    pcc_packet_sha256: "a".repeat(64), source_refs_sha256: "b".repeat(64),
    manifest_sha256: "c".repeat(64), episode_count: 1, verified: false,
    requires_server_source_readers: true, render_dispatch: "DISABLED",
    gpu_search_performed: false, gpu_launch_performed: false,
  };
  const result = await registerPmfPhanimationEpisodeSourceReferences({
    url: "https://systems.example/functions/v1/pcc-animation-bridge-v1", secret, requestId, pccJobId: requestId,
    sourceRefs, now: 1793222400000, nonce: "11111111-1111-4111-8111-111111111111",
    fetchImpl: async (url, options) => {
      sent = { url, options };
      return new Response(JSON.stringify({ ok: true, protocol: "pcc-pmf-animation-bridge/v1",
        action: "REGISTER_PHANIMATION_EPISODE_SOURCE_REFERENCES", registration,
        render_dispatch: "DISABLED", gpu_search_performed: false, gpu_launch_performed: false }), { status: 200 });
    },
  });
  assert.deepEqual(result, registration);
  const envelope = JSON.parse(sent.options.body);
  assert.equal(envelope.action, "REGISTER_PHANIMATION_EPISODE_SOURCE_REFERENCES");
  assert.deepEqual(envelope.payload.source_refs, sourceRefs);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signature = Uint8Array.from(sent.options.headers["x-pcc-bridge-signature"].match(/.{2}/g), byte => parseInt(byte, 16));
  assert.equal(await crypto.subtle.verify("HMAC", key, signature,
    new TextEncoder().encode(`${sent.options.headers["x-pcc-bridge-timestamp"]}\n${sent.options.headers["x-pcc-bridge-nonce"]}\n${sent.options.body}`)), true);
});

test("rejects invalid source-reference registration input and any receipt that implies verification", async () => {
  const requestId = "123e4567-e89b-42d3-a456-426614174000";
  const sourceRefs = { production_order: { order_id: "ORDER-1" }, episodes: [{ episode_id: "EP-1" }] };
  await assert.rejects(registerPmfPhanimationEpisodeSourceReferences({
    url: "https://systems.example/bridge", secret, requestId, pccJobId: "different",
    sourceRefs, fetchImpl: async () => { throw new Error("must not call"); },
  }), /REQUEST_INVALID/);
  await assert.rejects(registerPmfPhanimationEpisodeSourceReferences({
    url: "https://systems.example/bridge", secret, requestId, pccJobId: requestId, sourceRefs,
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, protocol: "pcc-pmf-animation-bridge/v1",
      action: "REGISTER_PHANIMATION_EPISODE_SOURCE_REFERENCES",
      registration: { state: "SOURCE_REFERENCES_ONLY", pcc_request_id: requestId, pcc_job_id: requestId,
        pcc_packet_sha256: "a".repeat(64), source_refs_sha256: "b".repeat(64), manifest_sha256: "c".repeat(64),
        episode_count: 1, verified: true, requires_server_source_readers: true, render_dispatch: "DISABLED",
        gpu_search_performed: false, gpu_launch_performed: false },
      render_dispatch: "DISABLED", gpu_search_performed: false, gpu_launch_performed: false }), { status: 200 }),
  }), /RESPONSE_INVALID/);
});
