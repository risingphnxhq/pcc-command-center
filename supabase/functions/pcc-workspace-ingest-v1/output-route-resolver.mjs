// PSC-backed output routing for GPT workspace submissions.
// This resolves intent only. It never authorizes production, rendering, or publication.
export const ROUTE_CONTRACT_VERSION = "pcc-output-route-v1";

const CHANNELS = {
  phoenix_goldmind: "Phoenix GoldMind",
  valarian_shadow: "Valarian Shadow",
  shadowframe: "ShadowFrame",
  phnx_studios: "PHNX Studios",
  phnx_sports: "PHNX Sports",
  rpe: "RPE",
  phnx_kids: "PHNX Kids",
  phnx_kitchen: "PHNX Kitchen",
  phnx_faceless_reels: "PHNX Faceless Reels",
  phoenix_gold_words: "Phoenix GoldWords",
};

const KNOWN_OPERATIONS = new Set(["CAPTURE", "AUTHOR", "PRODUCE", "DISTRIBUTE"]);
const MEDIA_OUTPUTS = new Set(["AD", "REEL", "SHORT", "VIDEO"]);
const SPIDER_YOUTUBE_KINDS = new Set(["AD", "REEL", "SHORT", "EPISODE", "VIDEO", "IMAGE"]);
const PSN_KINDS = new Set(["SERIES", "EPISODE"]);

