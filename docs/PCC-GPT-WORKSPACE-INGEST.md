# PCC GPT Creative Workspace Intake

Implementation record: `PCC-CSE-PSC-GPT-CREATIVE-WORKSPACE-INGEST-2026-11-02-001`.

- Systems project: `oyjmpbuxvfxusmbouldi`.
- Edge Function: `pcc-workspace-ingest-v1`, JWT verification enabled.
- Database migration: `supabase/migrations/20261102000100_pcc_gpt_workspace_ingest_v1.sql`.
- Action schema: `docs/openapi/pcc-gpt-creative-workspace-ingest-v1.yaml`.
- Binary objects use private bucket `pcc-workspace-intake`.

## Authentication and attribution

The caller sends a Supabase user access token. The function validates it through Supabase Auth and resolves the email against active `pcc_institutional.auth_actor_bindings`. The request body cannot set actor or runtime lane. Initial allowlist is `RPE-MASON-HQ` in the interactive `PRIME_MASON_ACCOUNT` or `NEW_MASON_ACCOUNT` lanes; machine identities are rejected.

## Text intake

POST JSON with `operation=submit`, an idempotency key, content kind, and title. Text, structured document data, intended system/channel, and source-conversation references are optional. The route computes a server-side canonical payload hash and returns a receipt in `PENDING_PCC_TRIAGE`.

Supported kinds: BOOK, AD, REEL, SHORT, EPISODE, SERIES, IMAGE, VIDEO, AUDIO, DOCUMENT, CONCEPT, OTHER.

## Binary assets

The request may include a manifest of up to 10 assets. Each has file name, MIME type, byte size, SHA-256, and optional role. The route returns an expiring signed upload URL. A client capable of transferring the actual file bytes uploads to private storage, then calls `operation=finalize`. PCC downloads only from its private bucket and verifies size, MIME, and SHA-256 before triage.

Limits: 250,000 characters of body text, 350,000 UTF-8 bytes for normalized JSON, 20 MiB per file, 50 MiB total. The function rejects unsupported MIME types.

**GPT Action limitation:** the Action schema submits JSON and a file manifest; it does not itself transmit a generated image/video binary. For binary GPT outputs, an uploader/client must transfer the actual file bytes to the signed URL. A PCC browser upload surface or an API client that can access the generated file is a follow-on integration. OpenAI’s current GPT documentation describes Actions as external API calls, while its file/image upload instructions describe attaching files to a ChatGPT conversation; those are separate flows.

## Approval and routing

Every submission is provenance only. It does not become canon, policy approval, execution authorization, render admission, or publish permission. There is no route/approve operation in this function. PCC review and target-system routing are separate governed work.

## GPT Action configuration

Import the OpenAPI file into a GPT Action. Configure authentication so the request presents a user Supabase access token recognized by Systems. This is a per-GPT configuration step. Never place a Supabase service-role key or machine credential in a GPT.
