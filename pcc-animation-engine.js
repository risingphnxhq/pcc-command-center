(() => {
  "use strict";
  const base = "https://ttkceizmjeckrorhkhfr.supabase.co";
  const endpoint = base + "/functions/v1/pcc-animation-control-v1";
  const client = window.supabase.createClient(base, "sb_publishable_v3-qGYPg-tSY-G4cX47HRg_TgMnYEbO", {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  const $ = (id) => document.getElementById(id);
  const form = $("requestForm"), button = $("submit"), note = $("status"), jobs = $("jobs"), alerts = $("inventoryAlerts");
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
    phnx_sports:"PHNX Sports",phnx_studio:"PHNX Studios",phnx_faceless:"PHNX Faceless Reels",rpe:"RPE",shadow:"ShadowFrame",valarian:"Valarian Shadow"
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
        POLICY_SOURCE_SCOPE_MISMATCH: "This approved policy is limited to a different series or episode. Enter the exact source IDs required by the selected policy.",
        APPROVED_BOAS_KNOAS_REVISIONS_REQUIRED: "Approved BOAS and KNOAS revision receipts are required before staging.",
        SCRIPT_REVIEW_PASS_REQUIRED: "The Reviewer must pass the script before handoff staging.",
        BINARY_QA_PASS_REQUIRED: "The script must pass binary QA before handoff staging.",
        REVIEWER_RECEIPT_REQUIRED: "A passing Reviewer receipt is required before handoff staging.",
        ANIMATION_HANDOFF_ROLE_REQUIRED: "Your PCC role does not include PMF handoff staging.",
        SCRIPT_GENERATION_FAILED: "The Script Writer could not complete this request. PCC kept the request; check its server-side model connection.",
        ANIMATION_RENDER_REVIEW_ROLE_REQUIRED: "Your PCC role does not include render review.",
        ANIMATION_RENDER_NOT_READY_FOR_REVIEW: "This request does not have a verified private PMF render awaiting review.",
        PMF_REVIEW_PREVIEW_NOT_CONFIGURED: "The private PMF review connection is not configured.",
        PMF_REVIEW_PREVIEW_UNAVAILABLE: "PCC could not verify a private preview URL. The artifact remains private.",
        PCC_RENDER_PREVIEW_RECEIPT_FAILED: "PCC could not save the review access receipt. The video remains private.",
        PCC_RENDER_REVIEW_PREVIEW_REQUIRED: "Preview this exact render in PCC before recording your review.",
        PCC_RENDER_REVIEW_ARGUMENT_INVALID: "Add a review decision and notes, then submit again.",
        PCC_RENDER_REVIEW_SAVE_FAILED: "PCC could not save this render review decision.",
      };
      throw new Error(messages[result.error] || result.error || "PCC request failed ("+response.status+").");
    }
    return result;
  }
  const readinessButton = $("checkPmfReadiness");
  const readinessNote = $("pmfReadiness");
  if (readinessButton && readinessNote) {
    readinessButton.addEventListener("click", async () => {
      readinessButton.disabled = true;
      readinessNote.textContent = "Checking PMF’s signed production-admission record…";
      try {
        const result = await call("PMF_PRODUCTION_READINESS");
        const readiness = result.readiness;
        if (readiness.state === "PRODUCTION_ADMITTED") {
          readinessNote.textContent = "PMF admission requirements currently pass. Production CEP intake and render dispatch are still disabled in PCC; this status check does not start work.";
          readinessNote.className = "fine";
        } else {
          const reasons = Array.isArray(readiness.failures) ? readiness.failures : [];
          const explanations = {
            PMF_VERSION_NOT_ACTIVE: "PMF version is not active",
            PMF_AUDIT_NOT_ADMITTED: "PMF has not passed admission",
            PMF_VERSION_NOT_CERTIFIED: "PMF is not certified",
            PMF_BUILD_CONTROL_NOT_ALIGNED: "PMF build-control record is not aligned",
            PMF_CURRENT_UNCONDITIONAL_CERTIFICATE_REQUIRED: "Current unconditional production certificate is missing",
          };
          const gateFailures = reasons.filter((code) => code.startsWith("PMF_BUILD_GATE_"));
          const summary = reasons.filter((code) => !code.startsWith("PMF_BUILD_GATE_"))
            .map((code) => explanations[code] || code);
          if (gateFailures.length) summary.push("One or more evidence-backed acceptance gates have not passed: " + gateFailures.join(", "));
          readinessNote.textContent = "Production blocked: " + (summary.join("; ") || "PMF admission requirements are incomplete") + ". No render was started.";
          readinessNote.className = "fine";
        }
      } catch (error) {
        readinessNote.textContent = (error?.message || "PMF readiness check failed") + ". No render was started.";
        readinessNote.className = "fine";
      } finally {
        readinessButton.disabled = false;
      }
    });
  }

  const runPodButton = $("checkRunPodConnection");
  const runPodNote = $("runPodConnection");
  if (runPodButton && runPodNote) {
    runPodButton.addEventListener("click", async () => {
      runPodButton.disabled = true;
      runPodNote.textContent = "Checking the configured RunPod connection through the authenticated server bridge…";
      try {
        const result = await call("RUNPOD_CONNECTION_STATUS");
        const connection = result.connection || {};
        const cost = Number.isFinite(connection.cost_per_hour_usd)
          ? " Observed Pod rate: $" + connection.cost_per_hour_usd.toFixed(2) + "/hour."
          : "";
        const messages = {
          NOT_CONFIGURED: "RunPod connection is not configured in server secrets; no credentials are sent to the browser.",
          CONTROL_PLANE_UNREACHABLE: "The server could not reach RunPod’s control plane.",
          POD_METADATA_INVALID: "RunPod returned incomplete Pod details; the check failed closed.",
          POD_PROFILE_MISMATCH: "The configured Pod does not match the approved image/GPU profile.",
          COST_LIMIT_EXCEEDED: "The Pod’s hourly rate exceeds the server-side approved ceiling.",
          POD_STOPPED: "RunPod’s API is reachable, but the Pod is stopped. There is no connected GPU worker and no render-ready connection.",
          WORKER_API_UNREACHABLE: "The Pod is running, but its authenticated animation worker is unreachable.",
          WORKER_API_UNHEALTHY: "The animation worker answered unsuccessfully.",
          WORKER_CAPABILITY_CONTRACT_MISMATCH: "The worker answered, but its capability contract does not match the approved engine contract.",
          WORKER_READY: "The configured Pod and authenticated animation worker are reachable. This check did not start a render; PMF admission and review gates still apply.",
        };
        let detail = messages[connection.state] || "RunPod connection status is unavailable.";
        if (connection.state === "NOT_CONFIGURED" && Array.isArray(connection.missing) && connection.missing.length) {
          detail += " Missing server settings: " + connection.missing.join(", ") + ".";
        }
        runPodNote.textContent = detail + cost;
        runPodNote.className = "fine";
      } catch (error) {
        runPodNote.textContent = (error?.message || "RunPod connection check failed") + ". No Pod was started or stopped.";
        runPodNote.className = "fine";
      } finally {
        runPodButton.disabled = false;
      }
    });
  }

  const runPodSearchButton = $("searchRunPodAvailability");
  const runPodAvailabilityNote = $("runPodAvailability");
  const runPodCandidates = $("runPodCandidates");
  if (runPodSearchButton && runPodAvailabilityNote && runPodCandidates) {
    runPodSearchButton.addEventListener("click", async () => {
      runPodSearchButton.disabled = true;
      runPodAvailabilityNote.textContent = "Checking current RunPod GPU and storage availability…";
      runPodCandidates.replaceChildren();
      try {
        const result = await call("RUNPOD_AVAILABILITY_SEARCH");
        const search = result.availability || {};
        if (search.state === "OUTSIDE_SEARCH_WINDOW") {
          runPodAvailabilityNote.textContent = "The scheduled search window is closed. No provider query or rental was started.";
        } else {
          const inventory = search.inventory || {};
          runPodAvailabilityNote.textContent = inventory.candidate_count
            ? inventory.candidate_count + " candidate(s) matched the $0.80/hour ceiling and 50 GB network-storage requirement. This is a point-in-time availability check—not a reservation. No Pod was started."
            : "No currently listed GPU matches both limits. PCC can check again during the scheduled overnight window. No Pod was started.";
          for (const offer of inventory.candidates || []) {
            const card = document.createElement("article"); card.className = "job";
            const heading = document.createElement("strong");
            heading.textContent = offer.gpu_name + " · " + offer.cloud_tier + " · $" + Number(offer.hourly_rate_usd).toFixed(2) + "/hour";
            const details = document.createElement("small");
            details.textContent = offer.vram_gb + " GB VRAM · " + offer.availability + " aggregate stock snapshot · "
              + offer.data_center_id + " · existing network volume " + offer.storage_gb + " GB. Stock is not tier-specific and can change before a job starts.";
            card.append(heading, details); runPodCandidates.append(card);
          }
          for (const warning of inventory.warnings || []) {
            const line = document.createElement("small");
            line.textContent = warning === "NO_READY_NETWORK_VOLUME_FOUND"
              ? "No ready network volume was found; GPU offers are withheld until a compatible 50 GB volume exists."
              : warning;
            runPodCandidates.append(line);
          }
        }
      } catch (error) {
        runPodAvailabilityNote.textContent = (error?.message || "Availability search failed") + ". No Pod was started.";
      } finally {
        runPodSearchButton.disabled = false;
      }
    });
  }

  const latestRunPodButton = $("latestRunPodAvailability");
  const latestRunPodNote = $("latestRunPodAvailabilityNote");
  const latestRunPodCandidates = $("latestRunPodCandidates");
  if (latestRunPodButton && latestRunPodNote && latestRunPodCandidates) {
    latestRunPodButton.addEventListener("click", async () => {
      latestRunPodButton.disabled = true;
      latestRunPodNote.textContent = "Loading the latest overnight RunPod availability snapshot…";
      latestRunPodCandidates.replaceChildren();
      try {
        const result = await call("RUNPOD_AVAILABILITY_LATEST");
        const snapshot = result.availability || {};
        if (snapshot.state === "NO_RECENT_SNAPSHOT") {
          latestRunPodNote.textContent = "No overnight snapshot is stored yet. The scheduled search will check during 00:00–06:00 in the configured timezone. No Pod was started.";
        } else {
          const inventory = snapshot.inventory || {};
          latestRunPodNote.textContent = "Snapshot from " + new Date(snapshot.snapshot_at).toLocaleString()
            + " (" + snapshot.search_window.time_zone + "). "
            + (inventory.candidate_count
              ? inventory.candidate_count + " candidate(s) met the $0.80/hour and 50 GB requirements at that time."
              : "No candidate met both limits at that time.")
            + " Availability can change and is not guaranteed. No Pod was reserved or started.";
          for (const offer of inventory.candidates || []) {
            const card = document.createElement("article"); card.className = "job";
            const heading = document.createElement("strong");
            heading.textContent = offer.gpu_name + " · " + offer.cloud_tier + " · $" + Number(offer.hourly_rate_usd).toFixed(2) + "/hour";
            const details = document.createElement("small");
            details.textContent = offer.vram_gb + " GB VRAM · " + offer.availability + " aggregate stock snapshot · "
              + offer.data_center_id + " · compatible storage " + offer.storage_gb + " GB. Availability is not guaranteed.";
            card.append(heading, details); latestRunPodCandidates.append(card);
          }
          for (const warning of inventory.warnings || []) {
            const line = document.createElement("small");
            line.textContent = warning === "NO_READY_NETWORK_VOLUME_FOUND"
              ? "No ready network volume was found; GPU offers are withheld until a compatible 50 GB volume exists."
              : warning;
            latestRunPodCandidates.append(line);
          }
        }
      } catch (error) {
        latestRunPodNote.textContent = (error?.message || "Latest availability snapshot unavailable") + ". No Pod was started.";
      } finally {
        latestRunPodButton.disabled = false;
      }
    });
  }

  if (latestRunPodButton) latestRunPodButton.click();

  function renderAlerts(items, available=true) {
    if (!alerts) return;
    alerts.replaceChildren();
    if (!available) {
      const p=document.createElement("p"); p.className="empty";
      p.textContent="Replenishment monitor is not available yet. Apply the PCC replenishment migration to activate it.";
      alerts.append(p); return;
    }
    if (!Array.isArray(items) || !items.length) {
      const p=document.createElement("p"); p.className="empty";
      p.textContent="No active low-stock alerts. PCC counts only human-approved, unpublished outputs.";
      alerts.append(p); return;
    }
    for (const item of items) {
      const card=document.createElement("article"); card.className="job";
      const heading=document.createElement("div"); heading.className="jobhead";
      const title=document.createElement("strong");
      title.textContent=(labels[item.channel_key]||safeText(item.channel_key)||"Channel")+" · "+safeText(item.output_type);
      const badge=document.createElement("span"); badge.className="badge";
      badge.textContent=safeText(String(item.ready_unpublished_count))+" ready";
      heading.append(title,badge); card.append(heading);
      const detail=document.createElement("small");
      const series=item.series_key==="__UNSCOPED__" ? "General inventory" : safeText(item.series_key);
      detail.textContent=series+" · threshold: "+safeText(String(item.threshold))+" · start continuation or produce new inventory.";
      card.append(detail);
      alerts.append(card);
    }
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
      const renderReceipt=job.artifact_manifest?.pmf_render_receipt;
      if (job.artifact_manifest?.review_state === "REVIEW_REQUIRED" && renderReceipt) {
        const renderNote=document.createElement("small");
        renderNote.className="job-notice";
        renderNote.textContent="PMF render received as a private artifact. PCC review is required; quality is not approved and nothing was published. Receipt: "+safeText(renderReceipt.result_receipt_id);
        article.append(renderNote);
        const previewButton=document.createElement("button");
        previewButton.type="button";
        previewButton.textContent="Preview private render";
        const preview=document.createElement("video");
        preview.controls=true; preview.preload="metadata"; preview.playsInline=true; preview.hidden=true;
        preview.style.width="100%"; preview.style.maxHeight="480px"; preview.style.marginTop="0.75rem";
        const expiry=document.createElement("small");
        previewButton.addEventListener("click", async () => {
          previewButton.disabled=true;
          previewButton.textContent="Requesting private preview…";
          try {
            const result=await call("RENDER_REVIEW_URL", { job_id:job.job_id });
            const signed=result.preview;
            if (!signed || signed.state!=="REVIEW_REQUIRED" || signed.mime_type!=="video/mp4"
                || signed.pcc_request_id!==job.job_id || signed.execution_id!==job.render_execution_id
                || signed.artifact_sha256!==job.artifact_manifest?.artifact?.sha256) {
              throw new Error("PCC returned a mismatched review preview.");
            }
            preview.src=signed.signed_url;
            preview.hidden=false;
            reviewNotes.hidden=false; decisions.hidden=false;
            preview.load();
            expiry.textContent="Private preview link expires "+new Date(signed.expires_at).toLocaleTimeString()+". Request a new preview after expiry.";
            previewButton.textContent="Refresh private preview";
          } catch (error) {
            message(error.message, "error");
            previewButton.textContent="Retry private preview";
          } finally {
            previewButton.disabled=false;
          }
        });
        const reviewNotes=document.createElement("textarea");
        reviewNotes.hidden=true;
        reviewNotes.rows=3; reviewNotes.maxLength=2000;
        reviewNotes.placeholder="Reviewer notes: what passed, or what must be corrected.";
        reviewNotes.setAttribute("aria-label","Render review notes");
        const decisions=document.createElement("div"); decisions.hidden=true;
        const approve=document.createElement("button"); approve.type="button"; approve.textContent="Approve quality";
        const revise=document.createElement("button"); revise.type="button"; revise.textContent="Request revision";
        const submitDecision=async decision=>{
          if(preview.hidden){message("Preview this exact private render in PCC before reviewing it.","error");return;}
          if(!reviewNotes.value.trim()){message("Add reviewer notes before recording the decision.","error");reviewNotes.focus();return;}
          approve.disabled=true; revise.disabled=true;
          try {
            const saved=await call("RENDER_REVIEW_DECISION",{job_id:job.job_id,decision,notes:reviewNotes.value.trim()});
            const receipt=saved.review_receipt;
            if(!receipt || receipt.distribution_performed!==false || receipt.quality_approved!==(decision==="APPROVE")) throw new Error("PCC review receipt did not match the selected decision.");
            message(decision==="APPROVE" ? "Human render QA approved. The video remains private and unpublished." : "Revision requested. The current render remains private and no new render was dispatched.","ok");
            await refresh();
          } catch(error){message(error.message,"error");approve.disabled=false;revise.disabled=false;}
        };
        approve.addEventListener("click",()=>submitDecision("APPROVE"));
        revise.addEventListener("click",()=>submitDecision("REQUEST_REVISION"));
        decisions.append(approve,revise);
        article.append(previewButton, preview, expiry, reviewNotes, decisions);
      }
      if (job.render_review_receipt) {
        const reviewed=document.createElement("small");
        reviewed.className="job-notice";
        reviewed.textContent=(job.render_review_receipt.decision==="APPROVE" ? "Render QA approved by reviewer." : "Reviewer requested a render revision.")
          +" Quality approved: "+String(job.render_review_receipt.quality_approved===true)+". Distribution performed: false.";
        article.append(reviewed);
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
      renderAlerts(result.alerts || [], result.alerts_available !== false);
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
    const sourceSeriesId=$("sourceSeriesId").value.trim(), sourceEpisodeId=$("sourceEpisodeId").value.trim();
    const key=crypto.randomUUID();
    try {
      const result=await call("CREATE", {
        idempotency_key:key, channel_key:channel, output_type:output,
        production_intent:["AD","REEL"].includes(output) ? intentSelect.value : null,
        title, idea, request_payload:{intake:"PCC_ANIMATION_ENGINE_V1",series_context:seriesContext,source_series_id:sourceSeriesId,source_episode_id:sourceEpisodeId,context_notes:contextNotes,desired_ending_or_action:desiredEnding}
      });
      $("title").value=""; $("seriesContext").value=""; $("sourceSeriesId").value=""; $("sourceEpisodeId").value=""; $("contextNotes").value=""; $("desiredEnding").value=""; $("idea").value="";
      message("Saved in PCC as "+result.job.status+". No render was started.", "ok");
      await refresh();
    } catch (error) { message(error.message, "error"); }
    finally { button.disabled=false; }
  });
  refresh();
})();