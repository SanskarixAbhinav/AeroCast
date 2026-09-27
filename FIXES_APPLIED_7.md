# FIXES_APPLIED_7 — Verification pass on server.mjs (Node)

## Environment note
This pass was run in a sandbox with **no outbound network access**. Everything
below was verified by running the server, the offline test suite, and tracing
code paths. Real Open-Meteo/Gemini/marine responses, `npm run test:live`, and
`deno check` against the Supabase pipeline still need to run in a networked
environment — none of that could be confirmed here.

## Bugs found and fixed in `server.mjs`

1. **Geocode failure silently defaulted to Kolkata.** If geocoding failed for
   any reason (not just fully offline — a typo, rate limit, or transient
   error), the code used hardcoded Kolkata coordinates/label as if that were
   the resolved location, with no indication to the user. For a farming/
   marine-safety tool this could silently answer about the wrong city.
   Fixed: returns an explicit "couldn't find that location" error. The
   Kolkata default is now scoped only to the intentional no-location
   cyclone-demo path.

2. **Location-extraction regex had no `\b` word boundaries.** `in`/`at`
   matched as bare substrings inside ordinary words — broke "...**rain**...
   in Darjeeling" (matched inside "rain") and broke follow-ups like "**Wh at**
   about the day after tomorrow?" (captured "about the day after" as a fake
   place instead of falling through to context). Fixed by adding `\b`.

3. **"Will it rain?" extracted "it" as a place name** via the
   keyword-adjacency fallback regex, which had no stopword filtering. Fixed
   by extending the existing stopword set and applying it there too.

4. **Date hint was never inherited from context on follow-ups**, unlike
   topic (which already fell back to `context.topic`). A bare follow-up like
   "Will it rain?" after "...day after tomorrow?" silently reset to "today".
   Fixed with the same two-step pattern already used for topic, and `date`
   is now included in the round-tripped `meta.context`.

5. **Numbers-guard (`numbersOk`) only matched ASCII digits.** The app
   narrates in Hindi/Bengali/Tamil/Telugu/Marathi, but a hallucinated number
   written in native digits (Devanagari, etc.) was invisible to the
   ASCII-only `\d` regex and would pass the guard unchecked. Fixed by
   porting the same digit-normalization already present in the Deno
   `guard.ts`. Verified: a hallucinated Devanagari number is now correctly
   rejected.

6. **Archive/history API fetch had no timeout**, unlike every other fetch in
   the file. Added the same 4s `AbortSignal.timeout` used elsewhere.

## Structural finding (not fixed — flagging as tech debt)
`tests/test_intent.mjs` passes 100% but exercises a **separate**
reimplementation of location/date/topic extraction (mirroring the Deno
`llm.ts` design, which already had `\b` boundaries and capital-letter
anchoring) — not the regex actually running in `server.mjs`, which is what
the live frontend calls through `/api/chat`. That's why the suite was green
while bugs #2 and #3 above were live in the code users actually hit.
Recommend making these tests import the real `server.mjs` functions instead
of hand-maintaining a shadow copy.

## Verified (offline)
- `node --check server.mjs` passes; server boots; `/` and `/api/health`
  return 200.
- `npm test`: 6/7 suites pass; the 7th (`test_live_apis.mjs`) fails only on
  the blocked network (`HTTP 403` from the sandbox's egress proxy).
- All 13 task questions now correctly extract location/topic; the
  Q7→Q8→Q9 follow-up chain correctly carries Mumbai forward, with topic
  correctly re-deriving to "rain" on Q9.
- No fabricated/hardcoded weather numbers on any failure path.
- `GEMINI_API_KEY` unset → `narrateWithGemini` returns `null` immediately.
- Marine/coastal logic reviewed by code trace: correctly returns
  `is_coastal: false` with no invented wave data when the marine API
  returns nothing, and correctly scopes the "current" fallback to today
  only.
- Supabase/Deno pipeline (`supabase/functions/`) type-checks cleanly via
  `tsc` with Deno-environment shims (Deno itself wasn't available in this
  sandbox) — no real errors, consistent with "no changes made to it".

## Not verified — needs a networked run
Real forecast/geocoding responses for all 13 cities, real marine wave data
for Mumbai vs. inland cities, real Gemini narration quality against a live
model, and `deno check` / `supabase functions serve`.
