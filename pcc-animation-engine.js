(() => {
  "use strict";
  const base = "https://ttkceizmjeckrorhkhfr.supabase.co";
  const endpoint = base + "/functions/v1/pcc-animation-control-v1";
  const client = window.supabase.createClient(base, "sb_publishable_v3-qGYPg-tSY-G4cX47HRg_TgMnYEbO", {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  const $ = (id) => document.getElementById(id);
  const form = $("requestForm"), button = $("submit"), note = $("status"), jobs = $("jobs");
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
      noteText.textContent="PCC request saved. Rendering remains held until the PMF/PCC registration gate is cleared.";
      article.append(noteText);
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
    const channel=$("channel").value, output=$("format").value, idea=$("idea").value.trim();
    const key=crypto.randomUUID();
    try {
      const result=await call("CREATE", {
        idempotency_key:key, channel_key:channel, output_type:output,
        title:output.replaceAll("_"," ").toLowerCase(), idea, request_payload:{intake:"PCC_ANIMATION_ENGINE_V1"}
      });
      $("idea").value="";
      message("Saved in PCC as "+result.job.status+". No render was started.", "ok");
      await refresh();
    } catch (error) { message(error.message, "error"); }
    finally { button.disabled=false; }
  });
  refresh();
})();