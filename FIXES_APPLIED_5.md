# Fix 5: Explicit facts/narration separation contract

## Task

Ensure real weather data (Open-Meteo) and Gemini-generated narration are
architecturally separated, per this pipeline:

```
User question -> intent extraction -> geocoding -> Open-Meteo
              -> structured weather facts -> Gemini narration
```

The LLM must never generate weather numbers; Open-Meteo must be the sole
source of numerical weather data; the frontend must render from `facts`,
not by parsing Gemini's text; and a Gemini failure after weather data has
already been fetched must degrade to the structured facts plus a
deterministic fallback answer, not a failed request.

## What was already in place (inspected, not assumed)

Reading `supabase/functions/chat/index.ts`, `_shared/llm.ts`, and
`_shared/guard.ts` before changing anything showed the architecture above
was already implemented:

- `parseIntent()` (Gemini call 1, with a deterministic offline fallback) ->
  `geocode()` -> `getForecast()`/`getHistory()`/`getMarine()`/
  `getModelComparison()` (all real Open-Meteo endpoints) -> a `facts` object
  built entirely from that data plus deterministic advisory logic
  (`advise()`, `computeAlerts()`) -> only then `narrate(facts, q, lang)`
  (Gemini call 2) is invoked to turn `facts` into a short natural-language
  `answer`.
- `narrate()`'s return value is assigned only to `answer`; it is never
  merged back into `facts`.
- `numbersOk(answer, facts)` rejects any numeral in the narration that
  doesn't trace back to a real value in `facts` (with sane rounding/common-
  phrase allowances), and `chat/index.ts` already falls back to
  `templateAnswer(facts)` — a plain-string answer built directly from
  `facts`, no LLM involved — whenever `narrate()` throws *or* the guard
  trips.
- The handler always returns `{ answer, facts, alerts, meta }`; `facts` is
  never dropped, including on narration failure.
- `frontend/app.js` already renders every weather card, badge, and chart
  from `facts` (`facts.current`, `facts.day`, `facts.daily`, `facts.marine`,
  `facts.flags`, `facts.model_comparison`, `facts.history`, ...) — `answer`
  is only ever dropped into the chat bubble as display text, never parsed
  for numbers.

## What changed

**`supabase/functions/_shared/llm.ts`** — `narrate()`'s system prompt now
states, verbatim, the required instruction:

> Use ONLY the supplied weather facts. Do not invent, estimate, replace, or
> contradict numerical weather values. If information is missing, say that
> it is unavailable.

(previously: "Use ONLY the facts JSON. Never invent numbers, dates or
places. If a value is missing, say unavailable." — same intent, reworded to
match the required wording exactly; the "never invent dates or places"
half was kept as a separate follow-up line so no existing guarantee was
dropped.)

No other file needed a code change: the fact/narration separation, the
numbers guard, the deterministic fallback, and the facts-only frontend
rendering were all already correct.

## New test

**`tests/test_facts_narration_separation.mjs`** (added to `npm test`) —
offline, no network required:
- Asserts the real `_shared/llm.ts` source contains the exact required
  instruction string.
- Inspects the real `chat/index.ts` source to assert every `facts.*`
  weather assignment happens before the `narrate(facts, ...)` call, that
  `narrate()`'s output is only ever assigned to `answer` (never merged into
  `facts`), and that the response always returns the full `facts` object.
- Re-implements the guard/fallback flow (same pattern as the other offline
  tests in this folder, since the real modules are Deno TypeScript) to
  verify: (a) if narration throws after weather data was already fetched,
  the response still carries the real `facts` and a deterministic,
  facts-only answer; (b) if narration hallucinates a number absent from
  `facts`, the guard discards it and falls back to the template; (c) a
  well-behaved narration that only uses real numbers passes through
  unchanged.

## Verified

- `node tests/check_ts_syntax.mjs` — all edge function files still parse.
- `node tests/test_units.mjs`, `test_intent.mjs`, `test_geocoding.mjs`,
  `test_frontend.mjs`, `test_facts_narration_separation.mjs` — all pass.
- No frontend, migration, or unrelated backend logic changed.

## Action needed

Redeploy `supabase/functions/chat` (picks up the updated narration prompt
in `llm.ts`). No frontend or database changes to deploy.
