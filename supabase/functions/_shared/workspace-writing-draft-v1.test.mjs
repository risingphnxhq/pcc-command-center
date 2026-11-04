import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceWritingDraft, parseWorkspaceWritingDraft, storeWorkspaceWritingDraft, validateWorkspaceWritingRequest } from "./workspace-writing-draft-v1.mjs";

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

function fakeService(existing = null, rpcData = null) {
  const calls = [];
  const query = {
    select(fields) { calls.push({ select: fields }); return this; },
    eq(key, value) { calls.push({ eq: [key, value] }); return this; },
    async maybeSingle() { return { data: existing, error: null }; },
  };
  return {
    calls,
    from(table) { calls.push({ from: table }); return query; },
    async rpc(name, args) { calls.push({ rpc: name, args }); return { data: rpcData, error: null }; },
  };
}

const basePayload = {
  source_system_subject: "00000000-0000-4000-8000-000000000001",
  intake_id: "00000000-0000-4000-8000-000000000002",
  dispatch_action_id: "00000000-0000-4000-8000-000000000003",
  review_action_id: "00000000-0000-4000-8000-000000000004",
  payload_sha256: "a".repeat(64),
  execution_approval: { approval_id: "00000000-0000-4000-8000-000000000005" },
};

test("stores a generated draft with the approved lineage and private route receipt", async () => {
  const service = fakeService(null, { ok: true, writing_draft_id: "draft-1", producer_job_id: "job-1", canon_status: "UNAPPROVED" });
  const result = await storeWorkspaceWritingDraft({
    service,
    payload: basePayload,
    request: { outputType: "BOOK_CHAPTER", title: "Chapter One", idea: "Opening scene.", writingContext: { canon_status: "UNAPPROVED" } },
    routeReceipt: { destination: { destination_type: "PCC_WRITING_ROOM" }, publication_eligible: false },
    contentKind: "BOOK",
    model: { complete: async () => JSON.stringify({ draft_text: "A private draft." }) },
  });
  const rpc = service.calls.find(call => call.rpc);
  assert.equal(rpc.rpc, "pcc_workspace_writing_draft_create_v1");
  assert.equal(rpc.args.p_approval_id, basePayload.execution_approval.approval_id);
  assert.equal(rpc.args.p_content_text, "A private draft.");
  assert.equal(rpc.args.p_route_receipt.publication_eligible, false);
  assert.equal(result.saved.writing_draft_id, "draft-1");
  assert.equal(result.idempotentReplay, false);
});

test("returns a matching prior draft without calling the model or write RPC", async () => {
  const service = fakeService({ ...basePayload, approval_id: basePayload.execution_approval.approval_id, writing_draft_id: "draft-existing", producer_job_id: "job-existing", content_kind: "BOOK", title: "Chapter One", canon_status: "UNAPPROVED", publication_eligible: false });
  const result = await storeWorkspaceWritingDraft({
    service, payload: basePayload,
    request: { outputType: "BOOK_CHAPTER", title: "Chapter One", idea: "Opening scene." },
    routeReceipt: {}, contentKind: "BOOK",
    model: { complete: async () => { throw new Error("must not regenerate"); } },
  });
  assert.equal(result.saved.writing_draft_id, "draft-existing");
  assert.equal(result.idempotentReplay, true);
  assert.equal(service.calls.some(call => call.rpc), false);
});

test("rejects an idempotency collision across execution approvals", async () => {
  const service = fakeService({ ...basePayload, approval_id: "other-approval", writing_draft_id: "draft-existing", content_kind: "BOOK", title: "Chapter One" });
  await assert.rejects(() => storeWorkspaceWritingDraft({
    service, payload: basePayload,
    request: { outputType: "BOOK_CHAPTER", title: "Chapter One", idea: "Opening scene." },
    routeReceipt: {}, contentKind: "BOOK", model: { complete: async () => "{}" },
  }), /IDEMPOTENCY_MISMATCH/);
});
