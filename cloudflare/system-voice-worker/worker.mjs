import { telephony } from './telephony.mjs';
import { calling } from './calling.mjs';
const SERVICE_NAME = "phoenix_system_voice";
const SERVICE_VERSION = "v9.5.0-corporate-streaming-pilot";
const SYSTEM_ID = "SVW";

const ALLOWED_PERSONAS = [
  "nace", "chad", "alexis", "michael", "oliver",
  "jordan", "patrick", "marcus", "rebecca", "aiden", "avery",
  "derrick", "peggy", "sylvia", "simone", "julian",
  "elena", "nathan", "adrian", "victor", "ariel"
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      const callResponse = await telephony(request, env, ctx, (persona, bindings) =>
        ALLOWED_PERSONAS.includes(persona) ? bindings[persona.toUpperCase() + '_VOICE_ID'] : null);
      if (callResponse) return callResponse;
      const commandResponse = await calling(request, env, ctx, (persona, bindings) => ALLOWED_PERSONAS.includes(persona) ? bindings[persona.toUpperCase() + '_VOICE_ID'] : null);
      if (commandResponse) return commandResponse;
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }

      if (url.pathname === "/" || url.pathname === "/health") {
        return jsonResponse({
          ok: true,
          system: SYSTEM_ID,
          service: SERVICE_NAME,
          version: SERVICE_VERSION,
          doctrine: "AWWD",
          pcc_voice_execute: true,
          ready: true,
          timestamp: new Date().toISOString()
        });
      }

      if (url.pathname === "/debug/env") {
        return jsonResponse({
          ok: true,
          ELEVENLABS_API_KEY: Boolean(env.ELEVENLABS_API_KEY),
          OPENAI_API_KEY: Boolean(env.OPENAI_API_KEY),
          TWILIO_AUDIO_TOKEN: Boolean(env.TWILIO_AUDIO_TOKEN),
          NACE_VOICE_ID: Boolean(env.NACE_VOICE_ID),
          CHAD_VOICE_ID: Boolean(env.CHAD_VOICE_ID),
          ALEXIS_VOICE_ID: Boolean(env.ALEXIS_VOICE_ID),
          MICHAEL_VOICE_ID: Boolean(env.MICHAEL_VOICE_ID),
          OLIVER_VOICE_ID: Boolean(env.OLIVER_VOICE_ID),
          JORDAN_VOICE_ID: Boolean(env.JORDAN_VOICE_ID),
          PATRICK_VOICE_ID: Boolean(env.PATRICK_VOICE_ID),
          MARCUS_VOICE_ID: Boolean(env.MARCUS_VOICE_ID),
          REBECCA_VOICE_ID: Boolean(env.REBECCA_VOICE_ID),
          AIDEN_VOICE_ID: Boolean(env.AIDEN_VOICE_ID),
          AVERY_VOICE_ID: Boolean(env.AVERY_VOICE_ID),
          DERRICK_VOICE_ID: Boolean(env.DERRICK_VOICE_ID),
          PEGGY_VOICE_ID: Boolean(env.PEGGY_VOICE_ID),
          SYLVIA_VOICE_ID: Boolean(env.SYLVIA_VOICE_ID),
          SIMONE_VOICE_ID: Boolean(env.SIMONE_VOICE_ID),
          JULIAN_VOICE_ID: Boolean(env.JULIAN_VOICE_ID),
          ELENA_VOICE_ID: Boolean(env.ELENA_VOICE_ID),
          NATHAN_VOICE_ID: Boolean(env.NATHAN_VOICE_ID),
          ADRIAN_VOICE_ID: Boolean(env.ADRIAN_VOICE_ID),
          VICTOR_VOICE_ID: Boolean(env.VICTOR_VOICE_ID),
          ARIEL_VOICE_ID: Boolean(env.ARIEL_VOICE_ID)
        });
      }

      if (url.pathname === "/voice/tts" && request.method === "GET") {
        const text = url.searchParams.get("text") || "Phoenix voice system is online.";
        const persona = url.searchParams.get("persona_key") || "nace";
        return streamAudio(text, persona, env);
      }

      // PCC → SVW direct voice execution endpoint
      if (url.pathname === "/voice/execute" && request.method === "POST") {
        return handleVoiceExecute(request, env);
      }

      if (url.pathname === "/voice/plan" && request.method === "POST") {
        const payload = await safeJson(request);
        const activePersona = safePersona(payload.active_persona || "nace");
        const plan = await generateVoicePlan(payload.speech || payload.text || "", env, activePersona);
        return jsonResponse({ ok: true, plan });
      }

      if (url.pathname === "/twilio/voice" && request.method === "POST") {
        return handleTwilioVoice(request, env);
      }

      if (url.pathname === "/twilio/gather" && request.method === "POST") {
        return handleTwilioGather(request, env);
      }

      if (url.pathname === "/twilio/audio" && request.method === "GET") {
        return handleTwilioAudio(request, env);
      }

      return jsonResponse({ ok: false, error: "Route not found" }, 404);
    } catch (err) {
      return handleError(err);
    }
  }
};

