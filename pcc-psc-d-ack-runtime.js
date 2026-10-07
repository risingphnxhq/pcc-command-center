(() => {
  "use strict";

  const PROJECT_URL = "https://oyjmpbuxvfxusmbouldi.supabase.co";
  const PUBLISHABLE_KEY = "sb_publishable_rwTE4QRlQkzr0R0f5t5ylA_a9zuj0eE";
  const FUNCTION_NAME = "pcc-workforce-sync-v1";
  const CONTINUITY_FUNCTION_NAME = "pcc-systems-read-v1";
  const ACTOR_ID = "RPE-MASON-HQ";

  if (!window.supabase) return;

  const client = window.supabase.createClient(PROJECT_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const $ = id => document.getElementById(id);

  function showState(text, bad = false) {
    const el = $("pscDState");
    if (!el) return;
    el.textContent = text;
    el.className = "status" + (bad ? " bad" : "");
  }

  function show(value) {
    const el = $("pscDOutput");
    if (el) el.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }

  async function session() {
    const { data: { session } } = await client.auth.getSession();
    if (!session?.access_token) throw new Error("AUTHENTICATED_SYSTEMS_SESSION_REQUIRED");
    return session;
  }

  async function pulse(pulseType, observedStateVersion, contextFingerprint) {
    const s = await session();
    const response = await fetch(`${PROJECT_URL}/functions/v1/${FUNCTION_NAME}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${s.access_token}`,
        apikey: PUBLISHABLE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        actor_id: ACTOR_ID,
        pulse_type: pulseType,
        observed_state_version: observedStateVersion,
        context_fingerprint: contextFingerprint || null
      }),
      cache: "no-store"
    });
    const body = await response.json().catch(() => ({ error: "INVALID_PSC_D_RESPONSE" }));
    if (!response.ok) throw Object.assign(new Error(body.error || `HTTP_${response.status}`), { body, status: response.status });
    return body;
  }

  async function continuity() {
    const s = await session();
    const response = await fetch(`${PROJECT_URL}/functions/v1/${CONTINUITY_FUNCTION_NAME}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${s.access_token}`,
        apikey: PUBLISHABLE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ scope: "CONTINUITY", limit: 25 }),
      cache: "no-store"
    });
    const body = await response.json().catch(() => ({ error: "INVALID_CONTINUITY_RESPONSE" }));
    if (!response.ok || !body?.ok) throw Object.assign(new Error(body?.error || `HTTP_${response.status}`), { body, status: response.status });
    if (body?.data?.continuity_state === "CONTEXT_REHYDRATION_REQUIRED") throw Object.assign(new Error("CONTEXT_REHYDRATION_REQUIRED"), { body });
    return body;
  }

  let automaticRecoveryInFlight = false;\n\n  async function reconcile() {
    showState("READING PCC CONTINUITY + AUTHORITATIVE PSC-D STATE");
    try {
      const continuityProjection = await continuity();
      const body = await pulse("MEMORY", 0, "PCC-STREAM-FOREMAN-V0-CONTINUITY-RECONCILED");
      show({ continuity: continuityProjection.data, psc_d: body });
      const version = Number(body?.synchronization?.state_version || 0);
      if (!version) throw new Error("PSC_D_STATE_VERSION_UNAVAILABLE");
      sessionStorage.setItem("pccPscDObservedStateVersion", String(version));
      sessionStorage.setItem("pccContinuityReconciled", "true");
      showState(body?.synchronization?.state === "REFRESH_REQUIRED"
        ? `REFRESH REQUIRED · AUTHORITATIVE STATE v${version}`
        : `PSC-D STATE v${version} · ${body?.synchronization?.state || "UNKNOWN"}`);
      const ack = $("pscDAckButton");
      if (ack) ack.disabled = false;
    } catch (error) {
      showState("PSC-D RECONCILIATION DENIED", true);
      show(error.body || { error: error.message });
    }
  }

  async function acknowledge() {
    if (sessionStorage.getItem("pccContinuityReconciled") !== "true") {
      showState("CONTINUITY RECONCILIATION REQUIRED BEFORE ACK", true);
      return;
    }
    const observed = Number(sessionStorage.getItem("pccPscDObservedStateVersion") || 0);
    if (!observed) {
      showState("RECONCILIATION REQUIRED BEFORE ACK", true);
      return;
    }
    showState("COMMITTING AUTHENTICATED PSC-D ACK");
    try {
      const body = await pulse("DEEP_REHYDRATION", observed, "PCC-STREAM-FOREMAN-V0-COLD-SUCCESSOR-REHYDRATED-2026-10-05");
      show(body);
      if (body?.synchronization?.state !== "SYNCHRONIZED") {
        showState(`ACK NOT SYNCHRONIZED · ${body?.synchronization?.state || "UNKNOWN"}`, true);
        return;
      }
      showState(`SYNCHRONIZED · STATE v${body.synchronization.state_version} · RECEIPT #${body?.receipt?.sync_receipt_id ?? "UNKNOWN"}`);
    } catch (error) {
      showState("PSC-D ACK DENIED", true);
      show(error.body || { error: error.message });
    }
  }

  $("pscDReconcileButton")?.addEventListener("click", reconcile);
  $("pscDAckButton")?.addEventListener("click", acknowledge);

  client.auth.onAuthStateChange((_event, s) => {
    if (!s) {
      sessionStorage.removeItem("pccPscDObservedStateVersion");
      sessionStorage.removeItem("pccContinuityReconciled");
      const ack = $("pscDAckButton");
      if (ack) ack.disabled = true;
      showState("AUTHENTICATED SYSTEMS SESSION REQUIRED");
    }
  });
})();