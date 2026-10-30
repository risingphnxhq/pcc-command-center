# PCC Animation Engine script runtime v1

This runtime currently writes a complete, canonical PCC-to-PMF packet into the PCC job as `HELD_PMF_ADMISSION_REQUIRED`. It does not transfer the packet to PMF, call PVE/PNG/RunPod, or publish. The PMF private trial `/stage` endpoint requires an unrelated immutable trial manifest and is deliberately not used.

## Required server configuration

Configure these only as Edge Function secrets for the PCC Supabase project, never in browser code or the repository:

- `PCC_SCRIPT_MODEL_API_KEY`: key for the approved OpenAI model account.
- `PCC_SCRIPT_MODEL_NAME`: model name that supports JSON-object responses in Chat Completions.
- `PCC_ANIMATION_CHANNEL_POLICY_REGISTRY`: JSON object containing only the reviewed channel/work-type policies PCC is authorized to use.

Example shape (placeholder identifiers and rules; do not deploy these as real policy):

```json
{
  "phnx_kids": {
    "EPISODE": {
      "boas_id": "REPLACE_WITH_REGISTERED_BOAS_ID",
      "boas_revision": "REPLACE_WITH_APPROVED_BOAS_REVISION",
      "boas_approved": true,
      "knoas_id": "REPLACE_WITH_REGISTERED_KNOAS_ID",
      "knoas_revision": "REPLACE_WITH_APPROVED_KNOAS_REVISION",
      "knoas_approved": true,
      "channel_profile": {
        "audience": "REPLACE_WITH_APPROVED_AUDIENCE_AND_TONE"
      },
      "output_spec": {
        "minimum_segments": 1,
        "maximum_segments": 12,
        "max_segment_duration_seconds": 120
      }
    }
  }
}
```

The browser submits only a PCC job ID. The Edge Function reads the job and selects the matching server-side channel and output-type policy. It rejects requests when the policy or model configuration is missing; it does not trust policy data from the request payload.

## Script lifecycle

1. An authorized PCC user records an idea, editorial channel/series, and output type.
2. The user starts the request-level Generate and review script action. An atomic PCC claim prevents concurrent duplicate Writer runs for the same request.
3. PCC uses EFPB to produce the complete work first, then channel segments.
4. The independent Reviewer can return corrections. The Writer can repair up to two times.
5. The binary validator checks required policy IDs, EFPB fields, continuity ledger, contiguous segment indexes, required segment fields, full-script coverage, and any registered segment limits.
6. PCC stores the complete script package and Reviewer receipt on the request. Passed scripts are marked `SCRIPT_REVIEW_PASSED`; unresolved issues are held as `REVIEW` and displayed on the request.
7. A HANDOFF/ADMIN operator can stage a passing request. The server validates approved BOAS/KNOAS revision flags, binary QA, and Reviewer receipts, then constructs a canonical packet from the persisted request and stores it as `HELD_PMF_ADMISSION_REQUIRED`.
8. If model execution fails, PCC records a retryable REVIEW receipt and releases the claim. Staging is not delivery: PMF registration/admission/certification and an admitted production intake remain prerequisites; no render or publication occurs.

## Current registry gate

The live Systems database has PMF 0.3.0 at registry state `ACTIVE`, but audit state `NOT_ADMITTED` and certification state `NOT_CERTIFIED`. The connected database read did not reveal a KNOAS policy registry table. Do not fill the example with guessed policy IDs or channel rules. The environment registry is a temporary trusted-input boundary, not a replacement for the real PCC BOAS/KNOAS resolver. A policy must provide `boas_id`, `boas_revision`, `boas_approved: true`, `knoas_id`, `knoas_revision`, `knoas_approved: true`, channel profile, and output spec. Missing/unapproved revisions block writing and handoff staging.

## Installation boundary

The migration under `supabase/pcc-migrations/` is PCC-only. Apply it only to the PCC project after review. The default `supabase/migrations/` path targets Systems/PMF and must not be used for this PCC table. The Edge Function deployment is separate and remains manual. No production deployment, model call, GPU allocation, render, or publish is performed by this draft PR.
