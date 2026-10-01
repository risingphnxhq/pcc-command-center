# Corporate telephony streaming checkpoint — October 1, 2026

Owner: Chad G. Pennington / Corporate. Founder directive: inbound/outbound calling with live sender audio processing and reduced actor response pauses.

## Built source

`cloudflare/system-voice-worker/worker.mjs` preserves the deployed SVW v9.4 source and adds the bounded telephony module. Legacy ElevenLabs replies now return the provider response stream instead of buffering the complete audio file. Existing `/twilio/voice` remains the rollback route.

`telephony.mjs` implements:

- Allowlisted inbound pilot `/twilio/pilot` and outbound conversation `/twilio/outbound`.
- Twilio-signature checks, one-use CallSid-bound stream tickets and independent call state.
- Bidirectional Twilio Media Streams into OpenAI Realtime PCMU audio input, beginning with incoming frames rather than waiting for a final transcript.
- Incremental response text into ElevenLabs WebSocket speech with the actor's configured approved voice. This is a **streaming hybrid**, not native end-to-end speech-to-speech. Provider voice/format/Realtime entitlement still requires a real call test.
- Caller interruption: cancel generation, discard queued synthesis, clear Twilio playback, ignore stale response tokens. Delete interrupted assistant text from model context rather than treating unheard text as delivered.
- Founder-authenticated outbound `/telephony/calls`, explicit test destination allowlist, request-id reservation, no automatic redial after ambiguous provider timeouts, and a three-request hourly pilot limit.
- Signed status callbacks, durable events and first-output latency measurements. A playback mark is acknowledgment, not proof that a human understood the call. Provider `completed` is a transport outcome, not business acceptance.

## Configuration and exact blocking boundaries

No Twilio account/auth/from-number bindings were found on any of the 18 inspected Workers. Cloudflare D1 creation for `pcc-corporate-telephony-receipts` was rejected by the provider with code 10000, Authentication error. This is a provider permission boundary, not a passed deployment or an automatic approval-review rejection.

Required SVW configuration:

| Binding | Type | Purpose |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | Secret | Correct Corporate Twilio account |
| `TWILIO_AUTH_TOKEN` | Secret | Calls API authentication and signed webhook validation |
| `TWILIO_FROM_NUMBER` | Plain text | Preserve Corporate number `+18508427524` after provider readback |
| `TELEPHONY_TEST_DESTINATIONS` | Plain text | Founder-selected controlled E.164 test number(s), comma separated |
| `CALL_RECEIPTS` | D1 | Dedicated receipt database initialized from `calls.sql` |
| `CORPORATE_PUBLISHABLE_KEY` | Plain text | Corporate Supabase publishable key; never service-role credentials |

Reuse existing `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, and approved `*_VOICE_ID` bindings. Optional model bindings are `TELEPHONY_REALTIME_MODEL` and `TELEPHONY_TTS_MODEL`. Never paste credentials into chat or Canon. Configure the Twilio Auth Token using the providers' secret configuration UI.

Apply `db/pcc_telephony_caller_authorization.sql` in Corporate Supabase for the self-only authenticated Founder eligibility RPC. Initialize D1 with `calls.sql`. Upload both Worker modules while retaining existing bindings. No production number cutover until the controlled call passes. For initial inbound pilot, configure only a separately bounded test corridor; preserve the existing number webhook as rollback. Set the call-status callback to `/twilio/status` after verifying the correct account and number.

Outbound payload: `{ "request_id": "<fresh UUID>", "to": "<allowlisted E.164>", "persona": "nace", "purpose": "Controlled Corporate telephony acceptance test" }`, with the individual's Corporate Supabase bearer JWT. A PCC passphrase/read session alone is insufficient. GET `/telephony/calls?call_sid=<SID>` retrieves the caller's own call and evidence with the same authentication. No office, system or workforce mutation is authorized by caller speech.

## Acceptance remaining

Authenticate the provider account; confirm the Corporate number; inspect live number callbacks; test inbound and outbound calls; measure first audio and turn latency; verify custom voice access and native 8 kHz mu-law output; test silence, barge-in, provider loss/fallback and duplicate outbound requests; verify signed status and durable receipts. NACE-to-office handoff, office departmental memory, multilingual acceptance and mission creation require their own governed integration evidence. Emergency calling remains uncertified.

Local checks: `node --test tests/telephony.test.mjs tests/cognition-release.test.mjs`. Mocked transport checks do not certify provider access, actual calls, voice fidelity or V1 completion.

## Follow-up completion — October 1

PCC `voice-engine.html` now includes caller destination, speaking-office and purpose controls with individual Corporate sign-in, connection gating, explicit placement, manual outcome refresh and request-id preservation after an uncertain response. `telephony-runtime.js` reuses the existing Corporate Auth session. The server limits the pilot to NACE plus Alexis, Michael, Chad, Oliver, Peggy and Sylvia. Actor selection is not workforce activation.

Explicit spoken transfer requests switch the streaming session to the named permitted office and its configured voice, preserve the same call/context, clear the previous speech and write a handoff receipt without expanding authority. Merely mentioning an officer does not transfer the call. No private departmental brief or independently activated office worker is asserted by the pilot.

The Corporate caller eligibility function was applied successfully. Readback confirmed a missing subject returns false, anon cannot execute it, and authenticated users can only check their own subject through `auth.uid()`. This function does not expose the Founder registry or grant calling rights to every authenticated user.

22 local checks pass after the handoff and PCC control integration. Public source publication was approved and PR54 created. Twilio credentials, controlled destination, receipt database access, live provider entitlement, and witnessed inbound/outbound acceptance remain open.

Deployment preparation readback: a live Worker replacement was held by automatic approval review pending live acceptance. The safer inactive-version upload was attempted using the dedicated Worker Versions API; Cloudflare returned No access to the specified resource. Neither attempt deployed new code. Browser-render QA could not run because the browser executable was absent and its download failed; PCC control behavior was tested with a DOM harness instead.
