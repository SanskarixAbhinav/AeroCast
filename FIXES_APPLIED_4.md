# AeroCast — location scalability fix

## What was wrong

Two places in the backend location pipeline depended on a small, fixed list
of Indian cities instead of resolving locations dynamically:

1. `supabase/functions/_shared/llm.ts` — the offline fallback intent parser
   (used when Gemini is unreachable) had a hardcoded `CITIES` array of ~34
   towns. If the extracted sentence had no `in/at/for/near/around <Place>`
   pattern to anchor on (e.g. "Darjeeling weather tomorrow", or just
   "Rajkot"), it fell back to matching that list — so any town not on it
   (Darjeeling, Siliguri, Durgapur, Rajkot, Mysuru, Jamshedpur, Agartala...)
   silently failed to resolve a location in that code path, while listed
   towns (Kolkata, Dehradun, Kochi, Jaipur, Guwahati) worked. Hence
   "works for some predefined cities, fails for others."
2. `supabase/functions/_shared/location.ts` — the actual Open-Meteo geocoding
   call had no country scoping, so a same-named place elsewhere in the world
   could in principle outrank the intended Indian town, and there was no
   fallback strategy at all.

## What changed

**`supabase/functions/_shared/llm.ts`** — removed the `CITIES` array
entirely (not replaced with a bigger one). When no preposition anchors the
location, the fallback now takes any standalone run of Title-Case word(s) in
the sentence, skipping runs that are only common English question-starters
("Will", "Is", "Any", ...) — a small fixed set of function words, not
places, so it doesn't need to grow as new towns come up. What it extracts is
only a *candidate* string; the real geocoder decides whether it's an actual
place.

**`supabase/functions/_shared/location.ts`** — `geocode()` now:
- Queries Open-Meteo with `countryCode=IN` first (the filter Open-Meteo's
  geocoding API documents for exactly this), so Indian towns are resolved
  against India specifically rather than whatever result happens to rank
  first globally.
- If that comes back empty (misspelling, or a genuinely non-Indian place),
  retries once with an unrestricted global search rather than reporting
  "not found" outright.
- Still takes the extracted location string only — never the full sentence
  — exactly as before.
- If neither call finds anything, returns `null`; `chat/index.ts` already
  turns that into the existing clean, user-facing message
  (`I couldn't find a place called "..."`) — unchanged.

Architecture is now: **extracted location string → Open-Meteo geocoding
(India-first, global fallback) → lat/lon/timezone → weather API**, with no
hardcoded city list anywhere in that path.

## Verified

- `tests/test_intent.mjs` — added the 12 reported towns (Kolkata,
  Darjeeling, Siliguri, Durgapur, Rajkot, Mysuru, Jamshedpur, Agartala,
  Dehradun, Kochi, Jaipur, Guwahati) as test cases; all resolve to the
  correct location string with no hardcoded list involved.
- `tests/test_geocoding.mjs` (new) — mocks `fetch` (live network isn't
  reachable from this sandbox) to verify: each of the 12 towns resolves on
  the India-scoped call alone; an empty India-scoped result correctly
  triggers the global fallback; an unresolvable name returns `null`.
- `node tests/check_ts_syntax.mjs`, `test_units.mjs`, `test_intent.mjs`,
  `test_geocoding.mjs`, and `test_frontend.mjs` all pass. Frontend
  (`frontend/`) untouched — including its dev-only `USE_MOCK` demo data,
  which is off by default and unrelated to the real backend geocoding path.
- Live Open-Meteo calls couldn't be exercised directly in this sandbox (no
  network egress). **Please redeploy `supabase/functions/chat` and smoke-test
  a few of the 12 towns against the live API before considering this
  closed.**

## Action needed

Redeploy `supabase/functions/chat` (picks up both `llm.ts` and
`location.ts`). No frontend, migration, or other functionality changed.
