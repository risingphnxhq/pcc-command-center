import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// First physical gate only: confirm a read-only Mercury token can enumerate
// account identities. This endpoint never returns balances or bank coordinates.
// No function deployment is authorized by the existence of this source file.
const allowedOrigin = "https://command.risingphoenixhq.com";
const cors = {
  "access-control-allow-origin": allowedOrigin,
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "authorization, apikey, content-type",
  vary: "Origin",
};
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" },
});

Deno.serve(async (request: Request) => {
  if (request.headers.get("origin") && request.headers.get("origin") !== allowedOrigin) {
    return json({ error: "ORIGIN_DENIED" }, 403);
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) return json({ error: "AUTH_REQUIRED" }, 401);
  const projectUrl = Deno.env.get("SUPABASE_URL");
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const approvedSubject = Deno.env.get("FINANCE_PROBE_SUBJECT_ID");
  const mercuryToken = Deno.env.get("MERCURY_READ_ONLY_TOKEN");
  if (!projectUrl || !publicKey || !approvedSubject || !mercuryToken) {
    return json({ error: "FINANCE_PROBE_NOT_CONFIGURED" }, 503);
  }

  const client = createClient(projectUrl, publicKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser(authorization.replace(/^Bearer\s+/i, ""));
  if (error || !data.user) return json({ error: "AUTH_INVALID" }, 401);
  if (data.user.id !== approvedSubject) return json({ error: "FINANCE_ACCESS_DENIED" }, 403);

  try {
    const response = await fetch("https://api.mercury.com/api/v1/accounts?limit=100", {
      method: "GET",
      headers: { authorization: `Bearer ${mercuryToken}`, accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      console.warn("FINANCE_PROBE_PROVIDER_HTTP", response.status);
      return json({ error: "MERCURY_READ_FAILED", provider_status: response.status }, 502);
    }
    const payload = await response.json();
    const accounts = Array.isArray(payload?.accounts) ? payload.accounts : [];
    // A malformed or changed provider response is UNKNOWN, not a zero-account result.
    if (!Array.isArray(payload?.accounts)) {
      console.warn("FINANCE_PROBE_RESPONSE_SHAPE");
      return json({ error: "MERCURY_RESPONSE_UNRECOGNIZED" }, 502);
    }
    return json({
      status: "READ_ONLY_ACCOUNT_PROBE",
      observed_at: new Date().toISOString(),
      account_count_on_page: accounts.length,
      pagination_unverified: true,
      accounts: accounts.map((account: Record<string, unknown>) => ({
        type: typeof account.type === "string" ? account.type : "UNKNOWN",
        last_four: typeof account.accountNumber === "string" ? account.accountNumber.slice(-4) : "UNKNOWN",
      })),
    }, 200);
  } catch {
    console.warn("FINANCE_PROBE_NETWORK_OR_PARSE");
    return json({ error: "MERCURY_READ_UNAVAILABLE" }, 502);
  }
});
