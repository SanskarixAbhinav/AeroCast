export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Run a non-critical async op (cache write, log insert) WITHOUT blocking the
// response. On Supabase Edge Functions (Deno Deploy) `EdgeRuntime.waitUntil`
// keeps the isolate alive just long enough for it to finish after the
// response is sent; if that's not available (e.g. local `supabase functions
// serve`) it still fires immediately and simply isn't guaranteed to finish -
// acceptable since every caller already treats these writes as best-effort.
// deno-lint-ignore no-explicit-any
export function background(promise: Promise<any>): void {
  const p = promise.catch(() => {});
  // deno-lint-ignore no-explicit-any
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(p);
}

// fetch + JSON with a timeout and simple retry.
// deno-lint-ignore no-explicit-any
export async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 7000, retries = 1): Promise<any> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
