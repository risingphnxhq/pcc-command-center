# PCC Animation Engine — PCC Control V1

## Built in this branch

PCC now has an Animation Engine entry point, channel-first intake, EFPB Script Writer/Reviewer flow, binary QA, and a role-checked PCC handoff staging action. AD/REEL intake requires explicit MARKETING or NARRATIVE intent; corporate marketing/TV spots resolve to MARKETING and story forms to NARRATIVE. PCC stores an idempotent request, creates the complete script before channel segments, records Reviewer receipts, and persists a visible PCC job-card notice when bounded repairs leave blocking issues; that item is held while other requests remain available. It can stage a canonical handoff packet containing approved BOAS/KNOAS revisions, the script package, and QA receipts. PCC also maintains a channel/output/series inventory notice: a database trigger counts human-quality-approved, still-private, unpublished results and opens a replenishment alert at three or fewer. The notice is visible beside production requests and never publishes or schedules work.

The operator does not supply BOAS or KNOAS identifiers. PCC resolves an immutable, append-only channel policy by exact channel, output format, and production lane. Each policy records approved BOAS/KNOAS revisions and their PSC references. A policy must be registered by an ADMIN-authorized PCC operator; no channel policy is populated by this migration, so scripting fails closed until approved policy is registered. The selected channel is the RPE editorial channel/series; it is not a social publishing account. Social destination and scheduling belong to SPIDER and remain unconnected here.

Each request starts as `WAITING_FOR_SYSTEM_REGISTRATION`. A passed script can be staged by a HANDOFF or ADMIN role; PCC durably stores the packet as `HELD_PMF_ADMISSION_REQUIRED`. When the server bridge settings are configured, PCC sends the packet over a signed HTTPS request to Systems/PMF. PMF validates the approved policy lineage, full script, binary QA, Reviewer pass, and held admission snapshot; it records an idempotent intake receipt and returns it for PCC to save on the job. Both sides keep CEP enqueue, rendering, GPU spend, release, and publishing disabled. If bridge settings are absent, PCC reports `NOT_CONFIGURED` and retains its local held packet.

## Verified integration state

The live Systems registry contains PMF 0.3.0, version-locked to `PMF-FOUNDER-PSC-ANIMATION-V0.3.0-QA-ACCEPTANCE-LOCK-2026-10-27-001` and acceptance revision `PMF-ANIMATION-FINAL-QA-AC-001`. Its registry state is `ACTIVE`, but its audit state is `NOT_ADMITTED` and certification state is `NOT_CERTIFIED`. The registry row is not a production-use authorization: PCC must keep the general PMF runtime, CEP enqueue, rendering, spend, and release disabled until the admission and certification gates pass.

The existing PMF private `/stage` command accepts only an exact trial manifest PSC ID and staged asset payload, and the runtime is restricted to the Angie’s World trial identity. PCC's generic animation package is not that trial manifest and is never sent there.

The PCC request type is the editorial channel/series, separate from a social publishing destination. PCC now has a service-role-only policy registry and exact-match resolver for approved BOAS/KNOAS channel policies. Registration is available only to ADMIN-authorized users and requires PSC lineage. The registry starts empty; approved BOAS/KNOAS references must be registered before script generation can run. Although PMF/PVE/PNG components exist, this branch does not yet transfer staged packets into their production queues or receive job/artifact receipts.

## Request API

POST to `/functions/v1/pcc-animation-control-v1` with the PCC Supabase publishable key and the signed-in operator's Supabase Auth Bearer token.

Create:

```json
{
  "action": "CREATE",
  "payload": {
    "idempotency_key": "unique-key",
    "channel_key": "phnx_kids",
    "output_type": "REEL",
    "production_intent": "NARRATIVE",
    "title": "REEL",
    "idea": "Describe what should be produced.",
    "request_payload": {
      "intake": "PCC_ANIMATION_ENGINE_V1"
    }
  }
}
```

List the caller's latest requests (review/admin sees all):

```json
{ "action": "LIST", "payload": {} }
```

Read a request:

```json
{
  "action": "READ",
  "payload": {
    "job_id": "returned-job-uuid"
  }
}
```

The API validates the caller's Supabase Auth session and reads server-managed `app_metadata.pcc_animation_access` roles: `REQUEST`, `SCRIPT`, `REVIEW`, `HANDOFF`, or `ADMIN`. Staging is limited to HANDOFF/ADMIN. The browser does not receive the service-role key. The PCC table has RLS enabled, direct client grants revoked, and a service-role-only RPC.

## Remaining build gates

1. Register each approved channel/output policy with its BOAS/KNOAS revisions and PSC lineage. The PCC resolver is implemented; populate it from approved source records before enabling script generation.
2. Complete PMF 0.3.0 PCC registration, admission, and certification under the existing BOAS/PSC acceptance contract. Do not change the Angie’s World trial identity into production.
3. Once admitted, add the separately authorized CEP enqueue and PVE voice/script plus PNG request/receipt paths against their registered tables. The current bridge only receipts and holds approved PCC packets.
4. Connect RunPod as on-demand compute only behind admitted PMF jobs, with explicit spend limits and measured cost/quality.
5. Add PCC approval and SPIDER distribution/scheduling handoff separately from render completion.

## One-job RunPod authorization request

The new `ISSUE_RENDER_AUTHORIZATION` action is ADMIN-only. It accepts only a CEP job UUID and sends a signed request to the Systems authorization Edge Function by resolving the endpoint from `PCC_PMF_BRIDGE_URL`. Systems independently re-reads the queued job, current PMF admission/certification, exact Founder one-job PSC, immutable script/manifest lineage, digest-pinned image, and approved runtime/spend policy before issuing a short-lived receipt. The caller cannot supply the policy or receipt. Receipt issuance does not enqueue or launch a Pod; GPU creation remains a separate worker action behind the production gates.

Request shape:

```json
{
  "action": "ISSUE_RENDER_AUTHORIZATION",
  "payload": { "cep_job_id": "<queued-CEP-job-uuid>" }
}
```

This action is available only after the Systems migration and Edge Function have been deployed and a valid Founder authorization PSC exists. The current PMF production registry is not yet admitted/certified, so issuance should fail closed until those gates pass.

## Bridge configuration

PCC Edge Function secrets: `PCC_PMF_BRIDGE_URL` (the Systems function's HTTPS URL), `PCC_PMF_BRIDGE_HMAC_SECRET` (shared server-only secret, at least 32 characters), and `PCC_PMF_BRIDGE_KEY_ID=pcc-animation-v1`. Systems/PMF requires the same HMAC secret and key ID. Never expose the secret to the browser or commit it. Deploy the PCC receipt migration, the Systems intake migration, and the PMF Edge Function before configuring both sides.

## Deployment and validation

This is a draft implementation. No PCC migration, Edge Function, role assignment, worker, or production resource was deployed by this branch. Apply the SQL only to PCC project `ttkceizmjeckrorhkhfr`; `supabase/migrations/` is reserved for the Systems/PMF target in this repository setup. Deploy the function only after the PCC migration and operator-role provisioning are reviewed.

Local Deno, browser, database-migration, and workflow validation were not run because this repository is not mounted in the workspace. This source branch contains no PR and has not been deployed.