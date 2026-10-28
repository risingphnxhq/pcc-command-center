# PCC Animation Control V1

## What is built

This change adds the first PCC-owned animation job intake boundary:

- Authenticated PCC users can submit a bounded animation request for a channel and output type.
- Requests are stored as PCC jobs with BOAS/KNOAS references and an idempotency key.
- Request and reviewer roles are checked from server-verified Supabase Auth `app_metadata.pcc_animation_access`.
- The database table has RLS enabled, no direct client grants, and a service-role-only RPC.
- A requester can read their own job; a REVIEW or ADMIN role can read across requesters.
- The handler returns `dispatch: NOT_CONNECTED` honestly; it does not pretend that a render has started.

## What is not connected yet

This is not the full Animation Engine. The current PMF animation runtime is bound to the Angie’s World trial admission and production identity. It is not a general production endpoint for PCC channel jobs. PCC also has no verified job handoff to the PVE voice worker or PNG renderer. Therefore this change does not dispatch to PMF, PVE, PNG, or RunPod, and it does not invoke the Script Writer or Reviewer.

Those integrations must use the actual runtime contracts and service authentication. Do not point this control endpoint at the Angie’s World trial runtime or expose service credentials to the browser.

## Deploy order

1. Review and apply `supabase/pcc-migrations/20261028_pcc_animation_control_v1.sql` to the PCC Supabase project `ttkceizmjeckrorhkhfr` only. This file is deliberately outside `supabase/migrations/`, which is used by the Systems/PMF migration workflow.
2. Deploy `pcc-animation-control-v1` with the manual PCC-only GitHub workflow. It checks the PCC project ref before deployment.
3. Provision `pcc_animation_access` roles in Supabase Auth app metadata through the existing PCC administrator process. Supported values: `REQUEST`, `REVIEW`, `ADMIN`. No user receives access by default.
4. Add a PCC UI entry point and verify the authenticated request/read flow against a non-production test account before enabling any operator workflow.

Do not apply this migration through the existing Systems/PMF migration workflow.

## Request contract

POST to `/functions/v1/pcc-animation-control-v1` with PCC Supabase `apikey` and a signed-in user's Bearer token.

Create:
```json
{
  "action": "CREATE",
  "payload": {
    "idempotency_key": "caller-generated-unique-key",
    "channel_code": "PHNX_KIDS",
    "output_type": "REEL",
    "title": "Working title",
    "idea": "The concept to develop.",
    "boas_id": "approved-boas-record",
    "knoas_id": "approved-knoas-record",
    "request_payload": {}
  }
}
```

Read:
```json
{
  "action": "READ",
  "payload": {
    "job_id": "returned-job-uuid"
  }
}
```

The current create response reports a PCC queue record only. Queue states are stored on the job table; this slice currently creates `QUEUED` jobs and supports reads. It has no worker that advances those states yet.