async function handleTwilioVoice(request, env) { 
  const baseUrl = new URL(request.url).origin;

  const greeting =
    "Thank you for calling Rising Phoenix Enterprises. This is Nace, the system communication intelligence layer. What can I help you with today?";

  const audioUrl = buildAudioUrl(baseUrl, greeting, "nace", "greeting", env);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${escapeXml(audioUrl)}</Play>
  <Gather input="speech" action="${escapeXml(baseUrl + "/twilio/gather?active_persona=nace")}" method="POST" speechTimeout="1" timeout="4">
  <Pause length="1"/>
  </Gather>
  <Redirect method="POST">${escapeXml(baseUrl + "/twilio/voice")}</Redirect>
</Response>`;

  return twimlResponse(twiml);
}

async function handleTwilioGather(request, env) {
  const requestUrl = new URL(request.url);
  const baseUrl = requestUrl.origin;
  const activePersona = safePersona(requestUrl.searchParams.get("active_persona") || "nace");

  const form = await request.formData();

  const speech =
    form.get("SpeechResult") ||
    form.get("speechResult") ||
    form.get("Body") ||
    "";

  const requestedPersona = detectRequestedPersona(String(speech || ""));
  let plan = await generateVoicePlan(String(speech || ""), env, activePersona);

  if (requestedPersona && requestedPersona !== activePersona) {
    plan = normalizeVoicePlan({
      persona_key: requestedPersona,
      preface_speaker: "nace",
      preface_text: "Transferring you now.",
      delay_seconds: 1,
      response_text: personaPickupLine(requestedPersona),
      action: "speak",
      target: "voice_engine",
      metadata: {}
    }, activePersona);
  }

  const parts = [];

  if (plan.preface_text) {
    const prefaceUrl = buildAudioUrl(
      baseUrl,
      plan.preface_text,
      plan.preface_speaker || "nace",
      "preface",
      env
    );

    parts.push(`<Play>${escapeXml(prefaceUrl)}</Play>`);

    if (plan.delay_seconds > 0) {
      parts.push(`<Pause length="${plan.delay_seconds}"/>`);
    }
  }

  const responseUrl = buildAudioUrl(
    baseUrl,
    plan.response_text,
    plan.persona_key,
    "response",
    env
  );

  parts.push(`<Play>${escapeXml(responseUrl)}</Play>`);

  const nextPersona = safePersona(plan.persona_key || activePersona);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${parts.join("\n  ")}
  <Gather input="speech" action="${escapeXml(baseUrl + "/twilio/gather?active_persona=" + nextPersona)}" method="POST" speechTimeout="1" timeout="4">
    <Pause length="0.5"/>
  </Gather>
  <Redirect method="POST">${escapeXml(baseUrl + "/twilio/gather?active_persona=" + nextPersona)}</Redirect>
</Response>`;

  return twimlResponse(twiml);
}

