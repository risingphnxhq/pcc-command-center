import test from "node:test";
import assert from "node:assert/strict";
import { resolveOutputRoute } from "../supabase/functions/pcc-workspace-ingest-v1/output-route-resolver.mjs";

test("Phanimation episode maps to PSN with the 25-minute viewing contract and stays held", () => {
  const route = resolveOutputRoute({
    content_kind: "EPISODE",
    requested_operation: "PRODUCE",
    placements: [{ destination_type: "PSN_CATALOG", destination_id: "phnx_phanimation" }],
  });
  assert.equal(route.resolution_status, "RESOLVED_HELD");
  assert.deepEqual(route.producer_chain, ["PCC_WRITER", "PMF_ANIMATION", "PSN_CATALOG"]);
  assert.equal(route.placements[0].expected_duration_seconds, 1500);
  assert.equal(route.placements[0].viewer_surface, "PHNX_PHANIMATION_STREAMING_CATALOG");
  assert.equal(route.execution_eligible, false);
  assert.equal(route.publication_eligible, false);
});

test("Phoenix Kids episode resolves its YouTube channel and channel episode duration profile", () => {
  const route = resolveOutputRoute({
    content_kind: "EPISODE",
    requested_operation: "PRODUCE",
    placements: [{ destination_type: "SPIDER_YOUTUBE", channel_key: "phnx_kids" }],
  });
  assert.equal(route.resolution_status, "RESOLVED_HELD");
  assert.deepEqual(route.placements[0].expected_duration_range_seconds, { min: 180, max: 300 });
  assert.equal(route.placements[0].channel_name, "PHNX Kids");
  assert.ok(route.required_gates.includes("SPIDER_CHANNEL_CONNECTION_REVALIDATION"));
});

test("missing placement fails closed", () => {
  const route = resolveOutputRoute({ content_kind: "SHORT", requested_operation: "PRODUCE" });
  assert.equal(route.resolution_status, "BLOCKED");
  assert.ok(route.block_reasons.includes("VIEWING_PLACEMENT_REQUIRED"));
  assert.equal(route.execution_eligible, false);
});

test("unregistered channel and unmapped platform fail closed", () => {
  const unknownChannel = resolveOutputRoute({
    content_kind: "REEL",
    placements: [{ destination_type: "SPIDER_YOUTUBE", channel_key: "made_up_channel" }],
  });
  assert.equal(unknownChannel.resolution_status, "BLOCKED");
  assert.ok(unknownChannel.block_reasons.includes("KNOWN_YOUTUBE_CHANNEL_KEY_REQUIRED"));

  const unknownPlatform = resolveOutputRoute({
    content_kind: "AD",
    placements: [{ destination_type: "INSTAGRAM", channel_key: "phnx_kids" }],
  });
  assert.equal(unknownPlatform.resolution_status, "BLOCKED");
  assert.ok(unknownPlatform.block_reasons.includes("DESTINATION_MAPPING_NOT_IN_APPROVED_ROUTE_REGISTRY"));
});

test("books can be captured for PCC but cannot be sent to an unapproved viewing destination", () => {
  const captured = resolveOutputRoute({ content_kind: "BOOK", requested_operation: "CAPTURE" });
  assert.equal(captured.resolution_status, "RESOLVED_HELD");
  assert.deepEqual(captured.producer_chain, ["PCC_WORKSPACE_INTAKE"]);

  const produced = resolveOutputRoute({
    content_kind: "BOOK",
    requested_operation: "PRODUCE",
    placements: [{ destination_type: "SPIDER_YOUTUBE", channel_key: "rpe" }],
  });
  assert.equal(produced.resolution_status, "BLOCKED");
  assert.ok(produced.block_reasons.includes("BOOK_PRODUCTION_DESTINATION_NOT_ESTABLISHED"));
  assert.ok(produced.block_reasons.includes("MANUSCRIPT_VIEWER_OR_STORE_NOT_ESTABLISHED"));
});

test("unsupported concepts are classified, not silently dispatched", () => {
  const route = resolveOutputRoute({
    content_kind: "CONCEPT",
    requested_operation: "PRODUCE",
    placements: [{ destination_type: "SPIDER_YOUTUBE", channel_key: "rpe" }],
  });
  assert.equal(route.resolution_status, "BLOCKED");
  assert.deepEqual(route.producer_chain, ["PCC_CLASSIFICATION"]);
  assert.ok(route.block_reasons.includes("CLASSIFICATION_REQUIRED_BEFORE_PRODUCTION"));
});

test("one production request preserves every selected viewing destination in the producer chain", () => {
  const route = resolveOutputRoute({
    content_kind: "EPISODE",
    requested_operation: "PRODUCE",
    placements: [
      { destination_type: "PSN_CATALOG", destination_id: "phnx_phanimation" },
      { destination_type: "SPIDER_YOUTUBE", channel_key: "phnx_kids" },
    ],
  });
  assert.equal(route.resolution_status, "RESOLVED_HELD");
  assert.deepEqual(route.producer_chain, [
    "PCC_WRITER", "PMF_ANIMATION", "PSN_CATALOG", "SPIDER_DISTRIBUTION",
  ]);
  assert.equal(route.intended_viewing_surfaces.length, 2);
});
