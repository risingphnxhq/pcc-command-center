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

The Edge Function is a two-operation interface:
1. `submit`: accept text/structured content and optional asset manifest, compute a canonical server-side SHA-256, and return a receipt. Text-only submissions enter `PENDING_PCC_TRIAGE`; assets enter `AWAITING_ASSET_UPLOAD`.
2. `finalize`: fetch uploaded objects from the private bucket, verify expected byte count, MIME, and SHA-256, then move the item to `PENDING_PCC_TRIAGE`. Integrity mismatch rejects the item.

Idempotency is scoped to authenticated subject and runtime lane. A reused key with a different payload hash is rejected. URLs supplied by callers are never fetched.

## Boundaries and dependencies

OpenAI GPT Actions can call external APIs, and ChatGPT supports attached file/image inputs, but those are distinct data paths. The Action submits JSON and returns signed upload instructions; a client capable of accessing and transferring actual binary bytes must perform the upload. A PCC browser uploader and per-GPT authorization setup remain follow-on integration tasks. No service-role secret or machine identity may be placed in a GPT.

## Verification / current state

Schema and function were deployed to Systems project `oyjmpbuxvfxusmbouldi` on 2026-11-02. Function reports ACTIVE, version 1, JWT verification enabled. Synthetic authenticated submit/replay and binary-integrity tests have not yet been run. No production certification is claimed.

## Next authorized build step

Build the PCC review/uploader surface that obtains a user session, presents the new intake queue and receipt, and transfers actual files to the signed private-storage URL. Then run synthetic authenticated submit, replay conflict, hash mismatch, and successful finalization checks. Keep all records held for PCC triage and do not enable production routing or publishing as part of those tests.
