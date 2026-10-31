const VIDEO_OUTPUTS = new Set([
  "EPISODE", "SERIES_EPISODE", "ANIMATION", "AD", "REEL", "MICRO_DRAMA",
  "CORPORATE_MARKETING", "CORPORATE_JINGLE", "TV_SPOT", "TV_COMMERCIAL", "SOCIAL_MEDIA_CAMPAIGN",
]);
const normalize = (value) => String(value ?? "").trim().replace(/\\s+/g, " ");
const fail = (id, detail) => ({id, result:"FAIL", detail});

/**
 * Deterministic contract between the reviewed master script and downstream
 * PMF scene/shot planning. The model supplies creative descriptions, never
 * authority IDs; PMF assigns and validates IDs from registered manifests.
 */
export function validateProductionBreakdown(outputType, draft, input = {}) {
  const gates = [];
  if (!VIDEO_OUTPUTS.has(outputType)) return {required:false, ok:true, gates, failures:[]};
  const scenes = draft?.production_breakdown;
  const segments = draft?.channel_segments;
  const add = (id, ok, detail) => gates.push({id, result:ok ? "PASS" : "FAIL", detail});
  add("PRODUCTION_BREAKDOWN_PRESENT", Array.isArray(scenes) && scenes.length > 0 && scenes.length <= 120,
    "Video outputs require an ordered scene and shot breakdown.");
  if (!Array.isArray(scenes) || scenes.length === 0 || scenes.length > 120) {
    return {required:true, ok:false, gates, failures:gates.filter(g => g.result === "FAIL")};
  }
  add("PRODUCTION_SEGMENTS_PRESENT", Array.isArray(segments) && segments.length > 0,
    "The production breakdown must map back to channel segments.");
  if (!Array.isArray(segments) || segments.length === 0) {
    return {required:true, ok:false, gates, failures:gates.filter(g => g.result === "FAIL")};
  }
  add("PRODUCTION_SCENE_ORDER", scenes.every((scene, i) => scene?.scene_number === i + 1),
    "Scene numbers must be contiguous and start at one.");
  const segmentScripts = new Map(segments.map(segment => [segment.index, []]));
  let shapesOk = true;
  for (const scene of scenes) {
    if (!Number.isInteger(scene?.segment_index) || !segmentScripts.has(scene.segment_index)
        || typeof scene?.scene_script !== "string" || !scene.scene_script.trim()
        || typeof scene?.heading !== "string" || !scene.heading.trim()
        || typeof scene?.visual_action !== "string" || !scene.visual_action.trim()
        || typeof scene?.camera !== "string" || !scene.camera.trim()
        || !Number.isFinite(scene?.duration_seconds) || scene.duration_seconds <= 0 || scene.duration_seconds > 600
        || !Array.isArray(scene?.dialogue) || !Array.isArray(scene?.sound_cues)
        || !Array.isArray(scene?.keyframes) || scene.keyframes.length < 2 || scene.keyframes.length > 12) {
      shapesOk = false;
      continue;
    }
    segmentScripts.get(scene.segment_index).push(scene.scene_script);
    if (scene.dialogue.some(line => !line || typeof line.speaker !== "string" || !line.speaker.trim()
        || typeof line.text !== "string" || !line.text.trim()
        || typeof line.delivery !== "string" || !line.delivery.trim())) shapesOk = false;
    if (scene.sound_cues.some(cue => !cue || typeof cue.cue !== "string" || !cue.cue.trim()
        || !Number.isFinite(cue.start_seconds) || cue.start_seconds < 0 || cue.start_seconds > scene.duration_seconds)) shapesOk = false;
    if (!scene.keyframes.every((frame, i) => frame && typeof frame.description === "string" && frame.description.trim()
        && Number.isFinite(frame.frame_fraction) && frame.frame_fraction >= 0 && frame.frame_fraction <= 1
        && (i === 0 || frame.frame_fraction > scene.keyframes[i - 1].frame_fraction))
        || scene.keyframes[0]?.frame_fraction !== 0 || scene.keyframes.at(-1)?.frame_fraction !== 1) shapesOk = false;
  }
  add("PRODUCTION_SCENE_FIELDS", shapesOk,
    "Each scene needs script, visual/camera direction, bounded duration, dialogue and sound cue arrays, and ordered start/end keyframes.");
  const coverageOk = [...segmentScripts].every(([index, scripts]) => {
    const source = segments.find(segment => segment.index === index)?.script;
    return scripts.length > 0 && normalize(scripts.join(" ")) === normalize(source);
  });
  add("PRODUCTION_SCRIPT_COVERAGE", coverageOk,
    "Ordered scene script text must reproduce every channel segment exactly after whitespace normalization.");
  const totalDuration = scenes.reduce((sum, scene) => sum + (Number.isFinite(scene?.duration_seconds) ? scene.duration_seconds : 0), 0);
  const outputSpec = input?.channel_policy?.output_spec;
  const minDuration = outputSpec?.min_total_duration_seconds;
  const maxDuration = outputSpec?.max_total_duration_seconds;
  const targetDuration = outputSpec?.target_total_duration_seconds;
  add("PRODUCTION_DURATION_LIMIT", (!Number.isFinite(minDuration) || totalDuration >= minDuration)
      && (!Number.isFinite(maxDuration) || totalDuration <= maxDuration),
    "The breakdown falls outside the registered total duration range.");
  if (Number.isFinite(targetDuration)) {
    add("PRODUCTION_DURATION_TARGET", totalDuration === targetDuration,
      "The breakdown must match the exact runtime allocated by the approved destination policy.");
  }
  return {required:true, ok:gates.every(g => g.result === "PASS"), total_duration_seconds:totalDuration,
    scene_count:scenes.length, gates, failures:gates.filter(g => g.result === "FAIL")};
}
