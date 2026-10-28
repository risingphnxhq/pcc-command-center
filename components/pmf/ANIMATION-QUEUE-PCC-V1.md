# PCC animation intake queue v1

This is the first runnable PCC-facing slice of the Animation Engine: an authenticated, durable request inbox for Reels and Episodes. The request belongs to one named channel and preserves its creative brief. It is not yet the Scriptwriter, renderer, reviewer, or publisher.

## Current behavior

- PCC sends `CREATE`, `LIST`, `READ`, or `CANCEL` to `pcc-animation-queue-v1`.
- The edge function validates the PCC Supabase user session and calls a service-role-only RPC.
- The database stores each request under the requesting PCC subject and exposes only that subject's rows through the API.
- A new request is always `HELD_CONFIGURATION_REQUIRED`. The response explicitly records that channel-specific BOAS/KNOAS binding, Scriptwriter dispatch, PMF runtime admission, render worker, QA, and distribution authorization have not happened.
- Cancellation is available only while the item is held.
- The API does not accept a RunPod action, provider credential, arbitrary status transition, spend limit, publish command, or caller-supplied authorization receipt.

## PCC to production path

1. Founder creates a Reel/Episode request in PCC and chooses its channel.
2. PCC resolves that channel's approved BOAS/KNOAS profile and Scriptwriter route.
3. Scriptwriter prepares a versioned script bundle and PMF evaluates it.
4. PCC confirms PMF runtime admission, the required QA revision, approved render settings, and an explicit per-job spend ceiling.
5. Only then may a governed worker claim the job and request an on-demand RunPod render.
6. The resulting video and receipts return to PCC for founder review. SPIDER distribution remains a separate action after approval.

Steps 2–6 are intentionally not enabled by this intake slice. The existing PMF runtime is Angie-trial-scoped; PMF 0.3.0 is registered but `NOT_ADMITTED` and `NOT_CERTIFIED`; the live Cloudflare PMF worker has no RunPod service binding. The held state prevents a saved request from being mistaken for an executable job.

## Deploy gate

This is a draft GitHub change only. The migration must be reviewed and run through the repository's explicit production-migration workflow, and the edge function must be deployed separately. Neither is deployed by this change. The PCC screen must be wired to this API before an end-user workflow is claimed.
