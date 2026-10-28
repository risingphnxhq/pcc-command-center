# PCC animation intake queue v1

This is the first PCC-facing intake slice of the Animation Engine: an authenticated intake for book/volume manuscripts, animation, ads, reels, micro-dramas, series episodes, corporate jingles, television commercials, and social media campaigns. Each request binds an idea to one channel and may include its series/campaign and intended ending or audience action. This slice is not yet the Scriptwriter, renderer, reviewer, or publisher.

## Current behavior

- PCC sends `CREATE`, `LIST`, `READ`, or `CANCEL` to `pcc-animation-queue-v1`.
- The edge function validates the PCC Supabase user session and calls a service-role-only RPC.
- The database stores each request under the requesting PCC subject and exposes only that subject's rows through the API.
- A new request is always `HELD_CONFIGURATION_REQUIRED`. The response explicitly records that channel-specific BOAS/KNOAS binding, Scriptwriter dispatch, PMF runtime admission, render worker, QA, and distribution authorization have not happened.
- The intake captures the starting idea, output type, channel, optional series/campaign, and optional ending/conversion objective. It does not pretend the user has written a full script.

## One canon, book and animation outputs

The story system should maintain one approved canon and allow multiple production paths from it. For the Obsidian Core Saga, the Scriptwriter can produce a complete book or volume manuscript, and the Animation Engine can adapt approved book chapters/story arcs into animation scripts and channel-sized segments. Both retain links to the same BOAS/KNOAS and canon revisions so an adaptation can be checked against the source work.

The book path needs manuscript structure (saga/volume, chapter, scene, continuity references) and a literary Reviewer pass. The animation path needs episode/shot/segment structure and a production Reviewer pass. Shared canon does not mean forcing a book chapter into a short video format; PCC selects the deliverable path and its matching Reviewer checklist.

## Scriptwriter contract (required next integration)

The Scriptwriter is one shared service dispatched by PCC, not one writer per channel. For every request it must:

1. Resolve the selected channel's approved BOAS/KNOAS profile, series/campaign bible, audience, format rules, and any required source assets. If required context is absent or conflicting, return `HELD_CONTEXT_REQUIRED` with the exact missing fields; do not invent established canon.
2. Apply EFPB (End From Beginning Protocol): identify the intended ending, resolution, or audience action first; check that it matches the brief and channel strategy.
3. Produce a complete, versioned master script, retaining the request ID, channel key, series/campaign key, objective, source profile revisions, and EFPB decision in provenance.
4. Produce the requested deliverable from that approved master: for a book manuscript, structure the full work into volumes/chapters/scenes; for channel output, segment it to the selected output type and channel. Each part carries ordered IDs, applicable length/duration limits and a link to the exact master/canon revisions. Platform formatting is an adapter driven by the profile, not guesswork in the shared writer.
5. Run script and segmentation checks, then send the bundle to PMF. No render can begin until PMF accepts the bundle and all configured QA and spend controls pass.

The Obsidian Core Saga can therefore have a complete book manuscript and approved animation adaptations derived from the same canon, while short-form outputs can be segmented without losing source provenance.

## Independent Reviewer and self-healing QA (required next integration)

The shared Scriptwriter must hand each full script and its channel-specific segments to a Reviewer before PMF/render admission. The Reviewer is an independent QA role/service; it checks story coherence against approved BOAS/KNOAS and canon, then applies the matching literary, animation, or channel-output checklist.

For each review, it should return a versioned report tied to the request and exact script/segment revisions, including checks passed, issues found, severity, proposed or applied corrections, and notification status. It should check at minimum: EFPB ending is achieved by the story; cause-and-effect and character/story continuity make sense; the manuscript/episode fits its intended deliverable and audience; and any channel segments preserve the approved master without breaking format limits.

Self-healing loop:
1. For a fix that is clear from approved BOAS/KNOAS or the brief, Reviewer proposes/applies the correction, saves a new script revision, and re-runs the same checks.
2. PCC records and notifies the owner/team about the issue and correction; notification is visible in PCC and does not itself stop other queued jobs.
3. Bound automatic correction attempts (for example, two passes) to avoid infinite rewrite loops. If the issue remains, produce a review-needed report with the unresolved issue and suggested fix. Do not mark it passed or silently change canon. The job can remain in the review queue while unrelated jobs continue.
4. Only a clean Reviewer result can satisfy script QA for render admission. A correction must not automatically authorize GPU spend, publishing, or distribution.

This is the intended self-correct-and-notify behavior. The current intake PR has no Reviewer runtime, correction loop, notification delivery, or QA gate wired yet.

## Three-output runway notification (required next integration)

PCC should maintain a per-channel, per-series/campaign count of outputs that are approved, ready, and not yet published. When the count crosses down to three or fewer, notify the owner/team to choose continuation episodes or new outputs. Count only eligible deliverables; drafts, failed renders, cancelled jobs, and already-published items do not count. Deduplicate the alert while the count remains at or below three; re-arm after it rises above three. The notification is planning only: it must not automatically write, render, spend, schedule, or publish.
- Cancellation is available only while the item is held.
- The API does not accept a RunPod action, provider credential, arbitrary status transition, spend limit, publish command, or caller-supplied authorization receipt.

## PCC to production path

