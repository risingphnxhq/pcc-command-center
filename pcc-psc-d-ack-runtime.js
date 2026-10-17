(() => {
  "use strict";

  const PROJECT_URL = "https://oyjmpbuxvfxusmbouldi.supabase.co";
  const PUBLISHABLE_KEY = "sb_publishable_rwTE4QRlQkzr0R0f5t5ylA_a9zuj0eE";
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

  // Gate 2 containment: continuity recovery is read-only. A browser flag or
  // successful login is not evidence that a successor consumed PCC context.
  let automaticRecoveryInFlight = false;

  async function reconcile() {
    showState("READING AUTHENTICATED PCC CONTINUITY");
    const ack = $("pscDAckButton");
    if (ack) ack.disabled = true;
    try {
      const projection = await continuity();
      const data = projection.data || {};
      const valid = projection.actor_id === ACTOR_ID &&
        data.foreman?.psc_id === "PCC-CSE-PSC-STREAM-FOREMAN-V0-PCC-CONSTRUCTION-CONTINUITY-2026-10-05-001" &&
        data.stream?.system_stream_id === "ORG-PCC-006" &&
        data.boas?.boas_root_id === "BOAS-ROOT-ORG-PCC-006" &&
        data.build_control?.build_control_id === "PCC-BCR-PCC-RECONCILIATION-000001" &&
        data.psc_d?.actor_id === ACTOR_ID &&
        data.build_control?.build_owner_actor_id === ACTOR_ID &&
        data.build_control?.system_stream_id === "ORG-PCC-006" &&
        data.build_control?.boas_root_id === "BOAS-ROOT-ORG-PCC-006" &&
        data.boas?.system_stream_id === "ORG-PCC-006" &&
        data.boas?.build_control_id === "PCC-BCR-PCC-RECONCILIATION-000001" &&
        data.foreman?.canon_state === "CONTROLLING" &&
        Array.isArray(data.gates) &&
        data.gates.some(g => g.gate_code === "2" && g.state === "IN_PROGRESS");
      if (!valid) throw Object.assign(new Error("PCC_CONTINUITY_IDENTITY_MISMATCH"), { body: projection });
      show({ continuity: data, acceptance: "NOT_CERTIFIED", mutation: "HOLD" });
      showState("CONTEXT RETRIEVED · SUCCESSOR ACCEPTANCE NOT CERTIFIED");
    } catch (error) {
      showState("CONTEXT_REHYDRATION_REQUIRED", true);
      show(error.body || { error: error.message });
    }
  }

  function acknowledge() {
    showState("ACK BLOCKED · SERVER-VERIFIED SUCCESSOR ACCEPTANCE REQUIRED", true);
    show({ error: "SUCCESSOR_ACCEPTANCE_NOT_IMPLEMENTED", mutation: "HOLD" });
  }

  async function recoverContinuityAutomatically() {
    if (automaticRecoveryInFlight) return;
    automaticRecoveryInFlight = true;
    try { await reconcile(); }
    finally { automaticRecoveryInFlight = false; }
  }

  $("pscDRunAcceptanceButton")?.addEventListener("click", reconcile);
  $("pscDReconcileButton")?.addEventListener("click", reconcile);
  $("pscDAckButton")?.addEventListener("click", acknowledge);
  window.addEventListener("pcc:systems-runtime-verified", recoverContinuityAutomatically);

  client.auth.onAuthStateChange((_event, s) => {
    const acceptance = $("pscDRunAcceptanceButton");
    if (acceptance) acceptance.disabled = !s;
    if (!s) {

      const ack = $("pscDAckButton");
      if (ack) ack.disabled = true;
      showState("AUTHENTICATED SYSTEMS SESSION REQUIRED");
    }
  });
})();