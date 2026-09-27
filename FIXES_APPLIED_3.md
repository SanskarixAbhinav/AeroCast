# AeroCast — location extraction & geocoding fix

## What was wrong

`supabase/functions/_shared/llm.ts` used a deterministic regex heuristic as
the *primary* way to pull a location out of a sentence, and only called
Gemini as a fallback when that heuristic failed outright. The heuristic was
tuned by hand for specific reported phrasings ("...in Kolkata", "...in
Mumbai...") using preposition-matching plus a Title-Case requirement, with a
short hardcoded city list behind it. That's inherently fragile: it can
handle the exact sentences it was tuned against, but any new phrasing,
capitalization pattern, or unlisted town is one regex-miss away from
swallowing the wrong words into the location (which is exactly the bug
you were seeing "sometimes"), and the fix-the-regex-again loop doesn't
generalize.

## What changed

`supabase/functions/_shared/llm.ts` — `parseIntent()`:

- **Gemini's structured JSON extraction is now the primary path**, called on
  every request (previously it was skipped whenever the regex heuristic
  looked "confident enough"). The system prompt explicitly instructs the
  model to separate the sentence into **location / date / request type
  (topic) / weather requirements**, with two worked examples showing that
  date and activity words must never leak into the location field — this is
  a general instruction about the *skill*, not a per-question patch.
- The regex-and-hardcoded-city heuristic (`fallbackParseIntent`) still
  exists, unchanged, but is now strictly an **offline resilience fallback**:
  it only runs if Gemini is unreachable, times out, or returns unparseable
  JSON (no API key, network failure, etc.). It is no longer the thing
  responsible for getting real questions right.
- Added `sanitizeLocation()`: a generic plausibility check (strips stray
  punctuation/quotes, rejects a "location" longer than 4 words or containing
  digits) applied to whatever comes back from Gemini before it's trusted.
  If Gemini's value doesn't look like a place, the independently-computed
  heuristic location is used instead of a raw sentence fragment — the
  geocoder never receives anything but a short, clean candidate location.
- The geocoder (`supabase/functions/_shared/location.ts`) was already only
  ever called with `intent.location` (never the raw sentence) — that part
  was already correct and is unchanged.
- No new per-question regexes, no new hardcoded cities.

## Verified

- Both reported bugs now resolve correctly (see `tests/test_intent.mjs`):
  - `"Will it rain tomorrow in Kolkata?"` → location `Kolkata`, date
    `tomorrow`, topic `rain`.
  - `"Is it safe for coastal fishing in Mumbai tomorrow?"` → location
    `Mumbai`, date `tomorrow`, topic `marine` (the marine-advisory request
    type).
- Added `tests/test_intent.mjs`, covering the two bug reports plus a few
  additional phrasings (unlisted-city-style prepositional phrasing, no
  preposition at all, double-prepositional clauses) and the
  `sanitizeLocation` safety net. Wired into `npm test`.
- `node tests/check_ts_syntax.mjs`, `test_units.mjs`, `test_intent.mjs`, and
  `test_frontend.mjs` all pass. (`test_live_apis.mjs` needs live network/API
  keys and wasn't run in this environment, but nothing it exercises was
  touched — `weather.ts`, `advisory.ts`, `alerts.ts`, and the frontend are
  all untouched.)
- Live Gemini calls themselves couldn't be exercised in this sandbox (no
  network egress, no `GEMINI_API_KEY`), so `parseIntent()` was verified via
  its offline fallback path plus the new prompt/sanitization logic reviewed
  by hand. **Please redeploy `supabase/functions/chat` and smoke-test both
  example questions against a live Gemini key before considering this
  closed.**

## Action needed

Redeploy `supabase/functions/chat` (picks up the `llm.ts` change). No
frontend changes, no migration changes, no other functionality touched.
