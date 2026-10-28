# PCC animation intake queue v1

This is the first PCC-facing intake slice of the Animation Engine: an authenticated request inbox for animation, ads, reels, micro-dramas, and series episodes. Each request binds an idea to one channel and may include its series/campaign and intended ending or audience action. This slice is not yet the Scriptwriter, renderer, reviewer, or publisher.

## Current behavior

- PCC sends `CREATE`, `LIST`, `READ`, or `CANCEL` to `pcc-animation-queue-v1`.
- The edge function validates the PCC Supabase user session and calls a service-role-only RPC.
- The database stores each request under the requesting PCC subject and exposes only that subject's rows through the API.
- A new request is always `HELD_CONFIGURATION_REQUIRED`. The response explicitly records that channel-specific BOAS/KNOAS binding, Scriptwriter dispatch, PMF runtime admission, render worker, QA, and distribution authorization have not happened.
- The intake captures the starting idea, output type, channel, optional series/campaign, and optional ending/conversion objective. It does not pretend the user has written a full script.

## Scriptwriter contract (required next integration)

The Scriptwriter is one shared service dispatched by PCC, not one writer per channel. For every request it must:

1. Resolve the selected channel's approved BOAS/KNOAS profile, series/campaign bible, audience, format rules, and any required source assets. If required context is absent or conflicting, return `HELD_CONTEXT_REQUIRED` with the exact missing fields; do not invent established canon.
2. Apply EFPB (End From Beginning Protocol): identify the intended ending, resolution, or audience action first; check that it matches the brief and channel strategy.
3. Produce a complete, versioned master script, retaining the request ID, channel key, series/campaign key, objective, source profile revisions, and EFPB decision in provenance.
4. Segment that approved master script for the selected channel and output type. Each segment carries ordered segment IDs, duration/word or character limits, scene/action/audio/dialogue cues as applicable, and a link to its exact master-script revision. Platform formatting is an adapter driven by the channel profile, not guesswork in the shared writer.
5. Run script and segmentation checks, then send the bundle to PMF. No render can begin until PMF accepts the bundle and all configured QA and spend controls pass.

A full episode or ad can therefore be drafted once as a master script and then transformed into the channel's required reel, scene, clip, or delivery segments without losing the source version.

## Three-output runway notification (required next integration)

PCC should maintain a per-channel, per-series/campaign count of outputs that are approved, ready, and not yet published. When the count crosses down to three or fewer, notify the owner/team to choose continuation episodes or new outputs. Count only eligible deliverables; drafts, failed renders, cancelled jobs, and already-published items do not count. Deduplicate the alert while the count remains at or below three; re-arm after it rises above three. The notification is planning only: it must not automatically write, render, spend, schedule, or publish.
- Cancellation is available only while the item is held.
- The API does not accept a RunPod action, provider credential, arbitrary status transition, spend limit, publish command, or caller-supplied authorization receipt.

## PCC to production path

1. Founder creates a Reel/Episode request in PCC and chooses its channel.
2. PCC resolves that channel's approved BOAS/KNOAS profile and Scriptwriter route.
3. Scriptwriter prepares a versioned script bundle and PMF evaluates it.
4. PCC confirms PMF runtime admission, the required QA revision, approved render settings, and an explicit per-job spend ceiling.
5. Only then may a governed worker claim the job and request an on-demand RunPod render.
6. The resulting video and receipts return to PCC for founder review. SPIDER distribution remains a separate action after approval.

The EFPB Scriptwriter dispatch, channel segmenter, three-output inventory counter/notification, and steps 2–6 are specified here but are not yet enabled by this intake slice. The existing PMF runtime is Angie-trial-scoped; PMF 0.3.0 is registered but `NOT_ADMITTED` and `NOT_CERTIFIED`; the live Cloudflare PMF worker has no RunPod service binding. The held state prevents a saved request from being mistaken for an executable job.

## Deploy gate

This is a draft GitHub change only. The migration must be reviewed and run through the repository's explicit production-migration workflow, and the edge function must be deployed separately. Neither is deployed by this change. The PCC screen must be wired to this API before an end-user workflow is claimed.