1. Founder submits an idea, selects a book/volume or screen output type and owning story world/channel, and optionally supplies series/campaign and intended ending/action.
2. PCC resolves that channel's approved BOAS/KNOAS profile and Scriptwriter route.
3. Scriptwriter applies EFPB, creates the full master script, then segments it for the channel; the independent Reviewer checks coherence and channel fit, applies bounded safe repairs, and reports issues to PCC.
4. PMF evaluates the script bundle and Reviewer report.
5. PCC confirms PMF runtime admission, the required QA revision, approved render settings, and an explicit per-job spend ceiling.
6. Only then may a governed worker claim the job and request an on-demand RunPod render.
7. The resulting video and receipts return to PCC for founder review. SPIDER distribution remains a separate action after approval.

The EFPB Scriptwriter dispatch, channel segmenter, independent Reviewer/self-healing correction loop, PCC error notifications, three-output inventory counter/notification, and steps 2–7 are specified here but are not yet enabled by this intake slice. The existing PMF runtime is Angie-trial-scoped; PMF 0.3.0 is registered but `NOT_ADMITTED` and `NOT_CERTIFIED`; the live Cloudflare PMF worker has no RunPod service binding. The held state prevents a saved request from being mistaken for an executable job.

## Deploy gate

This is a draft GitHub change only. The migration must be reviewed and run through the repository's explicit production-migration workflow, and the edge function must be deployed separately. Neither is deployed by this change. The PCC screen must be wired to this API before an end-user workflow is claimed.


## RPE marketing and production intelligence profiles

The same shared Scriptwriter serves RPE and its channel brands, but PCC selects a deliverable-specific profile and matching Reviewer rubric. The selected channel/brand and its approved BOAS/KNOAS profile govern voice, audience, claims, continuity, and visual identity. PMF owns production admission, validation, artifact lineage, render coordination, and QA receipts; it does not replace the writer or decide the brand strategy.

- **Corporate jingle:** brief fields include brand/product, audience, approved promise, mandatory words or sonic logo, duration, tone/genre, pronunciation, and usage scope. Deliverables include hook and lyric, singable meter/prosody notes, arrangement/tempo/mood direction, sonic identity cue, and cutdowns when requested. Review checks brand/message accuracy, pronunciation, memorable hook, duration, approved claims, rights/usage notes, and clean versions.
- **Television commercial:** produce a full concept and timed script/storyboard with scenes, dialogue/VO, supers, product/brand reveal, end card, CTA, runtime, and required legal copy. Review checks brief fidelity, claims against approved evidence, legal copy placement, legible end card, timing, brand and audience fit, and technical delivery specs.
- **Social media campaign:** create a campaign message and platform-specific variants (for example TikTok, Instagram, YouTube Shorts, X, Threads, or Pinterest only where selected), each with its hook, script/caption, visual/audio direction, CTA, runtime/length, cutdowns, accessibility captions/alt text, and posting metadata. Review checks each surface's current approved specs and brand rules, consistent campaign message, claim substantiation, CTA, safe text/layout, accessibility, and cross-post adaptations. A brand channel is not itself a social platform; PCC must keep the two mappings distinct.
- **Ads and reels:** use the marketing rubric when the job is promotional; use the story rubric when it is narrative. If both apply, both run, with their results recorded separately.

Reviewer behavior is type-aware. Literary and narrative outputs are checked for EFPB payoff, causal coherence, character/canon continuity, and audience/format fit. Marketing outputs are checked for objective/brief fidelity, brand voice, substantiated claims, required disclaimers, CTA accuracy, duration or platform constraints, accessibility, and asset/usage authorization. A reviewer may make bounded repairs supported by approved source facts, re-run the relevant checks, and report what it fixed; it must escalate unsupported claims, missing legal guidance, conflicting brand rules, or rights questions rather than fabricate a resolution. This is the required intelligence profile, not a claim that an autonomous reviewer/runtime is already wired.

Initial request types now include `CORPORATE_JINGLE`, `TV_COMMERCIAL`, and `SOCIAL_MEDIA_CAMPAIGN`. Intake remains held until PCC-to-PMF dispatch, approved source profiles, QA enforcement, and render controls are implemented and tested.

## Verified integration boundary

PCC and PMF/PVE/PNG are in separate Supabase projects. The PCC Canon project is `ttkceizmjeckrorhkhfr`; the PMF/PVE/PNG project is `oyjmpbuxvfxusmbouldi`. PCC’s queue belongs in its private `pcc_hq` schema. PMF’s `pcc_institutional.pmf_animation_jobs`, `pmf_animation_artifacts`, and `pmf_animation_runtime_v1` remain in the separate PMF project and cannot be read by PCC’s local RPC.

The verified PMF animation runtime is constrained to the active Angie’s World trial/build gate and a hash-bound manifest with physically stored, approved inputs. It allows at most 600 frames and records completed output as review-required with quality approval and distribution explicitly false. It is not yet the shared channel Scriptwriter or general RunPod animation worker. The production foundation still includes existing PVE Voice, Voice Script, and PNG Rendering tables in the PMF project. Their presence is confirmed; a secure PCC-to-PMF bridge and supported operation contracts are not.

This queue slice therefore stores an authenticated, Founder-authorized PCC request and keeps it held. It does not duplicate PMF/PVE/PNG tables, invoke the trial runtime, start RunPod, or distribute content. The earlier branch draft placed the queue schema in the PMF project but sent requests to PCC’s project; this has been corrected. Deployment remains separate and must target the PCC Canon project only.
