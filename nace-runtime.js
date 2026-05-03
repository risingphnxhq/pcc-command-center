const NACE_RUNTIME_VERSION = "v1.0.0";  

const SVW_ENDPOINT =
  "https://system-voice-worker.tsteelefpa.workers.dev/voice/execute";

const PAGE_CONTEXT = {
  "command-floor.html": "Command Floor",
  "console.html": "Console",
  "council-staff.html": "Council and Staff",
  "execution.html": "Execution",
  "financial-tracking.html": "Financial Tracking",
  "nhce-monitor.html": "NHCE Monitor",
  "registry.html": "Registry",
  "voice-engine.html": "Voice Engine",
  "war-room.html": "War Room"
};

function naceCurrentPage() {
  const file = window.location.pathname.split("/").pop() || "index.html";
  return PAGE_CONTEXT[file] || file.replace(".html", "").replaceAll("-", " ");
}

async function naceSpeak(text) {
  if (!text) return;

  try {
    const res = await fetch(SVW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        voice_plan: {
          persona_key: "nace",
          text
        }
      })
    });

    if (!res.ok) throw new Error("SVW voice request failed");

    const audioBlob = await res.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    await audio.play();
  } catch (err) {
    console.error("NACE voice error:", err);
  }
}

function naceSetText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function naceArrivalMessage() {
  const stored = sessionStorage.getItem("pccArrivalMessage");

  if (stored) {
    sessionStorage.removeItem("pccArrivalMessage");
    return stored;
  }

  const page = naceCurrentPage();
  return "Welcome Phoenix King. Phoenix Command Center is active. Nace is standing by."; 
}

async function naceAnnounceArrival() {
  const page = naceCurrentPage();
  const message = naceArrivalMessage();

  naceSetText("authStatus", message);
  naceSetText("naceResponse", message);
  naceSetText("witnessResponse", `${page} loaded. Awaiting directive.`);

  await naceSpeak(message);
}

function nacePrepareRoute(route, label) {
  sessionStorage.setItem(
    "pccArrivalMessage",
    `${label || route.replace(".html", "").replaceAll("-", " ")} is open. What do you need here?`
  );
}

async function naceRoute(route, label) {
  const name = label || route.replace(".html", "").replaceAll("-", " ");
  await naceSpeak(`Opening ${name}. Routing now.`);
  nacePrepareRoute(route, name);
  window.location.href = route;
}

function naceInterpretRoute(input) {
  const text = String(input || "").toLowerCase();

  if (text.includes("command floor") || text.includes("home")) {
    return { route: "command-floor.html", label: "Command Floor" };
  }

  if (text.includes("console")) {
    return { route: "console.html", label: "Console" };
  }

  if (text.includes("council") || text.includes("staff")) {
    return { route: "council-staff.html", label: "Council and Staff" };
  }

  if (text.includes("execution") || text.includes("execute") || text.includes("runner")) {
    return { route: "execution.html", label: "Execution" };
  }

  if (text.includes("finance") || text.includes("financial")) {
    return { route: "financial-tracking.html", label: "Financial Tracking" };
  }

  if (text.includes("registry")) {
    return { route: "registry.html", label: "Registry" };
  }

  if (text.includes("nhce") || text.includes("monitor")) {
    return { route: "nhce-monitor.html", label: "NHCE Monitor" };
  }

  if (text.includes("voice")) {
    return { route: "voice-engine.html", label: "Voice Engine" };
  }

  if (text.includes("war")) {
    return { route: "war-room.html", label: "War Room" };
  }

  return null;
}

async function naceHandleCommand(input) {
  const command = String(input || "").trim();
  if (!command) {
    await naceSpeak("I did not receive a command. What do you need?");
    return;
  }

  naceSetText("authStatus", `Command received: ${command}`);
  await naceSpeak(`I heard you. ${command}`);

  const routeTarget = naceInterpretRoute(command);

  if (routeTarget) {
    await naceRoute(routeTarget.route, routeTarget.label);
    return;
  }

  const message =
    "I understood you, but I do not have an execution route for that command yet.";

  naceSetText("naceResponse", message);
  naceSetText("witnessResponse", "Command rejected. No mapped route.");
  await naceSpeak(message);
}

window.NACE = {
  version: NACE_RUNTIME_VERSION,
  speak: naceSpeak,
  route: naceRoute,
  handleCommand: naceHandleCommand,
  prepareRoute: nacePrepareRoute,
  currentPage: naceCurrentPage
};

window.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    naceAnnounceArrival();
  }, 500);
}); 
