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

## Mickey Mouse Protocol — credit-conserving production

User directive October 22, 2026: conserve OpenArt credits and incorporate the Mickey Mouse Protocol for future Angie videos. Recovered PSC reference PHNX-STUDIOS-CSE-PSC-MICKEY-MOUSE-ANIMATION-PHILOSOPHY-RECOVERY-2026-10-14-001 remains PROVISIONAL historical recovery, not certified implementation. This user-directed workflow adopts its recovered principles without upgrading that historical record.

**SOUND LEADS. VISUAL FOLLOWS. MOTION REINFORCES.**

- Follow script → approved voice → timing map → character references → keyframes → in-betweens → frame groups → synchronization → render → frame-level QA → localized correction.
- Build reusable approved character masters/rigs, mouth shapes, expressions, poses and gesture cycles. Preserve Angie's identity, shirt text, voice, scene state, editable sources and receipts. Reuse assets to tell new stories; do not duplicate complete uploads.
- Keep the background as a separate static layer. Lock the camera for dialogue unless a deliberate camera move is specified. Animate character layers independently. Inspect scenery and shirt lettering for movement, warping and drift during character motion.
- Use available local rigging, interpolation and compositing for repeatable motion and audio-driven mouth/expression timing. Validate these capabilities with a short representative sample before describing them as working. If reusable layers or rigs are missing, report the production gap rather than silently replacing the workflow with paid full-scene generation.
- Use OpenArt selectively for approved missing assets or difficult specialty shots, not every second of an episode. Automatic paid-generation budget remains zero. No numerical credit allocation is asserted by the historical protocol.
- Before any separately authorized paid generation, record the provider's actual quoted cost, shot count, approved ceiling and remaining authorized budget. Do not guess conversion rates, silently switch paid providers, or repeat failed generations beyond the authorization.
- Correct only affected poses, frame groups or layers when feasible; retain good voice, background and animation. Approximate 20-frame blocks are optional working guidance, not a fixed standard.
- Review background stability, character consistency, audio synchronization and final transitions. Preserve current trailer as the accepted launch piece; apply these improvements to subsequent videos. Track actual credit expenditure in production receipts.

## Independent Phnx Studios process and temporal sampling pilot

The user's target is an independent process equal to or better than the approved OpenArt benchmark, eliminating OpenArt as a production dependency. Do not automatically fall back to OpenArt or any other paid video generator when the local process fails. Improve and test the local process; record missing capabilities. The prior terrible protocol version is not an acceptable release standard.

Before full episodes, compare a short local pilot against approved reference footage for identity, natural movement, facial expression, lip sync, edge fidelity, clothing text and stable scenery. User review of the pilot is required before treating this experimental method as approved production. Keep the accepted trailer unchanged.

User hypothesis: denser, subtler movement steps may improve smoothness. Test equal-duration motion with more distinct intermediate poses and controlled easing; distinguish motion-update frequency from playback FPS and repeated frames. Correct anatomy and pose spacing before increasing sample count. The current 12/24/30 motion-update comparison is rendered at 30fps; 24 updates at 30fps introduces uneven hold cadence, so it cannot isolate frame density perfectly. Use common-multiple playback or divisors of playback rate for a controlled follow-up.

The initial local pilot is a 2.5D compositing and motion-transfer experiment: two reusable still layers, local deformable movement, and stabilized facial performance from the existing approved clip. It uses no new OpenArt requests. Existing reference-derived expressions are not proof of independent fresh-dialogue animation or 3D articulation. Quality equivalence and service readiness remain unproven. Phnx Studios commercialization requires repeatable quality plus measured cost and correction time; no release or revenue claims yet.
