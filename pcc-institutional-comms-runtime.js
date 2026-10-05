(() => {
  "use strict";

  const PROJECT_URL = "https://oyjmpbuxvfxusmbouldi.supabase.co";
  const PUBLISHABLE_KEY = "sb_publishable_rwTE4QRlQkzr0R0f5t5ylA_a9zuj0eE";
  const FUNCTION_NAME = "pcc-institutional-comms-v1";

  if (!window.supabase) return;

  const client = window.supabase.createClient(PROJECT_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const $ = id => document.getElementById(id);
  const allowed = new Set(["INBOX", "READ", "SEND", "ACKNOWLEDGE", "REPLY"]);

  function show(value) {
    const el = $("pscCOutput");
    if (el) el.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }

  function setState(text, bad = false) {
    const el = $("pscCState");
    if (!el) return;
    el.textContent = text;
    el.className = "status" + (bad ? " bad" : "");
  }

  async function invoke(action, input = {}) {
    const normalized = String(action || "").toUpperCase();
    if (!allowed.has(normalized)) throw new Error("PSC_C_ACTION_NOT_ALLOWED");

    const { data: { session } } = await client.auth.getSession();
    if (!session?.access_token) throw new Error("AUTHENTICATED_SYSTEMS_SESSION_REQUIRED");

    const response = await fetch(`${PROJECT_URL}/functions/v1/${FUNCTION_NAME}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: PUBLISHABLE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action: normalized, input }),
      cache: "no-store"
    });

    const body = await response.json().catch(() => ({ error: "INVALID_PSC_C_RESPONSE" }));
    if (!response.ok || !body.ok) {
      throw Object.assign(new Error(body.error || `HTTP_${response.status}`), { body, status: response.status });
    }
    return body;
  }

  async function execute() {
    const action = $("pscCAction")?.value || "INBOX";
    let input = {};
    try {
      input = JSON.parse($("pscCInput")?.value || "{}");
    } catch {
      setState("PSC-C INPUT INVALID", true);
      show({ ok: false, error: "INPUT_MUST_BE_VALID_JSON" });
      return;
    }

    setState(`PSC-C ${action} IN PROGRESS`);
    try {
      const body = await invoke(action, input);
      show(body);
      setState(`PSC-C ${action} VERIFIED`);
    } catch (error) {
      setState(`PSC-C ${action} DENIED`, true);
      show(error.body || { ok: false, error: error.message });
    }
  }

  $("pscCExecute")?.addEventListener("click", execute);
  $("pscCInbox")?.addEventListener("click", async () => {
    if ($("pscCAction")) $("pscCAction").value = "INBOX";
    if ($("pscCInput")) $("pscCInput").value = "{}";
    await execute();
  });

  // Foreman V0: one bounded continuity message per authenticated browser session.
  // This is ordinary institutional communication; it does not assert PSC-D synchronization.
  const FOREMAN_SEND_KEY = "pcc.foreman.continuity.sent.v1";
  async function sendForemanContinuityOnce() {
    if (sessionStorage.getItem(FOREMAN_SEND_KEY) === "1") return;
    const input = {
      recipient_stream_code: "RPE_HQ_SYSTEMS_BRIDGE_ENGINEERING_ENDPOINT",
      message_class: "OPERATIONS",
      subject: "PCC Construction Continuity",
      payload: {
        message: "Continue the current PCC build. Before making changes, review the current PCC construction record and Stream Foreman record, establish the current Build Control position, completed work, blockers, and next authorized action, then continue from that position. If the records conflict, hold changes and reconcile first.",
        stream_id: "ORG-PCC-006",
        boas_root: "BOAS-ROOT-ORG-PCC-006",
        build_control_id: "PCC-BCR-PCC-RECONCILIATION-000001"
      },
      related_psc_ids: ["PCC-CSE-PSC-STREAM-FOREMAN-V0-PCC-CONSTRUCTION-CONTINUITY-2026-10-05-001"],
      priority: "NORMAL",
      severity: "NONE",
      response_required: false,
      idempotency_key: "PCC-FOREMAN-V0-CONTINUITY-ORG-PCC-006"
    };
    try {
      await invoke("SEND", input);
      sessionStorage.setItem(FOREMAN_SEND_KEY, "1");
    } catch (error) {
      // Fail closed: leave unsent marker absent so a later authenticated load can retry.
      console.warn("PCC_FOREMAN_CONTINUITY_SEND_DENIED", error?.message || error);
    }
  }

  client.auth.onAuthStateChange((_event, session) => {
    const controls = [$("pscCExecute"), $("pscCInbox")].filter(Boolean);
    controls.forEach(el => { el.disabled = !session; });
    if (!session) setState("AUTHENTICATED SYSTEMS SESSION REQUIRED");
  });

  client.auth.getSession().then(({ data }) => {
    const ready = Boolean(data.session);
    [$("pscCExecute"), $("pscCInbox")].filter(Boolean).forEach(el => { el.disabled = !ready; });
    setState(ready ? "AUTHENTICATED SESSION AVAILABLE · PSC-C READY" : "AUTHENTICATED SYSTEMS SESSION REQUIRED");\n    if (ready) void sendForemanContinuityOnce();
  });
})();
