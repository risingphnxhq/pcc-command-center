# PCC GPT Creative Workspace Intake v1

PSC ID: PCC-CSE-PSC-GPT-CREATIVE-WORKSPACE-INGEST-2026-11-02-001  
Record class: Bounded implementation record; not a production certification  
System: PCC / Systems

## Mission

Enable authenticated GPT creative workspaces to submit writing and media provenance into PCC for governed triage. Supported content includes books, ads, reels, shorts, episodes, series, images, video, audio, documents, and concepts.

## Controlling principles

- GPT account/session is a replaceable computational lane, not an institutional actor or authority.
- PCC resolves the authenticated subject against active `pcc_institutional.auth_actor_bindings`. Actor and runtime lane are never accepted from request fields.
- Initial scope is the active Mason interactive lanes `PRIME_MASON_ACCOUNT` and `NEW_MASON_ACCOUNT` for `RPE-MASON-HQ`. Machine bindings are denied.
- Submission proves source receipt and integrity only. It does not approve, canonize, authorize execution, admit a render, route production, or publish.

## Implemented components

- Systems Edge Function `pcc-workspace-ingest-v1`, JWT verification enabled.
- Tables `public.pcc_workspace_intake_v1` and `public.pcc_workspace_intake_assets_v1`, RLS enabled and client roles revoked.
- Private Storage bucket `pcc-workspace-intake`.
- OpenAPI Action contract and operator documentation in PCC source.
- PCC page `workspace-intake.html`, linked from Systems Console, for file upload and one-time per-GPT key creation/listing/revocation.

The Edge Function is a two-operation interface:
1. `submit`: accept text/structured content and optional asset manifest, compute a canonical server-side SHA-256, and return a receipt. Text-only submissions enter `PENDING_PCC_TRIAGE`; assets enter `AWAITING_ASSET_UPLOAD`.
2. `finalize`: fetch uploaded objects from the private bucket, verify expected byte count, MIME, and SHA-256, then move the item to `PENDING_PCC_TRIAGE`. Integrity mismatch rejects the item.

Idempotency is scoped to authenticated subject and runtime lane. A reused key with a different payload hash is rejected. URLs supplied by callers are never fetched.

## Boundaries and dependencies

GPT Actions call the API with a dedicated Bearer key created in the PCC page; the operator must paste the one-time key into that GPT’s Action settings. A GPT Action does not transfer generated binary bytes by itself, so generated files must be available to the PCC browser uploader or another upload-capable client. No service-role secret or machine identity may be placed in a GPT.

## Verification / current state

Schema and function were deployed to Systems project `oyjmpbuxvfxusmbouldi` on 2026-11-02. Function reports ACTIVE, version 2. The Edge gateway JWT check is disabled because the function performs its own Supabase Auth validation and scoped-key verification. Schema/function deployment readback is complete; synthetic authenticated submit, key revocation, and binary tests have not yet been run. Synthetic authenticated submit/replay and binary-integrity tests have not yet been run. No production certification is claimed.

## Next authorized build step

Configure each GPT Action with a user-authorized token path. Then run synthetic authenticated submit, replay conflict, hash mismatch, and successful finalization checks. Build a PCC review queue that lists and adjudicates held submissions only through its own governed authority; keep production routing and publishing disabled. Keep all records held for PCC triage and do not enable production routing or publishing as part of those tests.