// =======================================
// PCC VOICE EXECUTE
// PCC sends Voice Plan JSON. SVW returns audio/mpeg.
// =======================================
async function handleVoiceExecute(request, env) {
  const payload = await safeJson(request);
  const plan = payload?.voice_plan || payload || {};

  const text =
    plan.text ||
    plan.response_text ||
    plan.payload?.text ||
    plan.payload?.response_text ||
    "";

  const persona =
    plan.persona_key ||
    plan.speaker ||
    plan.payload?.persona_key ||
    "nace";

  if (!text || !persona) {
    return jsonResponse({
      ok: false,
      error: "INVALID_VOICE_PLAN",
      required: {
        voice_plan: {
          persona_key: "chad",
          text: "This is Chad Pennington. How may I help you?"
        }
      }
    }, 400);
  }

  return streamAudio(text, persona, env);
}

async function handleTwilioAudio(request, env) {
  const url = new URL(request.url);

  const token = url.searchParams.get("token") || "";
  const requiredToken = env.TWILIO_AUDIO_TOKEN || "";

  if (!requiredToken || token !== requiredToken) {
    throw new HttpError(401, "Unauthorized audio request");
  }

  const text = url.searchParams.get("text") || "Phoenix voice system is online.";
  const persona = url.searchParams.get("persona_key") || "nace";

  return streamAudio(text, persona, env);
}

async function streamAudio(text, persona, env) {
  if (!env.ELEVENLABS_API_KEY) {
    throw new HttpError(500, "Missing ELEVENLABS_API_KEY");
  }

  const voiceId = resolveVoiceId(persona, env);

  if (!voiceId) {
    throw new HttpError(500, `Missing voice ID for persona: ${persona}`);
  }

  const cleanText = sanitizeSpeechText(text);

  if (!cleanText) {
    throw new HttpError(400, "Missing speech text");
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: env.ELEVEN_TTS_MODEL_ID || "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.58,
          similarity_boost: 0.78,
          style: 0.12,
          use_speaker_boost: true
        }
      })
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new HttpError(
      502,
      `ElevenLabs error: ${response.status} - ${errText.slice(0, 500)}`
    );
  }

  // Begin playback as provider bytes arrive, rather than buffering the entire reply.
  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
      ...corsHeaders()
    }
  });
}

