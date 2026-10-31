import test from "node:test";
import assert from "node:assert/strict";
import {
  postHeldAnimationHandoff,
  resolveVerifiedAnimationPolicySource,
} from "../supabase/functions/_shared/pcc-pmf-bridge-v1.mjs";

const secret = "synthetic-workload-secret-0123456789abcdef";
const url = "https://systems.example/functions/v1/pcc-animation-bridge-v1";
const fixedTime = 1_798_761_600_000;

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function makePolicy(index) {
  const channel = `synthetic_channel_${index}`;
  return {
    policy_id: uuid(index + 1),
    channel_key: channel,
    output_type: "SERIES_EPISODE",
    production_intent: "NARRATIVE",
    policy_revision: "r1",
    approval_psc_id: `PSC-CHANNEL-${index}`,
    boas_id: `BOAS-${channel}`,
    boas_revision: "v1",
    boas_psc_id: `PSC-BOAS-${index}`,
    knoas_id: `KNOAS-${channel}`,
    knoas_revision: "v1",
    knoas_psc_id: `PSC-KNOAS-${index}`,
    channel_profile: { audience: "8-10" },
    output_spec: { minimum_segments: 1 },
  };
}

function verifiedSource(policy) {
  return {
    status: "VERIFIED",
    channel_key: policy.channel_key,
    output_type: policy.output_type,
    production_intent: policy.production_intent,
    policy_id: policy.policy_id,
    policy_revision: policy.policy_revision,
    approval_psc_id: policy.approval_psc_id,
    boas_id: policy.boas_id,
    boas_revision: policy.boas_revision,
    boas_psc_id: policy.boas_psc_id,
    knoas_id: policy.knoas_id,
    knoas_revision: policy.knoas_revision,
    knoas_psc_id: policy.knoas_psc_id,
    evidence_psc_ids: [policy.approval_psc_id, policy.boas_psc_id, policy.knoas_psc_id],
    registry_state: "ACTIVE",
  };
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

test("synthetic mixed channel workload verifies concurrent sources and blocks unapproved provenance", async () => {
  const workloadSize = 32;
  let active = 0;
  let peak = 0;
  const jobs = Array.from({ length: workloadSize }, (_, index) => {
    const policy = makePolicy(index);
    return resolveVerifiedAnimationPolicySource({
      url, secret, policy, now: fixedTime, nonce: uuid(index + 100),
      fetchImpl: async (_endpoint, init) => {
        active += 1;
        peak = Math.max(peak, active);
        try {
          const request = JSON.parse(init.body);
          assert.equal(request.action, "RESOLVE_POLICY");
          assert.equal(request.policy.policy_id, policy.policy_id);
          await Promise.resolve();
          if (index === 7) {
            return response({
              ok: false,
              protocol: "pcc-pmf-animation-bridge/v1",
              error: "ANIMATION_POLICY_SOURCE_NOT_VERIFIED",
            }, 409);
          }
          return response({
            ok: true,
            protocol: "pcc-pmf-animation-bridge/v1",
            verification: verifiedSource(policy),
          });
        } finally {
          active -= 1;
        }
      },
    }).then(
      value => ({ index, value }),
      error => ({ index, error }),
    );
  });

  const results = await Promise.all(jobs);
  const passed = results.filter(result => result.value);
  const blocked = results.filter(result => result.error);

  assert.equal(results.length, workloadSize);
  assert.equal(passed.length, workloadSize - 1);
  assert.deepEqual(blocked.map(result => result.index), [7]);
  assert.match(blocked[0].error.message, /ANIMATION_POLICY_SOURCE_NOT_VERIFIED/);
  assert.ok(peak > 1, "workload should overlap requests");
  assert.ok(peak <= workloadSize);
  for (const { index, value } of passed) {
    assert.equal(value.channel_key, `synthetic_channel_${index}`);
    assert.deepEqual(value.evidence_psc_ids, [
      `PSC-CHANNEL-${index}`,
      `PSC-BOAS-${index}`,
      `PSC-KNOAS-${index}`,
    ]);
  }
});

test("synthetic handoff retries preserve the same request identity and held receipt", async () => {
  const policy = makePolicy(1);
  const requestId = uuid(500);
  const packet = {
    request_id: requestId,
    channel_key: policy.channel_key,
    state: "HELD_PMF_ADMISSION_REQUIRED",
    admission_snapshot: { render_dispatch: "DISABLED" },
  };
  const observedBodies = [];
  const receipt = {
    request_id: requestId,
    state: "HELD_PMF_ADMISSION_REQUIRED",
    render_dispatch: "DISABLED",
    cep_enqueue: "DISABLED",
  };
  const fetchImpl = async (_endpoint, init) => {
    const request = JSON.parse(init.body);
    observedBodies.push(request);
    return response({ ok: true, receipt }, 202);
  };
  const send = () => postHeldAnimationHandoff({
    url, secret, packet, fetchImpl, now: fixedTime, nonce: uuid(600),
  });

  const first = await send();
  const retry = await send();

  assert.deepEqual(first, receipt);
  assert.deepEqual(retry, receipt);
  assert.equal(observedBodies.length, 2);
  assert.equal(observedBodies[0].action, "INTAKE_HELD");
  assert.equal(observedBodies[0].packet.request_id, requestId);
  assert.deepEqual(observedBodies[1], observedBodies[0]);
  assert.equal(first.render_dispatch, "DISABLED");
  assert.equal(first.cep_enqueue, "DISABLED");
});

test("synthetic malformed or prematurely admitted handoffs stay rejected", async () => {
  const packet = {
    request_id: uuid(700),
    state: "HELD_PMF_ADMISSION_REQUIRED",
    admission_snapshot: { render_dispatch: "DISABLED" },
  };
  await assert.rejects(
    postHeldAnimationHandoff({
      url, secret, packet: { ...packet, state: "READY" },
      fetchImpl: async () => { throw new Error("network should not be reached"); },
    }),
    /MUST_REMAIN_HELD/,
  );
  await assert.rejects(
    postHeldAnimationHandoff({
      url, secret, packet,
      fetchImpl: async () => response({
        ok: true,
        receipt: {
          request_id: packet.request_id,
          state: "READY",
          render_dispatch: "ENABLED",
          cep_enqueue: "ENABLED",
        },
      }),
    }),
    /HELD_INTAKE_FAILED/,
  );
});
