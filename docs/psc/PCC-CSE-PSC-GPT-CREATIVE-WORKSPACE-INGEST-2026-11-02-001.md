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
- Submission proves source receipt and integrity. PCC now resolves a held producer/viewing route plan, but that plan does not approve, canonize, authorize execution, admit a render, create a producer job, or publish.

## Implemented components

- Systems Edge Function `pcc-workspace-ingest-v1`, gateway JWT verification disabled; the function verifies Supabase user JWTs or scoped hashed GPT Action keys itself.
- Tables `public.pcc_workspace_intake_v1` and `public.pcc_workspace_intake_assets_v1`, RLS enabled and client roles revoked.
- Private Storage bucket `pcc-workspace-intake`.
- OpenAPI Action contract and operator documentation in PCC source.
- PCC page `workspace-intake.html`, linked from Systems Console, for file upload and one-time per-GPT key creation/listing/revocation.

The Edge Function supports these operations:
- `submit`: accept text/structured content and optional asset manifest, compute a canonical server-side SHA-256, resolve the producer and explicit viewing-placement route, and return the combined receipt. Text-only submissions enter `PENDING_PCC_TRIAGE`; assets enter `AWAITING_ASSET_UPLOAD`.
- `finalize`: fetch uploaded objects from the private bucket, verify expected byte count, MIME, and SHA-256, then move the item to `PENDING_PCC_TRIAGE`. Integrity mismatch rejects the item.
- `create_action_key`, `list_action_keys`, and `revoke_action_key`: manage scoped, one-time-displayed GPT Action keys.

Idempotency is scoped to authenticated subject and runtime lane. A reused key with a different payload hash is rejected. URLs supplied by callers are never fetched.

## Boundaries and dependencies

GPT Actions call the API with a dedicated Bearer key created in the PCC page; the operator must paste the one-time key into that GPT’s Action settings. A GPT Action does not transfer generated binary bytes by itself, so generated files must be available to the PCC browser uploader or another upload-capable client. No service-role secret or machine identity may be placed in a GPT.


## Producer and viewing route contract

- Route contract pcc-output-route-v1 records content kind, requested operation, producer chain, destination, placement format, viewer surface, required gates, and fail-closed reasons in receipt.route_resolution.
- Script production identifies the Playwright (PCC) as writer and BOAS/KNOAS as Director in the producer chain. PHNX Phanimation SERIES / EPISODE maps to the PSN catalog viewer https://risingphnxhq.github.io/phnx-phanimation/. Episode profile is 1,500 seconds; PSN certificate, entitlement, and approved release remain required.
- Phoenix Kids episodes selected for the PHNX Kids YouTube channel map through SPIDER. The profile records 180–300 seconds; its connection is revalidated at execution and release stays held.
- Explicitly selected YouTube channel keys are limited to the PSC channel inventory. A selected account is not proof of a current connection or publishing permission.
- Ads, reels, shorts, video, image, audio, book, concept, and document kinds are recognized. Destinations without a PSC-backed producer/viewer mapping return BLOCKED; no channel or store is inferred from free text.
- The route receipt is a plan, not dispatch: execution_eligible and publication_eligible remain false. Producer-job creation, reviewer/approval adjudication, and dispatch to additional platforms are still unbuilt.

## Current build checkpoint — 2026-11-02

- Direct PCC source commits: 6ea5efefddeb1e0e913222f34a6f5316d7678ab6, 9b175e1efb372d9c432d321b768688c32e86debb, cc2982f295dca493a914545836bd9b1e2f627161, 1ca988156f15e4c4beeedd44820d325412ec4d9b, fb3f1b13119897b0e70e64f02861f684f2d18bb7, eab20c306ae0dbe5c647570f9321966bf8a36b80, 1526da4694b52d225317475fb28cacbf5be25611, c4c64cfc3fa412df24cd852988f03750e48e95ae, d43751c874545b65f8a74382e0ed9e9a0fbacfc0, c332884a002fc17fb35405afc924f11aae50577e, fb58775e0ce77457110cfa797351d379f5ec7a40.
- Systems Edge Function pcc-workspace-ingest-v1 is active at version 5 with the route resolver deployed.
- Synthetic resolver matrix: 9/9 cases passed in current source (PSN episode, Kids episode, missing placement, unknown channel/platform, book destination block, classification block, and multi-destination producer chain). The committed Node test workflow is set to run on direct pushes; authenticated intake/asset end-to-end tests have not been run.
- Existing intake records remain unreviewed and non-executable. This build does not automatically sync every GPT message, create producer jobs, render, or publish.

## Verification / current state

Schema and function were deployed to Systems project `oyjmpbuxvfxusmbouldi` on 2026-11-02. Function reports ACTIVE, version 4. Schema/function deployment readback is complete; synthetic resolver tests are recorded above. Authenticated submit/replay, key revocation, browser asset upload, and binary-integrity end-to-end tests have not yet been run. No production certification is claimed.

## Next authorized build step

Build the governed producer dispatcher and PCC review/adjudication path so an approved route can create the exact downstream job and return its ID plus placement receipt. Add PSC-backed routes for remaining output/platform combinations, including book viewing/storage and non-YouTube social placements; unknown mappings stay blocked. Then run authenticated submit/replay, asset integrity, producer receipt, policy gate, and full synthetic workflow checks. Keep rendering and publication behind the existing admission, review, and release gates.
