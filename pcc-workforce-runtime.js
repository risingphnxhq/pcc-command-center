(() => {
  "use strict";
  const PROJECT_URL = "https://oyjmpbuxvfxusmbouldi.supabase.co";
  const PUBLISHABLE_KEY = "sb_publishable_rwTE4QRlQkzr0R0f5t5ylA_a9zuj0eE";
  const FUNCTION_NAME = "pcc-workforce-adapter-v1";
  const AGENT_INVOKER_NAME = "pcc-agent-invoker-v1";
  const client = window.supabase.createClient(PROJECT_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const $ = id => document.getElementById(id);
  const output = $("output");
  const runtimeStatus = $("runtimeStatus");
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
  async function invokeAgent(action, input = {}) {
    const { data: { session } } = await client.auth.getSession();
    if (!session?.access_token) throw new Error("AUTHENTICATED_SESSION_REQUIRED");
    const response = await fetch(`${PROJECT_URL}/functions/v1/${AGENT_INVOKER_NAME}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${session.access_token}`,
        "apikey": PUBLISHABLE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action, ...input }),
      cache: "no-store"
    });
    const body = await response.json().catch(() => ({ error: "INVALID_AGENT_INVOKER_RESPONSE" }));
    if (!response.ok || !body.ok) throw Object.assign(new Error(body.error || `HTTP_${response.status}`), { body, status: response.status });
    return body;
  }
  async function verifyRuntime() {
    setReady(false, "VERIFYING MASON RUNTIME");
    try {
      const { data: { session } } = await client.auth.getSession();
      if (!session?.user?.id) throw new Error("AUTHENTICATED_SESSION_REQUIRED");
      const body = await invoke("HEALTH", {});
      if (body.authenticated_subject !== session.user.id) throw new Error("SESSION_SUBJECT_MISMATCH");
      $("actor").textContent = body.result.actor_id;
      $("runtimeLane").textContent = body.result.runtime_lane || body.runtime_lane || "INSTITUTIONAL";
      if ($("accountLane") && (body.result.runtime_lane || body.runtime_lane)) $("accountLane").value = body.result.runtime_lane || body.runtime_lane;
      setReady(true, "PCC AUTHORITY VERIFIED");
      window.dispatchEvent(new CustomEvent("pcc:systems-runtime-verified", { detail: { actor_id: body.result.actor_id } }));
      $("systemsLogin")?.classList.add("hidden");
      $("systemsSignOut")?.classList.remove("hidden");
      $("authMessage").textContent = `PCC institutional authority verified for ${body.result.actor_id}.`;
      show(body);
      // PCC proxy: once the authenticated Systems runtime is verified, prove the
      // governed Agent invoker is reachable without requiring a Founder click.
      // READINESS is read-only and remains subject to the invoker's identity gate.
      try {
        const readiness = await invokeAgent("READINESS");
        show({ workforce: body, agent_readiness: readiness });
      } catch (agentError) {
        show({ workforce: body, agent_readiness: agentError.body || { ok:false, error:agentError.message } });
      }
      await refreshWork();
    } catch (error) {
      setReady(false, "IDENTITY GATE DENIED", true);
      $("authMessage").textContent = error.message;
      show(error.body || { ok: false, error: error.message });
    }
  }
  async function applySession(session) {
    if (!session) {
      $("runtimeLane").textContent = "SYSTEMS SIGN-IN REQUIRED";
      $("actor").textContent = "Institutional authority not yet verified";
      $("systemsLogin")?.classList.remove("hidden");
      $("systemsSignOut")?.classList.add("hidden");
      $("authMessage").textContent = "Sign in here; PCC resolves the bound institutional actor server-side.";
      setReady(false, "SYSTEMS SIGN-IN REQUIRED", true);
      return;
    }
    await verifyRuntime();
  }
  function workOrderCard(w, execution) {
    const streamId = escapeHtml(w.workforce_stream_id || "");
    const workOrderId = escapeHtml(w.work_order_id || "");
    const status = String(w.status || "").toUpperCase();
    const dispatchButton = status === "ISSUED"
      ? `<button type="button" data-work-action="dispatch-agent" data-stream-id="${streamId}" data-work-order-id="${workOrderId}">Dispatch Governed Agent</button>`
      : "";
    const claimButton = status === "ISSUED"
      ? `<button type="button" class="secondary" data-work-action="claim" data-stream-id="${streamId}" data-work-order-id="${workOrderId}">Manual Claim Only</button>`
      : "";
    const checkpointButton = ["CLAIMED", "ACTIVE", "CHECKPOINTED"].includes(status)
      ? `<button type="button" data-work-action="checkpoint" data-stream-id="${streamId}" data-work-order-id="${workOrderId}">Write Checkpoint</button>`
      : "";
    const executionId = escapeHtml(execution?.execution_id || "");
    const executionStatus = String(execution?.status || "").toUpperCase();
    let agentButton = "";
    if (["CLAIMED", "ACTIVE", "CHECKPOINTED"].includes(status)) {
      if (!execution) {
        agentButton = `<button type="button" data-work-action="agent" data-stream-id="${streamId}" data-work-order-id="${workOrderId}">Identify Agent Lane</button>`;
      } else if (executionStatus === "REGISTERED") {
        agentButton = `<button type="button" data-work-action="launch-agent" data-stream-id="${streamId}" data-work-order-id="${workOrderId}" data-execution-id="${executionId}">Launch Agent Session</button>`;
      } else if (executionStatus === "ACTIVE" && !execution.latest_response_id) {
        agentButton = `<button type="button" data-work-action="launch-agent" data-stream-id="${streamId}" data-work-order-id="${workOrderId}" data-execution-id="${executionId}">Launch Agent Session</button>`;
      } else if (executionStatus === "ACTIVE") {
        agentButton = `<button type="button" disabled>Agent Active · ${executionId}</button>`;
      } else {
        agentButton = `<button type="button" disabled>Agent ${escapeHtml(executionStatus)} · ${executionId}</button>`;
      }
    }
    return `<article class="work">
      <div class="label">${escapeHtml(w.workforce_role)} · ${escapeHtml(w.status)}</div>
      <strong>${escapeHtml(w.title)}</strong>
      <small>${workOrderId}<br>${streamId}</small>
      <div class="work-actions">
        <button type="button" data-work-action="activation" data-stream-id="${streamId}" data-work-order-id="${workOrderId}">Retrieve Activation</button>
        ${dispatchButton}
        ${claimButton}
        ${checkpointButton}
        ${agentButton}
      </div>
    </article>`;
  }
  async function refreshWork() {
    try {
      const [workBody, executionBody] = await Promise.all([
        invoke("LIST_OPEN_WORK", {}),
        invoke("LIST_AGENT_EXECUTIONS", {})
      ]);
      const orders = workBody.result.work_orders || [];
      const executions = executionBody.result.agent_executions || [];
      const executionByWorkOrder = new Map();
      for (const execution of executions) {
        if (!executionByWorkOrder.has(execution.work_order_id) && ["REGISTERED", "ACTIVE", "PAUSED"].includes(execution.status)) {
          executionByWorkOrder.set(execution.work_order_id, execution);
        }
      }
      $("workList").innerHTML = orders.length
        ? orders.map(order => workOrderCard(order, executionByWorkOrder.get(order.work_order_id))).join("")
        : '<div class="help">No open workforce assignments.</div>';
    } catch (error) {
      $("workList").innerHTML = `<div class="help">Retrieval blocked: ${escapeHtml(error.message)}</div>`;
    }
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }

  $("healthButton").addEventListener("click", verifyRuntime);
  $("systemsSignIn")?.addEventListener("click", async () => {
    const email = $("systemsEmail")?.value.trim();
    const password = $("systemsPassword")?.value || "";
    if (!email || !password) { $("authMessage").textContent = "Systems email and password are required."; return; }
    setReady(false, "AUTHENTICATING SYSTEMS");
    const { error } = await client.auth.signInWithPassword({ email, password });
    if ($("systemsPassword")) $("systemsPassword").value = "";
    if (error) { setReady(false, "SYSTEMS SIGN-IN DENIED", true); $("authMessage").textContent = error.message; return; }
    await verifyRuntime();
  });
  $("systemsSignOut")?.addEventListener("click", async () => {
    await client.auth.signOut({ scope: "local" });
    await applySession(null);
  });
  $("refreshWork").addEventListener("click", refreshWork);
  $("workList").addEventListener("click", async event => {
    const button = event.target.closest("button[data-work-action]");
    if (!button) return;
    const streamId = button.dataset.streamId;
    const workOrderId = button.dataset.workOrderId;
    const action = button.dataset.workAction;
    const executionId = button.dataset.executionId;
    if (action === "dispatch-agent") {
      button.disabled = true;
      button.textContent = "Dispatching…";
      try {
        show(await invokeAgent("DISPATCH", { work_order_id: workOrderId }));
        await refreshWork();
      } catch (error) {
        show(error.body || { ok:false,error:error.message });
        button.disabled = false;
        button.textContent = "Dispatch Governed Agent";
      }
      return;
    }
    if (action === "launch-agent") {
      button.disabled = true;
      button.textContent = "Launching…";
      try {
        show(await invokeAgent("LAUNCH", { execution_id: executionId }));
        await refreshWork();
      } catch (error) {
        show(error.body || { ok:false,error:error.message });
        button.disabled = false;
        button.textContent = "Launch Agent Session";
      }
      return;
    }
    const payloads = {
      activation: ["READ_ACTIVATION_PACKAGE", { stream_id: streamId, work_order_id: workOrderId }],
      claim: ["CLAIM_WORK_ORDER", { stream_id: streamId, work_order_id: workOrderId }],
      checkpoint: ["WRITE_CHECKPOINT", {
        stream_id: streamId,
        work_order_id: workOrderId,
        checkpoint_type: "PROGRESS",
        state: "ACTIVE",
        summary: "Authenticated Mason runtime retrieved the activation package, claimed the PCC workforce assignment, and established the first governed execution checkpoint.",
        evidence: ["PCC Workforce Console", "Authenticated runtime subject", "Work order claim and checkpoint receipts"]
      }],
      agent: ["REGISTER_AGENT_EXECUTION", {
        stream_id: streamId,
        work_order_id: workOrderId,
        provider: "OPENAI_AGENT_API",
        provider_account_lane: $("accountLane").value,
        metadata: { registration_source: "PCC_WORKFORCE_CONSOLE" }
      }]
    };
    const request = payloads[action];
    if (!request) return;
    button.disabled = true;
    button.textContent = action === "activation" ? "Retrieving…" : action === "claim" ? "Claiming…" : action === "agent" ? "Identifying…" : "Writing…";
    try {
      show(await invoke(request[0], request[1]));
      await refreshWork();
    } catch (error) {
      show(error.body || { ok:false,error:error.message });
      button.disabled = false;
    }
  });
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