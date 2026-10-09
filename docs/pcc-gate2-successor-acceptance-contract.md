# PCC Gate 2 — Server-verified successor acceptance contract (DRAFT)
Status: DESIGN ONLY / NOT DEPLOYED / NO ACK AUTHORIZED
Stream: ORG-PCC-006
Actor: RPE-MASON-HQ
BOAS: BOAS-ROOT-ORG-PCC-006
Build Control: PCC-BCR-PCC-RECONCILIATION-000001
Foreman: PCC-CSE-PSC-STREAM-FOREMAN-V0-PCC-CONSTRUCTION-CONTINUITY-2026-10-05-001

## Required server decision

An authenticated acceptance operation MUST:
1. Verify JWT on the server and resolve subject-to-actor binding; reject caller-selected actors.
2. Read authoritative institutional stream, BOAS, active workforce assignment, current Build Control/gate and controlling Foreman PSC from Systems Supabase.
3. Require Gate 2 IN_PROGRESS and the matching actor, stream and BOAS; fail closed on missing, stale, contradictory or unauthorized records.
4. Issue a short-lived, one-time server-side acceptance challenge bound to the authenticated subject, actor, PSC revision set, assignment, gate and session. A browser-stored boolean is not evidence.
5. Require successor-runtime evidence that the bounded continuity projection was actually received and acknowledged. A caller-provided hash, constant fingerprint, UI click or login event alone is insufficient.
6. Re-read authority and continuity state at commit time, atomically consume the challenge and commit the PSC-D receipt through the authenticated corridor with idempotency and optimistic version checks.
7. Persist provenance: subject, actor, stream, BOAS, build-control ID, gate, Foreman PSC, projection revision/digest computed server-side, challenge ID, verification outcome, time and immutable receipt ID.
8. Return a redacted receipt to the browser. Deny cross-actor ACK, replay, stale projection, expired challenge, missing evidence, Gate 3/4 authority escalation and absent authenticated successor.

## Non-authority
No new institutional stream, BOAS, or Neumata build authority.
No broad service-role client exposure.
No reuse of the legacy Bridge or client-supplied context fingerprint as verification.
No automatic ACK from login, page load or PSC-D reconciliation.

## Acceptance tests required before release
- Positive: independently evidenced successor runtime, current projection, authorized actor, one successful receipt.
- Negative: anonymous, mismatched JWT actor, stale gate, wrong BOAS, missing Foreman PSC, unproven context consumption, replayed challenge, duplicate ACK, expired challenge, forged fingerprint, missing workforce assignment, database failure/rollback.
- Regression: browser containment tests PASS; independent New Mason/CATE review; protected merge only after documented Gate 2 verification.

This contract is an engineering proposal. It does not assert that the backend endpoint, challenge store, cryptographic proof, or receipt exists.
