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

  function positiveInteger(value) {
    if (typeof value === "string" && !/^[1-9][0-9]*$/.test(value)) return null;
    if (typeof value !== "string" && typeof value !== "number") return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }

  function clearReconciliation() {
    sessionStorage.removeItem("pccPscDObservedStateVersion");
    sessionStorage.removeItem("pccContinuityReconciled");
    const ack = $("pscDAckButton");
    if (ack) ack.disabled = true;
  }

  async function session() {
    const { data: { session } } = await client.auth.getSession();
    if (!session?.access_token) throw new Error("AUTHENTICATED_SYSTEMS_SESSION_REQUIRED");
    return session;
  }

  async function pulse(pulseType, observedStateVersion, contextFingerprint, action) {
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
        ...(action ? { action } : {}),
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

  let automaticRecoveryInFlight = false;

  async function reconcile() {
    clearReconciliation();
    showState("READING PCC CONTINUITY + AUTHORITATIVE PSC-D STATE");
    try {
      const continuityProjection = await continuity();
      const body = await pulse("MEMORY", 0, null, "READ");
      show({ continuity: continuityProjection.data, psc_d: body });
      const version = positiveInteger(body?.synchronization?.state_version);
      if (!version) throw new Error("PSC_D_STATE_VERSION_UNAVAILABLE");
      sessionStorage.setItem("pccPscDObservedStateVersion", String(version));
      sessionStorage.setItem("pccContinuityReconciled", "true");
      showState(body?.synchronization?.state === "REFRESH_REQUIRED"
        ? `REFRESH REQUIRED · AUTHORITATIVE STATE v${version}`
        : `PSC-D STATE v${version} · ${body?.synchronization?.state || "UNKNOWN"}`);
      const ack = $("pscDAckButton");
      if (ack) ack.disabled = false;
    } catch (error) {
      clearReconciliation();
      showState("PSC-D RECONCILIATION DENIED", true);
      show(error.body || { error: error.message });
    }
  }

  async function acknowledge() {
    if (sessionStorage.getItem("pccContinuityReconciled") !== "true") {
      showState("CONTINUITY RECONCILIATION REQUIRED BEFORE ACK", true);
      return;
    }
    const observed = positiveInteger(sessionStorage.getItem("pccPscDObservedStateVersion"));
    if (!observed) {
      showState("RECONCILIATION REQUIRED BEFORE ACK", true);
      return;
    }
    showState("COMMITTING AUTHENTICATED PSC-D ACK");
    try {
      const body = await pulse("DEEP_REHYDRATION", observed, "PCC-PSC-D-USER-ACK-NOT-GPT-COGNITIVE-ACK");
      show(body);
      if (body?.synchronization?.state !== "SYNCHRONIZED") {
        showState(`ACK NOT SYNCHRONIZED · ${body?.synchronization?.state || "UNKNOWN"}`, true);
        return;
      }
      const receiptId = positiveInteger(body?.receipt?.sync_receipt_id);
      const stateVersion = positiveInteger(body?.synchronization?.state_version);
      const due = Date.parse(body?.synchronization?.next_memory_sync_due_at || "");
      if (!receiptId || stateVersion !== observed || !Number.isFinite(due) || due <= Date.now()) {
        clearReconciliation();
        throw new Error("PSC_D_DURABLE_RECEIPT_OR_FRESH_STATE_REQUIRED");
      }
      showState(`PSC-D TRANSPORT ACK · STATE v${stateVersion} · RECEIPT #${receiptId} · GPT consumption not certified`);
    } catch (error) {
      clearReconciliation();
      showState("PSC-D ACK DENIED", true);
      show(error.body || { error: error.message });
    }
  }

  async function runContinuityAcceptance() {
    showState("RUNNING PCC CONTINUITY ACCEPTANCE");
    sessionStorage.removeItem("pccContinuityReconciled");
    sessionStorage.removeItem("pccPscDObservedStateVersion");
    await reconcile();
    if (sessionStorage.getItem("pccContinuityReconciled") !== "true") return;
    showState("PROJECTION LOADED · READ GOVERNING CANON BEFORE EXPLICIT ACK");
  }

  async function recoverContinuityAutomatically() {
    if (automaticRecoveryInFlight) return;
    automaticRecoveryInFlight = true;
    try {
      showState("PCC RECOVERING INSTITUTIONAL CONTINUITY");
      await reconcile();
    } finally {
      automaticRecoveryInFlight = false;
    }
  }

  let freshnessReadInFlight = false;
  let authEpoch = 0;
  async function inspectFreshness() {
    if (freshnessReadInFlight) return;
    freshnessReadInFlight = true;
    const epoch = authEpoch;
    try {
      const body = await pulse("MEMORY", 0, null, "READ");
      if (epoch !== authEpoch) return;
      const sync = body.synchronization;
      const current = positiveInteger(sync?.state_version);
      const observed = positiveInteger(sessionStorage.getItem("pccPscDObservedStateVersion"));
      if (sync?.evaluated_state !== "SYNCHRONIZED" || !current || (observed && current !== observed)) {
        clearReconciliation();
        showState("PSC-D REHYDRATION REQUIRED · Last ACK: " + (sync?.last_memory_sync_at || "never"), true);
        window.dispatchEvent(new CustomEvent("pcc:psc-d-stale", { detail: { actor_id: ACTOR_ID, state: sync?.evaluated_state || "STATE_UNVERIFIED" } }));
      } else {
        showState("PSC-D TRANSPORT CURRENT · Last ACK: " + sync.last_memory_sync_at + " · Due: " + sync.next_memory_sync_due_at + " · GPT consumption not certified");
      }
    } catch (error) {
      if (epoch !== authEpoch) return;
      clearReconciliation();
      showState("PSC-D STATE UNVERIFIED · authenticated recovery required", true);
    } finally { freshnessReadInFlight = false; }
  }
  // Read-only freshness inspection. Never renews cognitive synchronization.
  setInterval(inspectFreshness, 60000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") inspectFreshness();
  });
  window.addEventListener("online", inspectFreshness);

  $("pscDRunAcceptanceButton")?.addEventListener("click", runContinuityAcceptance);
  $("pscDReconcileButton")?.addEventListener("click", reconcile);
  $("pscDAckButton")?.addEventListener("click", acknowledge);
  window.addEventListener("pcc:systems-runtime-verified", recoverContinuityAutomatically);

  client.auth.onAuthStateChange((_event, s) => {
    authEpoch++;
    const acceptance = $("pscDRunAcceptanceButton");
    if (acceptance) acceptance.disabled = !s;
    if (!s) {
      sessionStorage.removeItem("pccPscDObservedStateVersion");
      sessionStorage.removeItem("pccContinuityReconciled");
      const ack = $("pscDAckButton");
      if (ack) ack.disabled = true;
      showState("AUTHENTICATED SYSTEMS SESSION REQUIRED");
    }
  });
})();