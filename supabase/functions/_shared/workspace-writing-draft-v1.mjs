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
