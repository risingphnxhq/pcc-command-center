(() => {
  "use strict";
  const PROJECT_URL = "https://oyjmpbuxvfxusmbouldi.supabase.co";
  const PUBLISHABLE_KEY = "sb_publishable_rwTE4QRlQkzr0R0f5t5ylA_a9zuj0eE";
  const FUNCTION_NAME = "pcc-workforce-adapter-v1";
  const client = window.supabase.createClient(PROJECT_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const $ = id => document.getElementById(id);
  const output = $("output");
  const runtimeStatus = $("runtimeStatus");
  const loginForm = $("loginForm");
  const sessionPanel = $("sessionPanel");
  const gated = [...document.querySelectorAll("#designForm button, #executeAction, #refreshWork")];

  function show(value) {
    output.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }
  function setReady(ready, text, bad = false) {
    runtimeStatus.textContent = text;
    runtimeStatus.className = "status" + (ready ? " ok" : bad ? " bad" : "");
    gated.forEach(el => el.disabled = !ready);
  }
  async function invoke(action, payload = {}) {
    const { data: { session } } = await client.auth.getSession();
    if (!session?.access_token) throw new Error("AUTHENTICATED_SESSION_REQUIRED");
    const response = await fetch(`${PROJECT_URL}/functions/v1/${FUNCTION_NAME}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${session.access_token}`,
        "apikey": PUBLISHABLE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action, payload }),
      cache: "no-store"
    });
    const body = await response.json().catch(() => ({ error: "INVALID_ADAPTER_RESPONSE" }));
    if (!response.ok || !body.ok) throw Object.assign(new Error(body.error || `HTTP_${response.status}`), { body, status: response.status });
    return body;
  }
  async function verifyRuntime() {
    setReady(false, "VERIFYING MASON RUNTIME");
    try {
      const body = await invoke("HEALTH", {});
      $("actor").textContent = body.result.actor_id;
      setReady(true, "MASON RUNTIME VERIFIED");
      $("authMessage").textContent = "PCC adapter accepted this authenticated subject.";
      show(body);
      await refreshWork();
    } catch (error) {
      setReady(false, "IDENTITY GATE DENIED", true);
      $("authMessage").textContent = error.message;
      show(error.body || { ok: false, error: error.message });
    }
  }
  async function applySession(session) {
    if (!session) {
      loginForm.classList.remove("hidden");
      sessionPanel.classList.add("hidden");
      $("subject").textContent = "";
      $("actor").textContent = "Pending adapter verification";
      setReady(false, "AUTHENTICATION REQUIRED");
      return;
    }
    loginForm.classList.add("hidden");
    sessionPanel.classList.remove("hidden");
    $("subject").textContent = session.user.id;
    await verifyRuntime();
  }
  async function refreshWork() {
    try {
      const body = await invoke("LIST_OPEN_WORK", {});
      const orders = body.result.work_orders || [];
      $("workList").innerHTML = orders.length ? orders.map(w => `<article class="work"><div class="label">${escapeHtml(w.workforce_role)} · ${escapeHtml(w.status)}</div><strong>${escapeHtml(w.title)}</strong><small>${escapeHtml(w.work_order_id)}<br>${escapeHtml(w.workforce_stream_id || "")}</small></article>`).join("") : '<div class="help">No open workforce assignments.</div>';
    } catch (error) {
      $("workList").innerHTML = `<div class="help">Retrieval blocked: ${escapeHtml(error.message)}</div>`;
    }
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }

  loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    setReady(false, "AUTHENTICATING");
    $("authMessage").textContent = "";
    const { error } = await client.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value });
    $("password").value = "";
    if (error) { setReady(false, "AUTHENTICATION FAILED", true); $("authMessage").textContent = error.message; }
  });
  $("signOutButton").addEventListener("click", () => client.auth.signOut());
  $("healthButton").addEventListener("click", verifyRuntime);
  $("refreshWork").addEventListener("click", refreshWork);
  $("clearOutput").addEventListener("click", () => show("No operation executed."));
  $("designForm").addEventListener("submit", async event => {
    event.preventDefault();
    const payload = {
      account_lane: $("accountLane").value,
      project_name: $("projectName").value.trim(),
      target_system: $("targetSystem").value.trim(),
      visible_label: $("visibleLabel").value.trim() || undefined,
      controlling_psc_ids: $("pscIds").value.split(",").map(v => v.trim()).filter(Boolean)
    };
    try { show(await invoke("REGISTER_DESIGN_STREAM", payload)); await refreshWork(); }
    catch (error) { show(error.body || { ok:false,error:error.message }); }
  });
  $("executeAction").addEventListener("click", async () => {
    let payload;
    try { payload = JSON.parse($("payload").value || "{}"); }
    catch { show({ ok:false,error:"PAYLOAD_MUST_BE_VALID_JSON" }); return; }
    try { const body = await invoke($("action").value, payload); show(body); await refreshWork(); }
    catch (error) { show(error.body || { ok:false,error:error.message }); }
  });
  client.auth.onAuthStateChange((_event, session) => setTimeout(() => applySession(session), 0));
  client.auth.getSession().then(({ data }) => applySession(data.session));
})();