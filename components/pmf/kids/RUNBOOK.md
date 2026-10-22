# Phoenix Kids production and publishing

Channel: phnx_kids / UCbq_0JCn_0P5cnCVwhIKUOQ / https://www.youtube.com/@Phnx_Kids
PCC: https://command.risingphoenixhq.com/spider-kids.html
Worker: https://phoenix-builder-runner.tsteelefpa.workers.dev
Systems Supabase: oyjmpbuxvfxusmbouldi (Primary connection).

Launch calendar October 23–November 19, 2026: 28 daily Shorts at noon and eight episodes Tuesday/Saturday at 18:00, America/Chicago. Database timestamps account for DST. The daily production task runs at 06:00 Central. Planned slots are not YouTube schedules. Automation: Phoenix Kids Production, 6ada43ce248881919cb1f7c5f1556c94. First unattended execution remains unverified.

## Each production run

1. Fetch this runbook from GitHub. Read public.pmf_kids_dashboard_v1('status','{}') with Systems service-role access, or use authorized SQL to read spider_private.kids_control and kids_slots. Stop if enabled=false. Work only future slots. Do not modify Kitchen or other channels.
2. Select approved unique content. Angie is a brown-skinned girl with a hair puff, pink Angie's World shirt and black pants. Preserve her approved appearance and voice. No Hello Kitty branding. Preserve existing Phoenix Kids characters; do not invent missing canon. No paid generation credits without explicit additional authorization. No unrelated RPE material may be published or linked.
3. Already published trailer wTvU-1wkyIY must never be uploaded again. Its approved master is Library libfile_37809dfeef748191a5e4ec5899a4f198 (sha256 c2f9375dabb66a9ec69851aef4f8b3ae795c1aa4c0e1fcf4825e01d6b937490e). Existing approved Angie voice references are in libfile_358a6fb8ec7881919835579222eb88f5. These are references, not authorization to fill every slot with duplicate video.
4. If an approved source or new episode is unavailable, leave the slot planned, record the specific blocker in its receipt and a PSC execution receipt. Report affected upcoming slots. Never label missing content scheduled or published. Local editing is permitted only with approved sources and verified reuse rights.
5. Review full decoded video and sampled frames, audio, spelling, smooth transitions, age suitability, originality and rights. Save final video to Library. Compute SHA-256 and exact size. Upload API limit 64 MiB. Shorts must use vertical framing appropriate to their format.
6. Recheck gate. Create a random one-use bearer capability (at least 32 random bytes, base64url); only its SHA-256 goes into kids_slots.capability_sha256, with a short expiry. Populate ready slot with title, description, sha256, size_bytes, artifact_library_id, source_evidence containing license_checked=true, qa_passed=true and review/source details. Do not put bearer secrets into PSC, commits, output or messages.
7. POST exact MP4 bytes to /kids/upload?slot=UUID, Authorization: Bearer CAPABILITY, Content-Type video/mp4 and exact Content-Length. This route atomically claims only a ready future slot under the open Kids gate, verifies bytes, live Google channel identity and native private publishAt. Kids content uses selfDeclaredMadeForKids=true and synthetic-media disclosure. No route accepts arbitrary channel IDs.
8. Successful receipt means YouTube private scheduled with matching release time and channel. Record video ID/URL and receipt. Failed-before-upload slots can be reviewed and safely retried through PCC. Uncertain outcomes require YouTube inspection; never blindly retry. Never relabel a missed past slot as completed.
9. Write PMF-KIDS-AUTO-EXEC-<date>-<unique> to public.phoenix_canon_records (system PMF, authority CSE, type EXECUTION_RECEIPT), accurately distinguishing prepared, scheduled, blocked and live outcomes. Preserve unrelated projects' privacy.

PCC /kids/pcc uses existing Founder entry plus individual authorization, supports status/pause/resume/retry, and never returns upload capabilities. Pause prevents new production/admission, not releases already scheduled in YouTube. Scheduler activation is separate from the PCC gate.

## Deployment
schema.sql is the already-applied migration pmf_phoenix_kids_channel_schedule. worker-module.mjs is the Kids-only module appended to the shared Worker; existing Kitchen routes remain intact. Worker routes /kids/pcc and /kids/upload dispatch to this module. Connection cards link the verified provider channel and Kids PCC calendar/trailer. Preserve all shared bindings and secrets when deploying.
