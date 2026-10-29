const OUTPUT_LANES = new Map([
  ["EPISODE", "NARRATIVE"], ["SERIES_EPISODE", "NARRATIVE"], ["ANIMATION", "NARRATIVE"],
  ["AD", null], ["REEL", null], ["MICRO_DRAMA", "NARRATIVE"], ["NOVEL", "NARRATIVE"],
  ["BOOK_MANUSCRIPT", "NARRATIVE"], ["BOOK_CHAPTER", "NARRATIVE"], ["BOOK_SCENE", "NARRATIVE"],
  ["CORPORATE_MARKETING", "MARKETING"], ["CORPORATE_JINGLE", "MARKETING"],
  ["TV_SPOT", "MARKETING"], ["TV_COMMERCIAL", "MARKETING"], ["SOCIAL_MEDIA_CAMPAIGN", "MARKETING"],
  ["OTHER", null],
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/;
const CHANNEL = /^[a-z][a-z0-9_]{1,63}$/;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const requiredId = (v, field) => {
  if (typeof v !== "string" || !ID.test(v.trim())) throw new Error(`POLICY_${field.toUpperCase()}_INVALID`);
  return v.trim();
};
const requiredRevision = (v, field) => {
  if (typeof v !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(v.trim())) {
    throw new Error(`POLICY_${field.toUpperCase()}_INVALID`);
  }
  return v.trim();
};

export function validateAnimationPolicyRegistration(input) {
  if (!isObject(input)) throw new Error("POLICY_INPUT_REQUIRED");
  const channel_key = input.channel_key;
  const output_type = typeof input.output_type === "string" ? input.output_type.toUpperCase() : "";
  if (typeof channel_key !== "string" || !CHANNEL.test(channel_key)) throw new Error("POLICY_CHANNEL_INVALID");
  if (!OUTPUT_LANES.has(output_type)) throw new Error("POLICY_OUTPUT_TYPE_INVALID");
  const production_intent = input.production_intent;
  const lane = OUTPUT_LANES.get(output_type);
  if (lane && production_intent !== lane) throw new Error("POLICY_INTENT_CONFLICT");
  if (!lane && output_type !== "OTHER" && !["MARKETING", "NARRATIVE"].includes(production_intent)) throw new Error("POLICY_INTENT_REQUIRED");
  if (output_type === "OTHER" && production_intent !== "MARKETING" && production_intent !== "NARRATIVE") throw new Error("POLICY_INTENT_REQUIRED");
  const policy = {
    channel_key,
    output_type,
    production_intent,
    policy_revision: requiredRevision(input.policy_revision, "revision"),
    approval_psc_id: requiredId(input.approval_psc_id, "approval_psc_id"),
    boas_id: requiredId(input.boas_id, "boas_id"),
    boas_revision: requiredRevision(input.boas_revision, "boas_revision"),
    boas_psc_id: requiredId(input.boas_psc_id, "boas_psc_id"),
    knoas_id: requiredId(input.knoas_id, "knoas_id"),
    knoas_revision: requiredRevision(input.knoas_revision, "knoas_revision"),
    knoas_psc_id: requiredId(input.knoas_psc_id, "knoas_psc_id"),
    channel_profile: input.channel_profile,
    output_spec: input.output_spec,
    supersedes_policy_id: input.supersedes_policy_id ?? null,
  };
  if (!isObject(policy.channel_profile) || !isObject(policy.output_spec)) throw new Error("POLICY_PROFILE_AND_OUTPUT_SPEC_REQUIRED");
  if (JSON.stringify(policy.channel_profile).length > 40_000 || JSON.stringify(policy.output_spec).length > 40_000) throw new Error("POLICY_PROFILE_TOO_LARGE");
  if (policy.supersedes_policy_id !== null && (typeof policy.supersedes_policy_id !== "string" || !/^[0-9a-f-]{36}$/i.test(policy.supersedes_policy_id))) {
    throw new Error("POLICY_SUPERSESSION_ID_INVALID");
  }
  return policy;
}

export function validateResolvedAnimationPolicy(policy, expected) {
  if (!isObject(policy) || policy.approved !== true || policy.revoked === true) throw new Error("REGISTERED_CHANNEL_POLICY_REQUIRED");
  const normalized = validateAnimationPolicyRegistration(policy);
  if (normalized.channel_key !== expected.channel_key || normalized.output_type !== expected.output_type
      || normalized.production_intent !== expected.production_intent) throw new Error("REGISTERED_CHANNEL_POLICY_MISMATCH");
  const id = typeof policy.policy_id === "string" ? policy.policy_id : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("REGISTERED_CHANNEL_POLICY_ID_INVALID");
  }
  return {
    ...normalized,
    policy_id: id,
    approved: true,
    revoked: false,
  };
}