async function generateVoicePlan(input, env, activePersona = "nace") {
  const clean = String(input || "").trim();

  if (!clean) {
    return normalizeVoicePlan({
      persona_key: activePersona || "nace",
      preface_speaker: null,
      preface_text: null,
      delay_seconds: 0,
      response_text: "I did not catch that. What are you calling about today?",
      action: "speak",
      target: "voice_engine",
      metadata: {}
    }, activePersona);
  }

  if (!env.OPENAI_API_KEY) {
    return fallbackVoicePlan(activePersona);
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-4.1-mini",
        temperature: 0.18,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are not an assistant.

You are operating as executive personnel within Rising Phoenix Enterprises.

All personas represent top 1% business executives.

You must speak, think, and respond with executive-level authority, control, precision, and composure.

You do not behave like a chatbot, assistant, or support agent.

You are directive, outcome-focused, and in control of the conversation.

AI decides. Workers execute.

Allowed persona_key values:
nace, chad, alexis, michael, oliver, jordan, patrick, marcus, rebecca, aiden, avery, derrick, peggy, sylvia, simone, julian, elena, nathan, adrian, victor, ariel.

Executive identity:
NACE is the system communication intelligence layer for Rising Phoenix Enterprises.
All other personas present as executive personnel, not AI, not tools, and not systems.

Persona authority lanes:
Chad is Corporate COO: Corporate operations, business execution, delivery coordination, office operations, and Corporate troubleshooting. Systems engineering decisions, technical manufacture, integration, and corrective engineering route to Mason Briggs / CSE.
Alexis is Chairwoman: governance, structure, authority alignment, decision integrity.
Michael is CEO: strategy, growth, direction, partnerships, enterprise scale.
Oliver is CFO: capital, finance, risk, revenue discipline.
Jordan handles architecture, scalability, and infrastructure.
Patrick handles engineering, code, system design, and runtime behavior.
Marcus handles distribution, media, channels, and audience reach.
Rebecca handles legal structure, compliance, contracts, and risk routing. She does not provide final legal advice.
Aiden handles audit, validation, verification, receipts, and proof.
Avery handles creative direction, media quality, brand, and visual systems.

Phoenix OS knowledge:
Rising Phoenix Enterprises is the parent enterprise.
Phoenix OS is the intelligence and execution layer coordinating people, personas, workers, governance, execution, receipts, communication, and enterprise systems.
Core systems include PCC, AWWD, PVO/SVW, PBRS, PBB, PQS, PHNX Studios, STATSCORE, Spider, AGIS, and PAIRS.

Executive operating model:
Every response must briefly acknowledge, frame from authority, answer directly, then direct the next step or close the loop.
Do not ramble.
Do not over-explain.
Do not hold open-ended conversation.
Move the call toward understanding, execution, decision, escalation, or closure.

Response rules:
Keep response_text under 20 words unless detail is explicitly requested.
Speak like a real executive on a live business call.
Use natural spoken language only.
No filler, no fluff, no rambling.
No stage directions, sound effects, bracketed actions, markdown, emojis, laughter cues, breathing cues, or non-speech symbols.

Persona pickup rule:
When a caller is transferred to a persona, response_text must ONLY be a simple executive pickup line.
Format: "This is [Full Name]. How may I help you?"
Do not explain the persona’s role during pickup.
Do not answer the caller’s previous question during pickup.
After pickup, wait for the caller’s next input before answering anything.

Handoff rules:
If caller asks for Chad, persona_key MUST be "chad".
If caller asks for Alexis, persona_key MUST be "alexis".
If caller asks for Michael, persona_key MUST be "michael".
If caller asks for Oliver, persona_key MUST be "oliver".
If caller asks for Rebecca, persona_key MUST be "rebecca".
If caller asks for Patrick, persona_key MUST be "patrick".
If caller asks for Marcus, persona_key MUST be "marcus".
If caller asks for Jordan, persona_key MUST be "jordan".
If caller asks for Aiden, persona_key MUST be "aiden".
If caller asks for Avery, persona_key MUST be "avery".
If caller asks for Derrick, persona_key MUST be "derrick".
If caller asks for Adrian, persona_key MUST be "adrian".
If caller asks for Elena, persona_key MUST be "elena".
If caller asks for Peggy, persona_key MUST be "peggy".
If caller asks for Sylvia, persona_key MUST be "sylvia".
If caller asks for Nathan, persona_key MUST be "nathan".
If caller asks for Ariel, persona_key MUST be "ariel".
If caller asks for Victor, persona_key MUST be "victor".
If caller asks for Julian, persona_key MUST be "julian".
For any requested persona handoff, preface_speaker must be "nace", preface_text must be only "Transferring you now.", and delay_seconds must be 1.
For handoffs, response_text must be only the requested persona’s pickup line.
Never set persona_key to "nace" when caller asks for another persona.
If active persona is not "nace", continue as that persona unless caller clearly asks to transfer or change departments.
────────────────────────
EXECUTIVE SPEECH FREEDOM LAYER
────────────────────────

Human Executive Speech Standard:

AI Staff must speak as real human executive personnel in a live business call.

They may use natural executive language such as:
- “Absolutely.”
- “Good question.”
- “From my side…”
- “Here’s the clean path.”
- “Let’s keep this simple.”
- “I’d handle it this way.”
- “What outcome are you trying to get?”
- “That’s the right question.”
- “I’ll take it from here.”

They may:
- ask clarifying questions
- challenge weak thinking professionally
- give direct recommendations
- control the flow of the conversation
- close the call when appropriate

They must NOT sound:
- robotic
- scripted
- like documentation
- like a chatbot

Do NOT force every response into the same structure.
Use executive judgment.

────────────────────────
EXECUTIVE TERMINOLOGY RULES
────────────────────────

AI Staff (non-NACE personas) must NOT use system or technical terminology.

FORBIDDEN:
system, layer, runtime, worker, payload, protocol, module,
execution surface, persona_key, as an AI, I am designed to,
I can assist, processing, architecture explanation

REQUIRED BEHAVIOR:
Translate ALL internal/system concepts into human executive language.

Example:
Instead of:
“The system will process that request”

Say:
“My team will handle that.”

Instead of:
“This module executes the flow”

Say:
“That’s how we run it.”

────────────────────────
BUSINESS CALL CONTROL
────────────────────────

Stay focused on the caller’s objective.

Do not ramble.
Do not over-explain.

If the objective is clear:
→ give the answer
→ recommend the next step
→ move toward closure

If the objective is unclear:
→ ask one direct clarifying question

When complete:
→ close professionally

Example:
“That’s handled. Anything else before we wrap?” 

Output enforcement:
Return ONLY valid JSON. No extra text. No explanation.

Required JSON schema:
{
  "persona_key": "nace",
  "preface_speaker": null,
  "preface_text": null,
  "delay_seconds": 0,
  "response_text": "...",
  "action": "speak",
  "target": "voice_engine",
  "metadata": {}
}`
          },
          {
            role: "user",
            content: `Active persona: ${safePersona(activePersona)}\nCaller said: ${sanitizeSpeechText(clean)}`
          }
        ]
      })
    });

    if (!res.ok) {
      return fallbackVoicePlan(activePersona);
    }

    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    const parsed = parseJsonObject(raw);

    return normalizeVoicePlan(parsed, activePersona);
  } catch {
    return fallbackVoicePlan(activePersona);
  }
}

function normalizeVoicePlan(plan, activePersona = "nace") {
  let personaKey = safePersona(plan?.persona_key || plan?.speaker || activePersona || "nace");

  const rawPreface = String(plan?.preface_text || "");
  const rawResponse = String(plan?.response_text || "");
  const combined = `${rawPreface} ${rawResponse}`.toLowerCase();

  if (combined.includes("this is chad") || combined.includes("connecting you to chad")) personaKey = "chad";
  else if (combined.includes("this is alexis") || combined.includes("connecting you to alexis")) personaKey = "alexis";
  else if (combined.includes("this is michael") || combined.includes("connecting you to michael")) personaKey = "michael";
  else if (combined.includes("this is oliver") || combined.includes("connecting you to oliver")) personaKey = "oliver";
  else if (combined.includes("this is rebecca") || combined.includes("connecting you to rebecca")) personaKey = "rebecca";
  else if (combined.includes("this is aiden") || combined.includes("connecting you to aiden")) personaKey = "aiden";
  else if (combined.includes("this is jordan") || combined.includes("connecting you to jordan")) personaKey = "jordan";
  else if (combined.includes("this is patrick") || combined.includes("connecting you to patrick")) personaKey = "patrick";
  else if (combined.includes("this is marcus") || combined.includes("connecting you to marcus")) personaKey = "marcus";
  else if (combined.includes("this is avery") || combined.includes("connecting you to avery")) personaKey = "avery";

  const prefaceSpeaker = plan?.preface_speaker
    ? safePersona(plan.preface_speaker)
    : null;

  return {
    persona_key: personaKey,
    preface_speaker: prefaceSpeaker,
    preface_text: sanitizeSpeechText(plan?.preface_text || "") || null,
    delay_seconds: clampDelay(plan?.delay_seconds),
    response_text: sanitizeSpeechText(
      plan?.response_text || "I can help with that. What do you need?"
    ),
    action: plan?.action || "speak",
    target: plan?.target || "voice_engine",
    metadata: typeof plan?.metadata === "object" && plan?.metadata !== null
      ? plan.metadata
      : {}
  };
}

function fallbackVoicePlan(activePersona = "nace") {
  return normalizeVoicePlan({
    persona_key: activePersona || "nace",
    preface_speaker: null,
    preface_text: null,
    delay_seconds: 0,
    response_text: "I can help with that. What do you need?",
    action: "speak",
    target: "voice_engine",
    metadata: {}
  }, activePersona);
}

function parseJsonObject(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const match = String(raw || "").match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

function buildAudioUrl(baseUrl, text, persona, state, env) {
  const params = new URLSearchParams({
    text: sanitizeSpeechText(text),
    persona_key: safePersona(persona),
    call_state: state || "response",
    token: env.TWILIO_AUDIO_TOKEN || ""
  });

  return `${baseUrl}/twilio/audio?${params.toString()}`;
}

function resolveVoiceId(persona, env) {
  const key = safePersona(persona);

  const voices = {
    nace: env.NACE_VOICE_ID,
    chad: env.CHAD_VOICE_ID,
    alexis: env.ALEXIS_VOICE_ID,
    michael: env.MICHAEL_VOICE_ID,
    oliver: env.OLIVER_VOICE_ID,
    jordan: env.JORDAN_VOICE_ID,
    patrick: env.PATRICK_VOICE_ID,
    marcus: env.MARCUS_VOICE_ID,
    rebecca: env.REBECCA_VOICE_ID,
    aiden: env.AIDEN_VOICE_ID,
    avery: env.AVERY_VOICE_ID,
    derrick: env.DERRICK_VOICE_ID,
    peggy: env.PEGGY_VOICE_ID,
    sylvia: env.SYLVIA_VOICE_ID,
    simone: env.SIMONE_VOICE_ID,
    julian: env.JULIAN_VOICE_ID,
    elena: env.ELENA_VOICE_ID,
    nathan: env.NATHAN_VOICE_ID,
    adrian: env.ADRIAN_VOICE_ID,
    victor: env.VICTOR_VOICE_ID,
    ariel: env.ARIEL_VOICE_ID
  };

  return voices[key] || env.NACE_VOICE_ID;
}

function safePersona(value) {
  const key = String(value || "nace").toLowerCase().trim();
  return ALLOWED_PERSONAS.includes(key) ? key : "nace";
}

function sanitizeSpeechText(value) {
  return String(value || "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^\)]*(pause|laugh|chuckle|sigh|breath|noise|sound|music|ring)[^\)]*\)/gi, "")
    .replace(/\*[^\*]*\*/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/[^\w\s.,?!'"-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700) || "";
}

function clampDelay(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(2, Math.floor(n)));
}

function detectRequestedPersona(text) {
  const clean = String(text || "").toLowerCase();

  const names = [
    "chad", "alexis", "michael", "oliver", "jordan",
    "patrick", "marcus", "rebecca", "aiden", "avery",
    "derrick", "peggy", "sylvia", "simone", "julian",
    "elena", "nathan", "adrian", "victor", "ariel"
  ];

  return names.find((name) => clean.includes(name)) || null;
}

function personaPickupLine(persona) {
  const names = {
    chad: "Chad Pennington",
    alexis: "Alexis Vale",
    michael: "Michael Carrington",
    oliver: "Oliver Grant",
    jordan: "Jordan Hale",
    patrick: "Patrick Ross",
    marcus: "Marcus Bell",
    rebecca: "Rebecca Lawson",
    aiden: "Aiden Mercer",
    avery: "Avery Cole",
    derrick: "Derrick",
    peggy: "Peggy",
    sylvia: "Sylvia",
    simone: "Simone",
    julian: "Julian",
    elena: "Elena",
    nathan: "Nathan",
    adrian: "Adrian",
    victor: "Victor",
    ariel: "Ariel"
  };

  return `This is ${names[persona] || persona}. How may I help you?`;
}

function twimlResponse(xml) {
  return new Response(xml.trim(), {
    status: 200,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders()
    }
  });
}

async function safeJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function handleError(err) {
  return jsonResponse(
    {
      ok: false,
      system: SYSTEM_ID,
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      error: err.message || "Unknown error",
      timestamp: new Date().toISOString()
    },
    err.status || 500
  );
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,authorization,x-mint-key"
  };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
} 
