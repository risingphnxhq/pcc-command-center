import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceWritingDraft, parseWorkspaceWritingDraft, validateWorkspaceWritingRequest } from "./workspace-writing-draft-v1.mjs";

test("validates book chapter requests and preserves supplied writing context", () => {
  const request = validateWorkspaceWritingRequest({
    outputType: "book_chapter", title: "Chapter One", idea: "Write the opening chapter.",
    writingContext: { series: "OCS", canon_status: "UNAPPROVED" },
  });
  assert.equal(request.outputType, "BOOK_CHAPTER");
  assert.equal(request.writingContext.series, "OCS");
});

test("rejects unsupported producer types and malformed model output", () => {
  assert.throws(() => validateWorkspaceWritingRequest({ outputType: "AD", title: "Ad", idea: "Brief" }), /OUTPUT_TYPE_UNSUPPORTED/);
  assert.throws(() => parseWorkspaceWritingDraft("not json"), /RESPONSE_JSON_INVALID/);
  assert.throws(() => parseWorkspaceWritingDraft(JSON.stringify({ draft_text: " " })), /DRAFT_INVALID/);
});

test("creates a draft without changing the brief or claiming canon approval", async () => {
  let requestSeen;
  const output = await createWorkspaceWritingDraft({
    request: { outputType: "BOOK_CHAPTER", title: "The Weight of Seeing", idea: "A young inventor questions who designed an unfair system.", writingContext: { canon_status: "UNAPPROVED" } },
    model: { complete: async (request) => { requestSeen = request; return JSON.stringify({ draft_text: "The city held its breath." }); } },
  });
  assert.equal(output.draftText, "The city held its breath.");
  assert.match(requestSeen.system, /unapproved private draft/i);
  assert.equal(JSON.parse(requestSeen.user).creative_brief, "A young inventor questions who designed an unfair system.");
});
