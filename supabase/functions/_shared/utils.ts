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
export function background(promise: PromiseLike<any>): void {
  // Promise.resolve() adopts thenables (e.g. Supabase's PostgrestFilterBuilder,
  // which implements PromiseLike but not the full Promise interface) into a
  // real native Promise, so .catch() below is always safe to call. For values
  // that are already native Promises this is a no-op passthrough.
  const p = Promise.resolve(promise).catch(() => {});
  // deno-lint-ignore no-explicit-any
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(p);
}

// fetch + JSON with a timeout and simple retry.
// Timeout is intentionally generous (12 s) because Open-Meteo's geocoding
// and forecast endpoints are called from Supabase Edge Function servers whose
// egress latency to Open-Meteo can be higher than a browser's direct call.
// deno-lint-ignore no-explicit-any
export async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 12000, retries = 2): Promise<any> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}
