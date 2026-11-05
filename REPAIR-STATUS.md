# Existing PSC-D OAuth repair — pending configuration

Confirmed failure: desktop client rejects remote plugin API-key authentication before invoking the endpoint. v1.0.0 registration is not operational acceptance.

Existing Systems Auth discovery at `https://oyjmpbuxvfxusmbouldi.supabase.co/.well-known/oauth-authorization-server/auth/v1` returned HTTP 404, error_code feature_disabled, OAuth server is disabled.

Prepared consent source uses pinned supabase-js 2.119.0 and the existing Systems project and publishable key. It validates the user through Auth, compares authorization user identity, displays server-reported application/client/callback/scopes as text, requires an explicit choice, suppresses SDK redirects until the choice response is validated, and invalidates controls on sign-out. Syntax checked. This is pending source, not a deployed or accepted OAuth connection.

Next prerequisite: project administrator enables OAuth Server under Authentication in the existing Systems project. Do not enable public dynamic client registration or change signing keys, Site URL, existing credentials, bindings, authority, unrelated policies or holds as part of that one switch.

Before activation: inspect the actual enabled discovery metadata and Site URL; deploy the consent UI at its configured authorization path; register the supported ChatGPT OAuth client/callbacks; validate issuer, signature, expiry, client_id, audience and current grants; pin each runtime office to a server-side verified binding; preserve per-connection acknowledgment/freshness isolation and revocation. Audit OAuth-token access to other existing APIs/RLS. Update the same private plugin with guarded release identity only after the OAuth service path is viable. Do not replace API-key auth with unauthenticated tool access.

Remaining verification: expired/replayed authorization, PKCE and callback restrictions, wrong client/user/office, revoked grant/binding/authority, stale/changed context, full-context retrieval, actual ACK receipt, fresh-stream continuation and independent acceptance for each of the four roles across three accounts. No new acknowledgment or activation claimed.
