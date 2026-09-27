# FIXES_APPLIED_9 — "Weather data is unavailable" connectivity fix (server.mjs)

## The reported symptom
Screenshot showed the deployed app answering every question (e.g. "Will it
rain tomorrow in Kolkata?", "Is it safe to spray pesticides in Kolkata
tomorrow?") with:
> Weather data is unavailable right now. Please try again in a few minutes.

in ~700–800ms — a fast, clean JSON response, not a timeout or a frontend
network error. That latency rules out the 4s-per-call timeout actually
firing; it means Open-Meteo's **forecast** endpoint call itself failed fast
(a bad status, a blocked/redirected host, or similar) right after geocoding
had already succeeded (a different failure message covers geocoding
failing, and that's not what showed in the screenshot).

## Root problem: the failure was completely silent
`server.mjs`'s weather-fetch block had **zero logging and zero retry** on
any of its `fetch()` calls (geocoding, forecast, multi-model, marine, air
quality, flood, archive) — every failure path was `.catch(() => null)` or a
bare `catch (_e) {}`, so however this failed in your actual deployment,
there was no way to tell *why* from the server logs: a 429 (rate limit), a
400 (bad request), a timeout, a DNS blip, or a proxy/firewall intercepting
one specific hostname would all look identical — silence, followed by the
generic "unavailable" message. This is very likely why it was hard to
pin down: the code gave no evidence to work from.

I could not reach `api.open-meteo.com`/`geocoding-api.open-meteo.com` from
this sandbox either (confirmed: `HTTP 403 x-deny-reason: host_not_allowed`
on direct `curl`), so I can't see your deployment's actual failure reason
directly. What I *can* fix is the blind spot itself, plus the two most
common real-world causes of exactly this symptom (transient errors and
rate limits) — without guessing at your specific hosting setup.

## What changed
Added one small helper, `fetchWithRetry()`, and used it for **every**
Open-Meteo call in `server.mjs` (geocoding, forecast, multi-model, marine,
air quality, flood, archive) — previously each was a bare, un-retried
`fetch(...).catch(() => null)`:

- **Logs the real reason on failure**: `HTTP <status>`, `timeout after
  <ms>`, or the underlying network error message, plus which endpoint and
  URL (no query string/coordinates logged). Run it and check the server
  console next time it happens — that line will tell you definitively
  whether it's a rate limit, a bad request, a timeout, or something else
  (e.g. a captive portal or proxy silently swapping in an HTML page for
  a 200 status, which is now caught too: JSON-parse failures are logged
  by message instead of silently producing `null`).
- **One retry with backoff** on transient failures — timeout, network
  error, `429` (rate limited), or any `5xx` — since these are exactly the
  errors that go away on a second attempt. A `4xx` other than `429` (e.g.
  a genuinely malformed request) is *not* retried, since retrying won't
  change that outcome.
- **Timeout raised from 4s to 6s per attempt.** With one retry, worst case
  is ~12.3s total, still comfortably inside the frontend's existing 20s
  `AbortController` ceiling (`frontend/app.js`), so the user-facing
  behavior on a genuine full outage is unchanged (still a clean answer,
  not a hang).
- The outer `catch (_e) {}` around the whole fetch block, and the archive
  block's, now log the actual error via `console.error` instead of
  swallowing it — so a future *code* bug there (not just a network issue)
  will show up in the logs too, rather than only ever manifesting as the
  same generic user-facing message.

Nothing about the response shape, the cache behavior, or the user-facing
copy changed — only the reliability of the fetches themselves and the
visibility into why one failed.

## Verified
- `node --check server.mjs` passes.
- `npm test`: still 6/7 (same as every prior pass) — the only failure is
  `test_live_apis.mjs`, which fails on this sandbox's network block
  (`HTTP 403`), not on anything this change touched.
- Unit-tested `fetchWithRetry()` directly: a non-retryable `403` returns
  immediately (no wasted retry); an unreachable host retries exactly once
  with the expected ~300ms backoff, then logs a clear one-line reason and
  returns `null`.
- Ran the real local server end-to-end: a request that previously failed
  in total silence now logs e.g. `[AeroCast] geocoding fetch returned HTTP
  403` (or the equivalent for the forecast call) — confirming the fix
  turns an invisible failure into a diagnosable one.

## Next step for you
Redeploy this build, reproduce the failure once, and read the server
console/logs for the new `[AeroCast] ... fetch failed` or
`... fetch returned HTTP ...` line. That will say definitively what's
actually happening in your environment (rate limit vs. timeout vs.
something blocking a specific hostname), which is the piece I can't see
from here. If it turns out to be Open-Meteo rate-limiting a shared/public
demo URL, the fix is a longer cache TTL or an API key tier, not more code
changes here.
