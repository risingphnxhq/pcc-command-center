# PCC Governed Migration Executor V1

State: SOURCE CONTRACT / NOT DEPLOYED
Authority: Phoenix OS System Building Protocol V2 + PCC Build Control
Target project: Systems Supabase only (oyjmpbuxvfxusmbouldi)

## Purpose
Apply a reviewed database migration only after PCC Build Control has admitted the system/version and opened the authorized build gate. This executor is infrastructure mutation authority; it is not an AI workforce lane and does not accept arbitrary conversational SQL.

## Required request
- build_control_id
- gate_code
- migration_name
- artifact_path
- artifact_sha256
- expected_project_id
- idempotency_key

## Fail-closed gates
1. Valid authenticated Supabase user.
2. Exact Prime Mason runtime subject and active RPE-MASON-HQ binding.
3. expected_project_id must equal oyjmpbuxvfxusmbouldi.
4. Build Control record must exist and be authorized for mutation.
5. Gate must be open and permit BUILD_AND_INTEGRATE infrastructure mutation.
6. Artifact must be a repository-reviewed migration bound to the Build Control evidence ledger.
7. Submitted SHA-256 must match the approved artifact.
8. Migration name/idempotency key must not have a prior successful execution.
9. Executor accepts no arbitrary SQL body from the client.
10. Any mismatch returns DENIED and performs no mutation.

## Execution corridor
BUILD CONTROL AUTHORIZATION
→ REVIEWED MIGRATION ARTIFACT
→ ARTIFACT HASH VERIFICATION
→ PRIVILEGED MIGRATION EXECUTOR
→ SUPABASE MIGRATION
→ FUNCTION/SCHEMA READBACK
→ SECURITY + NEGATIVE CONTROL
→ BUILD CONTROL EVIDENCE
→ EXECUTION RECEIPT

## Separation law
pcc-agent-invoker-v1 remains non-infrastructure. Do not add database mutation authority to the AI agent lane.

## Current first target
supabase/migrations/20261003_pcc_register_system_stream_v1.sql

## Acceptance
V1 is not operational until:
- privileged deployment mechanism exists,
- executor is deployed with JWT verification,
- negative authorization tests pass,
- first migration is applied through the executor,
- pcc_register_system_stream_v1 is physically read back,
- receipt/evidence is recorded.
