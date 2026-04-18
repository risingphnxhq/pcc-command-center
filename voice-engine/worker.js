export default {
  async fetch(req, env) {
    return new Response(JSON.stringify({
      status: "ACTIVE",
      system: "Voice Engine",
      engine: "PCC-ENGINE-V7A-R1",
      version: "PCC-BUILD-V7A-R1"
    }, null, 2), {
      headers: { "Content-Type": "application/json" }
    });
  }
};