const OUTPUT_TYPES = new Set(["BOOK_MANUSCRIPT", "BOOK_CHAPTER", "BOOK_SCENE", "NOVEL", "SERIES_BIBLE"]);

export function validateWorkspaceWritingRequest(input = {}) {
  const outputType = typeof input.outputType === "string" ? input.outputType.trim().toUpperCase() : "";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const idea = typeof input.idea === "string" ? input.idea.trim() : "";
  const writingContext = input.writingContext && typeof input.writingContext === "object" && !Array.isArray(input.writingContext)
    ? input.writingContext : {};
  if (!OUTPUT_TYPES.has(outputType)) throw new Error("WORKSPACE_WRITING_OUTPUT_TYPE_UNSUPPORTED");
  if (!title || title.length > 200) throw new Error("WORKSPACE_WRITING_TITLE_INVALID");
  if (!idea || idea.length > 12_000) throw new Error("WORKSPACE_WRITING_BRIEF_INVALID");
  return { outputType, title, idea, writingContext };
}

export function parseWorkspaceWritingDraft(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error("WORKSPACE_WRITING_RESPONSE_JSON_INVALID"); }
  const draftText = typeof parsed?.draft_text === "string" ? parsed.draft_text.trim() : "";
  if (!draftText || draftText.length > 250_000) throw new Error("WORKSPACE_WRITING_DRAFT_INVALID");
  return draftText;
}

export async function createWorkspaceWritingDraft({ model, request }) {
  if (!model || typeof model.complete !== "function") throw new Error("WORKSPACE_WRITING_MODEL_REQUIRED");
  const normalized = validateWorkspaceWritingRequest(request);
  const raw = await model.complete({
    system: [
      "You are PCC's private Writing Room producer.",
      "Write the requested book or series draft using only the supplied brief and writing context.",
      "Return a JSON object with one string field named draft_text.",
      "This output is an unapproved private draft. Do not claim canon status, approval, publication, or rights not present in the supplied context.",
      "Respect any requested length, audience, voice, format, and ending in the supplied context. Do not add unsupported facts to an established story world.",
    ].join(" "),
    user: JSON.stringify({
      output_type: normalized.outputType,
      title: normalized.title,
      creative_brief: normalized.idea,
      writing_context: normalized.writingContext,
      draft_status: "PRIVATE_DRAFT_UNAPPROVED",
    }),
  });
  return { ...normalized, draftText: parseWorkspaceWritingDraft(raw) };
}

export async function storeWorkspaceWritingDraft({ service, model, payload, request, routeReceipt, contentKind }) {
  const approvalId = String(payload.execution_approval.approval_id);
  const { data: existing, error: lookupError } = await service.from("pcc_workspace_writing_drafts_v1")
    .select("writing_draft_id,producer_job_id,source_system_subject,review_action_id,approval_id,payload_sha256,content_kind,title,canon_status,publication_eligible")
    .eq("intake_id", payload.intake_id).eq("dispatch_action_id", payload.dispatch_action_id).maybeSingle();
  if (lookupError) throw new Error("PCC_WRITING_ROOM_IDEMPOTENCY_LOOKUP_FAILED");
  if (existing) {
    if (existing.source_system_subject !== payload.source_system_subject
        || existing.review_action_id !== payload.review_action_id
        || existing.approval_id !== approvalId
        || existing.payload_sha256 !== payload.payload_sha256
        || existing.content_kind !== contentKind
        || existing.title !== request.title) {
      throw new Error("PCC_WRITING_ROOM_IDEMPOTENCY_MISMATCH");
    }
    return { saved: existing, idempotentReplay: true };
  }

  const generated = await createWorkspaceWritingDraft({ model, request });
  const { data: saved, error: saveError } = await service.rpc("pcc_workspace_writing_draft_create_v1", {
    p_source_system_subject: payload.source_system_subject,
    p_intake_id: payload.intake_id,
    p_dispatch_action_id: payload.dispatch_action_id,
    p_review_action_id: payload.review_action_id,
    p_approval_id: approvalId,
    p_payload_sha256: payload.payload_sha256,
    p_content_kind: contentKind,
    p_title: generated.title,
    p_content_text: generated.draftText,
    p_writing_context: generated.writingContext,
    p_route_receipt: routeReceipt,
  });
  if (saveError || !saved || saved.ok !== true || !saved.writing_draft_id) {
    throw new Error("PCC_WRITING_ROOM_DRAFT_STORE_FAILED");
  }
  return { saved, idempotentReplay: false };
}
