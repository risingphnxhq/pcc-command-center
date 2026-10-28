# PCC Animation Engine — Control Slice V1

## Built in this branch

PCC now has an Animation Engine entry point in the department navigation and a channel-first intake screen. An authorized operator supplies a concept, selects an output format and one of the channel keys currently present in PMF's channel registry, and submits a request to the PCC control API. PCC stores it with an idempotency key and lists the operator's recent requests. Reviewer/admin roles can list all requests.

The operator does not supply BOAS or KNOAS identifiers. Those belong to system policy and must be resolved by PCC from registered channel/system records.

Each request is deliberately stored as `WAITING_FOR_SYSTEM_REGISTRATION` with routing state `PENDING_PCC_REGISTRATION`. It is a PCC intake record, not a script, render job, GPU allocation, or publishing job. The UI says this directly. Nothing starts RunPod and nothing publishes to a channel.

## Verified integration state

The PMF Systems registry currently identifies PMF 0.3.0 as version-locked to `PMF-FOUNDER-PSC-ANIMATION-V0.3.0-QA-ACCEPTANCE-LOCK-2026-10-27-001` and acceptance revision `PMF-ANIMATION-FINAL-QA-AC-001`. Its stream status is `PENDING_PCC_REGISTRATION`, `pcc_system_id=null`, and version status `UNREGISTERED`. Therefore PCC cannot safely invoke the general PMF runtime yet.

The existing PMF animation compute service is bound to a private processor, but its current execution admission is limited to the Angie’s World trial identity. This branch does not send production requests to that trial.

The PMF channel registry currently exposes these nine keys: `goldmind`, `goldwords`, `phnx_kids`, `phnx_kitchen`, `phnx_sports`, `phnx_studio`, `rpe`, `shadow`, and `valarian`. The `goldwords` PMF row is X. It does not establish the user's Pinterest account or other social accounts. PHNX Faceless and the additional platforms are not present in the inspected PMF registry and are not offered by this first PCC screen.

PVE voice and PNG render workers exist in Systems, but PCC has no verified production handoff to them. The Script Writer, EFPB script breakdown, BOAS/KNOAS Reviewer, voice/PNG selection, RunPod admission, and SPIDER distribution are not implemented by this slice.

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

The API validates the caller's Supabase Auth session and reads server-managed `app_metadata.pcc_animation_access` roles: `REQUEST`, `REVIEW`, or `ADMIN`. The browser does not receive the service-role key. The PCC table has RLS enabled, direct client grants revoked, and a service-role-only RPC.

## Remaining build gates

1. Complete PMF 0.3.0's PCC system/version registration and admission under its BOAS/PSC acceptance contract. Do not change its trial identity to production by bypassing the registry.
2. Implement a PCC-controlled channel/policy resolver that reads registered BOAS/KNOAS and channel profiles through a server-to-server interface.
3. Build the Script Writer and self-healing Reviewer path: EFPB full script, channel-specific segment breakdown, BOAS/KNOAS evaluation, correction receipt, and notifications for unresolved issues.
4. Add secure worker adapters for PMF animation, PVE voice/script, and PNG rendering; return job IDs, artifact hashes, and receipts to PCC.
5. Connect RunPod as on-demand compute behind the approved PMF runtime and measure a real render before enabling automatic admission.
6. Add the backlog threshold alert (three remaining ads/reels/episodes) and SPIDER distribution handoff, with explicit publishing approval and schedule controls.

## Deployment and validation

This is a draft implementation. No PCC migration, Edge Function, role assignment, worker, or production resource was deployed by this branch. Apply the SQL only to PCC project `ttkceizmjeckrorhkhfr`; `supabase/migrations/` is reserved for the Systems/PMF target in this repository setup. Deploy the function only after the PCC migration and operator-role provisioning are reviewed.

Local Deno, browser, database-migration, and workflow validation were not run because this repository is not mounted in the workspace. The open draft PR is the review target.