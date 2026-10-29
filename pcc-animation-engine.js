(() => {
  "use strict";
  const base = "https://ttkceizmjeckrorhkhfr.supabase.co";
  const endpoint = base + "/functions/v1/pcc-animation-control-v1";
  const client = window.supabase.createClient(base, "sb_publishable_v3-qGYPg-tSY-G4cX47HRg_TgMnYEbO", {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  const $ = (id) => document.getElementById(id);
  const form = $("requestForm"), button = $("submit"), note = $("status"), jobs = $("jobs");
  const formatSelect = $("format"), intentField = $("intentField"), intentSelect = $("productionIntent");
  function syncIntent() {
    const required = ["AD", "REEL"].includes(formatSelect.value);
    intentField.hidden = !required;
    intentSelect.required = required;
    if (!required) intentSelect.value = "";
  }
  formatSelect.addEventListener("change", syncIntent);
  syncIntent();
  const labels = {
    goldmind:"Phoenix GoldMind",goldwords:"GoldWords",phnx_kids:"PHNX Kids",phnx_kitchen:"PHNX Kitchen",
    phnx_sports:"PHNX Sports",phnx_studio:"PHNX Studios",rpe:"RPE",shadow:"ShadowFrame",valarian:"Valarian Shadow"
  };
  function message(text, kind="") { note.textContent=text; note.className="note "+kind; }
  function safeText(value) { return typeof value === "string" ? value : ""; }
  async function call(action, payload={}) {
    const { data: { session } } = await client.auth.getSession();
    if (!session?.access_token) throw new Error("Sign in to your PCC Founder account on the Command Floor, then reopen Animation Engine.");
    const response = await fetch(endpoint, {
      method:"POST",
      headers:{ "Content-Type":"application/json", "apikey":"sb_publishable_v3-qGYPg-tSY-G4cX47HRg_TgMnYEbO", "Authorization":"Bearer "+session.access_token },
      body:JSON.stringify({action,payload}), cache:"no-store"
    });
    const result = await response.json().catch(()=>({}));
    if (!response.ok) {
      const messages = {
        SCRIPT_RUNTIME_CONFIGURATION_MISSING: "PCC script generation is not configured yet. The request is saved; no GPU was started.",
        REGISTERED_CHANNEL_POLICY_REQUIRED: "This channel and format do not yet have a trusted BOAS/KNOAS policy registered. The request is saved and rendering stays held.",
        SCRIPT_POLICY_REGISTRY_INVALID: "PCC's server-side channel policy registry needs repair. No script or render was started.",
        ANIMATION_JOB_ALREADY_SCRIPTED: "This request already has a script package.",
        PRODUCTION_INTENT_REQUIRED: "Choose Marketing or Narrative for this ad or reel.",
        REGISTERED_CHANNEL_POLICY_REQUIRED: "This channel/format has no complete approved BOAS/KNOAS profile yet. No script or render was started.",
        APPROVED_BOAS_KNOAS_REVISIONS_REQUIRED: "Approved BOAS and KNOAS revision receipts are required before staging.",
        SCRIPT_REVIEW_PASS_REQUIRED: "The Reviewer must pass the script before handoff staging.",
        BINARY_QA_PASS_REQUIRED: "The script must pass binary QA before handoff staging.",
        REVIEWER_RECEIPT_REQUIRED: "A passing Reviewer receipt is required before handoff staging.",
        ANIMATION_HANDOFF_ROLE_REQUIRED: "Your PCC role does not include PMF handoff staging.",
        SCRIPT_GENERATION_FAILED: "The Script Writer could not complete this request. PCC kept the request; check its server-side model connection.",
      };
      throw new Error(messages[result.error] || result.error || "PCC request failed ("+response.status+").");
    }
    return result;
  }
  function render(items) {
    jobs.replaceChildren();
    if (!Array.isArray(items) || !items.length) {
      const empty=document.createElement("p"); empty.className="empty"; empty.textContent="No production requests yet."; jobs.append(empty); return;
    }
    for (const job of items) {
      const article=document.createElement("article"); article.className="job";
      const head=document.createElement("div"); head.className="jobhead";
      const title=document.createElement("strong"); title.textContent=safeText(job.title)||safeText(job.output_type)||"Production request";
      const badge=document.createElement("span"); badge.className="badge"; badge.textContent=safeText(job.status)||"UNKNOWN";
      head.append(title,badge); article.append(head);
      const detail=document.createElement("small");
      detail.textContent=(labels[job.channel_key]||safeText(job.channel_key)||"Channel pending")+" · "+safeText(job.output_type)+" · "+new Date(job.created_at).toLocaleString();
      article.append(detail);
      const noteText=document.createElement("small");
      noteText.textContent=job.failure_code ? "Previous Script Writer attempt needs retry: "+safeText(job.failure_code)+". Rendering remains held." : "PCC request saved. Rendering remains held until PMF admission/certification and the PCC production connection are complete.";
      article.append(noteText);
      const notificationReceipt=job.review_receipt?.notification_receipt;
      if (notificationReceipt?.event === "SCRIPT_REVIEW_NEEDS_ATTENTION") {
        const notice=document.createElement("small");
        notice.className="job-notice";
        notice.textContent="Reviewer notice recorded in PCC: "+safeText(String(notificationReceipt.unresolved_issue_count ?? 0))+" unresolved issue(s). This request is held for attention; other requests can continue.";
        article.append(notice);
      }
      if (job.script_bundle && typeof job.script_bundle === "object") {
        const details=document.createElement("details");
        const summary=document.createElement("summary");
        summary.textContent="View script and QA receipt";
        const preview=document.createElement("pre");
        preview.className="script-preview";
        const segments=Array.isArray(job.script_bundle.channel_segments) ? job.script_bundle.channel_segments : [];
        const issues=Array.isArray(job.review_receipt?.unresolved_issues) ? job.review_receipt.unresolved_issues : [];
        preview.textContent=[
          "SCRIPT",
          safeText(job.script_bundle.full_script) || "(No full script was saved.)",
          "",
          "CHANNEL SEGMENTS",
          ...segments.map((segment) => "Segment "+safeText(String(segment.index))+": "+safeText(segment.purpose)+"\n"+safeText(segment.script)+"\nHandoff: "+safeText(segment.handoff)),
          "",
          "REVIEW",
          "State: "+safeText(job.review_receipt?.state || job.status),
          ...(issues.length ? issues.map((issue) => safeText(issue.severity)+" "+safeText(issue.code)+": "+safeText(issue.message)) : ["No unresolved review issues."]),
        ].join("\n");
        details.append(summary,preview);
        article.append(details);
      }
      if (job.script_bundle && job.status === "SCRIPT_REVIEW_PASSED" && !job.handoff_receipt?.pmf_intake_receipt) {
        const handoffButton=document.createElement("button");
        handoffButton.type="button";
        handoffButton.textContent=job.handoff_packet ? "Retry PMF handoff receipt (held)" : "Stage PCC → PMF handoff (held)";
        handoffButton.addEventListener("click", async () => {
          handoffButton.disabled=true;
          message("Validating approved BOAS/KNOAS revisions and staging the held PMF handoff…");
          try {
            const result=await call("STAGE_PMF_HANDOFF", { job_id:job.job_id });
            message(result.pmf_intake_state === "HELD_PMF_ADMISSION_REQUIRED" ? "PMF received the packet and returned a held receipt. No CEP job or render was started." : result.pmf_intake_state === "NOT_CONFIGURED" ? "Packet is safely held in PCC. The PCC → PMF connection is not configured yet; no render was started." : "Packet is safely held in PCC. No render was started.", "ok");
            await refresh();
          } catch (error) {
            message(error.message, "error");
            handoffButton.disabled=false;
          }
        });
        article.append(handoffButton);
      }
      if (job.handoff_state) {
        const handoffNote=document.createElement("small");
        const pmfReceipt=job.handoff_receipt?.pmf_intake_receipt;
        handoffNote.textContent=pmfReceipt
          ? "PMF intake: held receipt saved · CEP enqueue and rendering disabled."
          : "PCC packet: "+safeText(job.handoff_state)+" · PMF receipt pending · rendering disabled.";
        article.append(handoffNote);
      }
      if (!job.script_bundle && !["CANCELLED","FAILED","SCRIPTING"].includes(job.status)) {
        const scriptButton=document.createElement("button");
        scriptButton.type="button";
        scriptButton.textContent="Generate and review script";
        scriptButton.addEventListener("click", async () => {
          scriptButton.disabled=true;
          message("Script Writer is drafting, checking, and repairing this request…");
          try {
            const result=await call("WRITE_SCRIPT", { job_id:job.job_id });
            message(result.script_state === "SCRIPT_REVIEW_PASSED"
              ? "Script passed the Reviewer and binary checks. It is saved in PCC; rendering remains held."
              : "Script is held in PCC Review with QA issues recorded. Other requests can continue.", "ok");
            await refresh();
          } catch (error) {
            message(error.message, "error");
            scriptButton.disabled=false;
          }
        });
        article.append(scriptButton);
      }
      jobs.append(article);
    }
  }
  async function refresh() {
    try {
      const result=await call("LIST");
      render(result.jobs || []);
    } catch (error) {
      jobs.replaceChildren(); const p=document.createElement("p"); p.className="empty"; p.textContent=error.message; jobs.append(p);
    }
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled=true; message("Recording request in PCC…");
    const channel=$("channel").value, output=$("format").value, title=$("title").value.trim(), idea=$("idea").value.trim();
    const seriesContext=$("seriesContext").value.trim(), contextNotes=$("contextNotes").value.trim(), desiredEnding=$("desiredEnding").value.trim();
    const key=crypto.randomUUID();
    try {
      const result=await call("CREATE", {
        idempotency_key:key, channel_key:channel, output_type:output,
        production_intent:["AD","REEL"].includes(output) ? intentSelect.value : null,
        title, idea, request_payload:{intake:"PCC_ANIMATION_ENGINE_V1",series_context:seriesContext,context_notes:contextNotes,desired_ending_or_action:desiredEnding}
      });
      $("title").value=""; $("seriesContext").value=""; $("contextNotes").value=""; $("desiredEnding").value=""; $("idea").value="";
      message("Saved in PCC as "+result.job.status+". No render was started.", "ok");
      await refresh();
    } catch (error) { message(error.message, "error"); }
    finally { button.disabled=false; }
  });
  refresh();
})();