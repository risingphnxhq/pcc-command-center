# PCC V1 Chad S2S pilot: source and evidence boundary

Date: 2026-09-24. Corporate project: `ttkceizmjeckrorhkhfr`.

## Governing source PSC

- `PSC-A-CORPORATE-PCC-V1-TELEPHONY-EXTERNAL-COMMUNICATIONS-2026-09-23-001`: V1 requires inbound/outbound office routing, natural turn-taking, interruption handling, bounded context, identity, multilingual operation, call outcomes and receipts. Emergency calling requires separate physical certification.
- `PSC-A-CORPORATE-LEXOMARK-TAXONOMY-AND-CHAD-S2S-PILOT-PACKAGE-2026-09-23-001`: `PCC-V1-CHAD-S2S-PILOT-001` is `READY_FOR_GOVERNED_HANDOFF`; Systems engineering is `NOT_SUBMITTED`, Corporate acceptance `PENDING`, and production cutover false. Preserve the existing call corridor.

## Repository inspection

- `nace-runtime.js` posts a text voice plan to the SVW `/voice/execute` endpoint and plays returned audio. It has no full-duplex session, interruption recovery, office authority or receipt binding.
- `voice-engine-runtime.js` returns a fixed `READY` JSON result; `voice-engine/worker.js` returns fixed `ACTIVE`. These stubs are not health probes or pilot certification evidence.
- The supplied historical SVW v9.4 text describes Twilio `/twilio/voice` and `/twilio/gather`, a speech/transcription → text plan → TTS/audio corridor, and `/voice/execute`. The pasted text contains transcription/escaping artifacts, so it is not a deployable source artifact or runtime readback. No secrets or voice IDs have been taken from it.

## Bounded Systems handoff and acceptance

1. Systems confirms the actual deployed SVW/PVO versions, Twilio routing and authenticated source revision; preserve rollback to the working corridor.
2. Systems reconciles Chad and NACE voice identities from managed configuration without printing private keys or replacing production mappings from screenshots alone.
3. Systems runs a bounded Chad S2S call proving duplex speech, barge-in, interruption recovery, identity continuity and bounded context.
4. Corporate verifies office authority, one-warning call termination, multilingual continuity and durable call outcome/evidence/receipt lineage.
5. A separate provider/jurisdiction/location/transfer/fallback physical test is required before any emergency-calling certification.
6. Capture test IDs, timestamps, source revision, failure cases, rollback result, Systems certification and separate Corporate acceptance before cutover.

State: pilot package ready; no S2S runtime PASS, production cutover, or emergency-calling certification claimed.
