# PCC GPT Creative Workspace Intake

Implementation record: `PCC-CSE-PSC-GPT-CREATIVE-WORKSPACE-INGEST-2026-11-02-001`.

- Systems project: `oyjmpbuxvfxusmbouldi`.
- Edge Function: `pcc-workspace-ingest-v1`, JWT verification enabled.
- Database migration: `supabase/migrations/20261102000100_pcc_gpt_workspace_ingest_v1.sql`.
- Action schema: `docs/openapi/pcc-gpt-creative-workspace-ingest-v1.yaml`.
- Binary objects use private bucket `pcc-workspace-intake`.

## Authentication and attribution

PCC sign-in validates a Supabase user token through Supabase Auth and resolves the email against active `pcc_institutional.auth_actor_bindings`. The request body cannot set actor or runtime lane. Initial allowlist is `RPE-MASON-HQ` in the interactive `PRIME_MASON_ACCOUNT` or `NEW_MASON_ACCOUNT` lanes; machine identities are rejected. Each GPT may use a dedicated `pccwi_` key issued by this authenticated PCC page. The function stores only the SHA-256 hash, expires keys after 90 days, rechecks the source actor binding on each call, and lets the operator list/revoke keys. An Action key cannot create or revoke keys and has intake-only scope.

## Text intake

POST JSON with `operation=submit`, an idempotency key, content kind, and title. Text, structured document data, intended system/channel, and source-conversation references are optional. The route computes a server-side canonical payload hash and returns a receipt in `PENDING_PCC_TRIAGE`.

Supported kinds: BOOK, AD, REEL, SHORT, EPISODE, SERIES, IMAGE, VIDEO, AUDIO, DOCUMENT, CONCEPT, OTHER.

## Binary assets

The request may include a manifest of up to 10 assets. Each has file name, MIME type, byte size, SHA-256, and optional role. The route returns an expiring signed upload URL. A client capable of transferring the actual file bytes uploads to private storage, then calls `operation=finalize`. PCC downloads only from its private bucket and verifies size, MIME, and SHA-256 before triage.

Limits: 250,000 characters of body text, 350,000 UTF-8 bytes for normalized JSON, 20 MiB per file, 50 MiB total. The function rejects unsupported MIME types.

**GPT Action limitation:** the Action schema submits JSON and a file manifest; it does not itself transmit a generated image/video binary. For binary GPT outputs, an uploader/client must transfer the actual file bytes to the signed URL. A PCC browser upload surface is implemented at `workspace-intake.html`, linked from Systems Console. It accepts text and local files and uploads media to the signed private-storage URL. A GPT Action still cannot transfer an image/video binary by itself; a generated file must be accessible to that browser/client for upload. OpenAI’s current GPT documentation describes Actions as external API calls, while its file/image upload instructions describe attaching files to a ChatGPT conversation; those are separate flows.


## PCC triage review

The authenticated Systems workspace has a PCC triage panel for direct, signed-in Prime Mason sessions with the active `RPE-CSE` verification assignment. GPT Action keys cannot review. Decisions (`ACCEPTED`, `NEEDS_CHANGES`, `DECLINED`) are recorded in an append-only review receipt table. Acceptance is triage-only: `approved_for_execution` and `execution_eligible` remain false. No producer job is created by review.

Review events are service-only with RLS enabled, and the decision RPC is executable only by `service_role`. Migration/checkpoint details are in `docs/psc/PCC-CSE-PSC-GPT-CREATIVE-WORKSPACE-TRIAGE-REVIEW-2026-11-02-001.md`.

## Approval and routing

Every submission is provenance only. It does not become canon, policy approval, execution authorization, render admission, or publish permission. There is no route/approve operation in this function. PCC review and target-system routing are separate governed work.

## GPT Action configuration

Import the OpenAPI file into a GPT Action. Configure API Key authentication with Bearer and paste the `pccwi_` key issued for that specific GPT. A user must still make this per-GPT setting change. Never place a Supabase access token, service-role key, or machine credential in a GPT.
