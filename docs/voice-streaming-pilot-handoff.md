# System Voice Worker: streaming speech pilot handoff

Status: source inspected from Founder-supplied worker code and Cloudflare screenshots on 2026-09-24 America/Chicago. This document does not certify production streaming.

## Observed production path
- Worker: `system-voice-worker.tsteelefpa.workers.dev`, service string `phoenix_system_voice`, version string `v9.4.0-awwd-pcc-voice-execute`.
- Twilio points primary and backup voice POST to `/twilio/voice`.
- `/twilio/voice` returns a greeting `<Play>`, `<Gather input="speech">`, and a redirect.
- `/twilio/gather` reads `SpeechResult`, calls text-based `generateVoicePlan`, then `<Play>`s an ElevenLabs audio URL. It repeats the Gather loop.
- `/voice/execute` streams ElevenLabs TTS from submitted text; it is not native conversational speech to speech.
- Founder reports an inbound call works. No call SID, provider trace or recording was inspected in this pass.
- Health JSON has `ready: true` but is static and does not test Twilio, OpenAI, ElevenLabs, streaming, or PCC command authority.

## Corporate Voice build — Chad / Corporate
1. Preserve the production `/twilio/voice` route and the existing number as the fallback. Add a pilot route on the same worker for allowlisted test calls. No Twilio number configuration change during pilot.
2. For pilot calls return TwiML `<Connect><Stream url="wss://.../twilio/media">...</Stream></Connect>`. Implement a WebSocket server with Twilio start/media/mark/clear/stop events, validate call identity and configured stream authorization, and isolate state by CallSid. Never pass the audio token, caller text, or provider credentials in a URL.
3. Bridge bidirectional `audio/x-mulaw` 8000 Hz frames between Twilio and a chosen native audio-in/audio-out speech runtime. Confirm actual provider support for native speech output and the approved NACE/Chad voice identities before selection. Do not label a streaming STT → text AI → TTS chain as direct S2S.
4. Map speech events into the existing institutional identity, routing, authority and receipt lifecycle. Caller speech or a requested persona must not grant command execution. Separate customer/support sessions from HQ command sessions.
5. On caller interruption, cancel generation and clear buffered Twilio audio, retaining bounded context. Apply latency and session limits, backpressure, timeouts, cleanup and fallback to the existing call path.
6. Test NACE greeting, Chad handoff, multi-turn memory, interruption, silence, failed upstream, termination, identity, authority and material receipts. Record call identifiers, versions, timings, rollback and outcome without exposing credentials.

## Founder / Prime Chad AI voice direction

The requested interaction is caller speech → AI staff intelligence and routing → speech in the triggered staff member's established voice. Staff selection and voice selection are separate: `persona_key` is resolved under Corporate authority, then selects the approved provider voice ID; the ID does not itself grant institutional authority.

**Two engineering routes to test:**

- **Preserve existing ElevenLabs voice IDs:** Twilio bidirectional Media Stream → realtime audio conversation/orchestration → low-latency ElevenLabs speech output in the approved voice → Twilio audio. This can reduce pauses and allow interruption if output is streamed and buffered audio is cleared. If the AI produces text for ElevenLabs synthesis, document it as a streaming hybrid rather than direct end-to-end native S2S.
- **Native OpenAI speech-to-speech:** Twilio bidirectional Media Stream → OpenAI Realtime audio-in/audio-out → Twilio. OpenAI has built-in voices and supports its own eligible custom voice IDs. Existing ElevenLabs voice IDs are provider-specific and cannot be assumed usable as OpenAI custom voice IDs. Custom OpenAI voices require provider eligibility and a consent process, followed by voice-by-voice approval and comparison before any identity change.

Test a single NACE → Chad pilot for first audio latency, interruption and recovery, staff voice fidelity, transfer continuity, cost, authority/receipts, and rollback. Select a route from measured evidence. The existing `OPENAI_API_KEY` indicates a secret is configured; the current source uses text chat completions, so this does not prove OpenAI Realtime access or production readiness.

## Source issues to address before promotion
- Cloudflare screenshot visibly exposed the configured `TWILIO_AUDIO_TOKEN` value; rotate it and store as a secret. Current `buildAudioUrl` also places it in query strings, which may appear in logs, browser history, Twilio request traces and referrers.
- Source excerpt exposes `GET /voice/tts`, `POST /voice/execute`, `POST /voice/plan`, and `GET /debug/env` without a visible authentication gate. Add route-specific authorization; `/debug/env` should not be publicly exposed.
- No Twilio signature verification is visible on `/twilio/voice` or `/twilio/gather`. Verify actual provider request signatures and streaming handshake before accepting production traffic.
- Identical primary and backup Twilio webhook URLs are not independent failover.
- Source excerpt contains Markdown-formatted fetch targets (square-bracket link notation) for ElevenLabs and OpenAI. Check the deployed editor source; if literal, those URLs are invalid. A working call suggests the pasted text may differ from deployed bytes.
- `detectRequestedPersona` uses substring matching and can trigger on a mention unrelated to a transfer; require explicit request and authority check.
- Current `<Gather>` plus full `<Play>` loop prevents proper barge-in.
- Source excerpts and photos are not a verified deployment diff. Read deployed source and bindings before cutting over.

Ownership: Chad / Corporate builds and accepts Corporate Voice, including the System Voice Worker pilot. Mason / CSE is consulted only for integrations crossing into separately owned Systems jurisdiction. Corporate voice work does not confer Systems authority.

Corporate PSC: `PSC-A-CORPORATE-PCC-VOICE-S2S-PILOT-ACCEPTANCE-2026-09-25-001` (ownership corrected by subsequent Founder directive).