function clean(value, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function producerFor(kind, operation) {
  if (operation === "CAPTURE") return ["PCC_WORKSPACE_INTAKE"];
  if (operation === "DISTRIBUTE") return [];
  if (operation === "AUTHOR") {
    if (kind === "BOOK" || kind === "SERIES") return ["PCC_WRITING_ROOM"];
    if (kind === "EPISODE" || MEDIA_OUTPUTS.has(kind)) return ["PCC_PLAYWRIGHT", "BOAS_KNOAS_DIRECTOR"];
    return ["PCC_CLASSIFICATION"];
  }
  if (kind === "BOOK") return [];
  if (kind === "CONCEPT" || kind === "DOCUMENT" || kind === "OTHER") return ["PCC_CLASSIFICATION"];
  if (kind === "SERIES") return ["PCC_WRITING_ROOM"];
  if (kind === "EPISODE") return ["PCC_PLAYWRIGHT", "BOAS_KNOAS_DIRECTOR", "PMF_ANIMATION"];
  if (MEDIA_OUTPUTS.has(kind)) return ["PCC_PLAYWRIGHT", "BOAS_KNOAS_DIRECTOR", "PMF_MEDIA"];
  if (kind === "IMAGE") return ["PCC_ASSET_INGEST", "PNG_ASSET_REGISTRY"];
  if (kind === "AUDIO") return ["PCC_ASSET_INGEST", "SVW_VOICE_ORCHESTRATOR"];
  return [];
}

function placementProducer(placement, operation) {
  if (placement?.destination_type === "PSN_CATALOG" && placement.platform === "PSN") {
    return operation === "DISTRIBUTE" ? ["PMF_RESULT_INTAKE", "PSN_RELEASE"] : operation === "AUTHOR" ? [] : ["PSN_CATALOG"];
  }
  if (placement?.destination_type === "SPIDER_YOUTUBE" && placement.platform === "YOUTUBE") return ["SPIDER_DISTRIBUTION"];
  return [];
}
export function resolveOutputRoute(input = {}) {
  const kind = clean(input.content_kind, 40).toUpperCase();
  const operation = clean(input.requested_operation, 40).toUpperCase() || "PRODUCE";
  const submittedPlacements = Array.isArray(input.placements) ? input.placements : [];
  // Authoring a book chapter creates a private draft destination. It is not a
  // public catalog placement and does not imply canon approval or publication.
  const placementsInput = operation === "AUTHOR" && kind === "BOOK" && submittedPlacements.length === 0
    ? [{ destination_type: "PCC_WRITING_ROOM", destination_id: "draft" }]
    : submittedPlacements;
  const reasons = [];
  const requiredGates = new Set([
    "PCC_APPROVAL",
    "SOURCE_POLICY_VERIFICATION",
    "PRODUCER_ADMISSION",
    "RENDER_OR_ASSET_QA",
    "PUBLICATION_APPROVAL",
  ]);

  if (!KNOWN_OPERATIONS.has(operation)) reasons.push("UNSUPPORTED_OPERATION");
  if (!kind) reasons.push("CONTENT_KIND_REQUIRED");
  if (placementsInput.length > 4) reasons.push("TOO_MANY_PLACEMENTS");
  if (operation !== "CAPTURE" && placementsInput.length === 0) reasons.push("VIEWING_PLACEMENT_REQUIRED");
  if (operation === "DISTRIBUTE") requiredGates.add("COMPLETED_ASSET_RECEIPT");

  const placements = placementsInput.slice(0, 4).map((raw) => {
    const destinationType = clean(raw?.destination_type, 50).toUpperCase();
    const placement = {
      destination_type: destinationType || "UNSPECIFIED",
      destination_id: null,
      platform: null,
      viewer_surface: null,
      placement_format: clean(raw?.placement_format, 80) || kind,
      channel_key: null,
      connection_state: "MUST_REVALIDATE_AT_EXECUTION",
      release_state: "HELD",
    };
    if (destinationType === "PSN_CATALOG") {
      const id = clean(raw?.destination_id, 80).toLowerCase();
      if (id !== "phnx_phanimation") {
        reasons.push("UNKNOWN_PSN_CATALOG");
      } else if (!PSN_KINDS.has(kind)) {
        reasons.push("CONTENT_KIND_NOT_SUPPORTED_BY_PSN_CATALOG");
      } else {
        placement.destination_id = id;
        placement.platform = "PSN";
        placement.viewer_surface = "PHNX_PHANIMATION_STREAMING_CATALOG";
        placement.viewer_url = "https://risingphnxhq.github.io/phnx-phanimation/";
        placement.release_gate = "APPROVED_PSN_RELEASE_PACKAGE_REQUIRED";
        placement.expected_duration_seconds = kind === "EPISODE" ? 1500 : null;
        placement.duration_policy = kind === "EPISODE" ? "PHANIMATION_25_MINUTE_EPISODE" : null;
        requiredGates.add("PSN_CERTIFICATE_AND_ENTITLEMENT");
      }
    } else if (destinationType === "PCC_WRITING_ROOM") {
      if (operation !== "AUTHOR" || kind !== "BOOK" && kind !== "SERIES") {
        reasons.push("PCC_WRITING_ROOM_AUTHORING_ONLY");
      } else {
        placement.destination_id = clean(raw?.destination_id, 80).toLowerCase() || "draft";
        placement.platform = "PCC";
        placement.viewer_surface = "PCC_PRIVATE_WRITING_ROOM";
        placement.release_gate = "DRAFT_REVIEW_REQUIRED_NO_CANON_OR_PUBLICATION";
        placement.connection_state = "INTERNAL_DRAFT_ROUTE";
      }
    } else if (destinationType === "SPIDER_YOUTUBE") {
      const channelKey = clean(raw?.channel_key, 80).toLowerCase();
      if (!Object.hasOwn(CHANNELS, channelKey)) {
        reasons.push("KNOWN_YOUTUBE_CHANNEL_KEY_REQUIRED");
      } else if (!SPIDER_YOUTUBE_KINDS.has(kind)) {
        reasons.push("CONTENT_KIND_NOT_SUPPORTED_BY_SPIDER_YOUTUBE_ROUTE");
      } else {
        placement.destination_id = channelKey;
        placement.channel_key = channelKey;
        placement.channel_name = CHANNELS[channelKey];
        placement.platform = "YOUTUBE";
        placement.viewer_surface = "SPIDER_AUTHORIZED_YOUTUBE_CHANNEL";
        placement.release_gate = "REVALIDATE_SPIDER_CONNECTION_AND_REQUIRE_PUBLICATION_APPROVAL";
        if (kind === "EPISODE" && channelKey === "phnx_kids") {
          placement.expected_duration_range_seconds = { min: 180, max: 300 };
          placement.duration_policy = "PHOENIX_KIDS_EPISODES_3_TO_5_MINUTES";
        }
        requiredGates.add("SPIDER_CHANNEL_CONNECTION_REVALIDATION");
      }
    } else {
      reasons.push("DESTINATION_MAPPING_NOT_IN_APPROVED_ROUTE_REGISTRY");
    }
    return placement;
  });

  const baseProducerChain = producerFor(kind, operation);
  const destinationProducers = placements.flatMap((placement) => placementProducer(placement, operation));
  const producerChain = [...new Set([...baseProducerChain, ...destinationProducers])];
  if (producerChain.length === 0) reasons.push("PRODUCER_MAPPING_NOT_IN_APPROVED_ROUTE_REGISTRY");
  const primary = placements[0];
  if (kind === "BOOK" && operation !== "AUTHOR" && operation !== "CAPTURE") {
    reasons.push("BOOK_PRODUCTION_DESTINATION_NOT_ESTABLISHED");
  }
  if ((kind === "SERIES" || kind === "EPISODE") &&
      primary?.destination_type !== "PSN_CATALOG" &&
      primary?.destination_type !== "SPIDER_YOUTUBE") {
    reasons.push("SERIES_OR_EPISODE_DESTINATION_REQUIRED");
  }
  if (kind === "SERIES" && primary?.destination_type !== "PSN_CATALOG") {
    reasons.push("SERIES_CATALOG_ROUTE_NOT_ESTABLISHED_FOR_SELECTED_DESTINATION");
  }
  if (kind === "BOOK" && operation !== "CAPTURE" && operation !== "AUTHOR") reasons.push("MANUSCRIPT_VIEWER_OR_STORE_NOT_ESTABLISHED");
  if (kind === "BOOK" && operation === "AUTHOR" && primary?.destination_type !== "PCC_WRITING_ROOM") {
    reasons.push("PCC_WRITING_ROOM_DRAFT_DESTINATION_REQUIRED");
  }
  if (kind === "CONCEPT" || kind === "DOCUMENT" || kind === "OTHER") {
    reasons.push("CLASSIFICATION_REQUIRED_BEFORE_PRODUCTION");
  }
  if (kind === "IMAGE" || kind === "AUDIO") {
    reasons.push("ASSET_RIGHTS_AND_CHANNEL_USE_APPROVAL_REQUIRED");
  }

  const uniqueReasons = [...new Set(reasons)];
  const mappingComplete = uniqueReasons.length === 0 && producerChain.length > 0;
  return {
    contract_version: ROUTE_CONTRACT_VERSION,
    requested_operation: operation,
    content_kind: kind,
    resolution_status: mappingComplete ? "RESOLVED_HELD" : "BLOCKED",
    producer_chain: producerChain,
    placements,
    intended_viewing_surfaces: placements.map((p) => ({
      destination_type: p.destination_type,
      destination_id: p.destination_id,
      platform: p.platform,
      viewer_surface: p.viewer_surface,
      viewer_url: p.viewer_url || null,
      placement_format: p.placement_format,
      expected_duration_seconds: p.expected_duration_seconds || null,
      expected_duration_range_seconds: p.expected_duration_range_seconds || null,
      duration_policy: p.duration_policy || null,
      release_state: p.release_state,
    })),
    required_gates: [...requiredGates],
    block_reasons: uniqueReasons,
    execution_eligible: false,
    publication_eligible: false,
  };
}
