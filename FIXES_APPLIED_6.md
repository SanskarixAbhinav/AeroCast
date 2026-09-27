# Fix 6: Multi-variable weather-question support (`needs[]`)

## Task

Expand weather-question support so the app is not bottlenecked on a single
`topic = "rain"` classification. A question like:

> "What will the temperature, humidity and wind be tomorrow in Delhi?"

must retrieve and surface **all three** variables (temperature, humidity,
wind), not just whichever single `topic` the question happened to
classify as. At minimum: temperature, apparent temperature, precipitation,
precipitation probability, rain, humidity, wind speed, wind gusts, cloud
cover, visibility, UV index, sunrise, sunset, and weather condition — all
from the existing Open-Meteo API, with Gemini only explaining retrieved
facts, never inventing them. No hardcoded question patterns; no frontend
redesign; no unrelated features touched.

## What was already in place (inspected, not assumed)

Before changing anything, the existing pipeline was read in full:
`supabase/functions/_shared/llm.ts` (intent extraction + narration),
`_shared/weather.ts` (Open-Meteo calls + row shaping), `_shared/guard.ts`
(numbers guard + deterministic template fallback), and
`chat/index.ts` (the orchestration that ties them together).

`topic` (`TOPICS` in `llm.ts`) is a single string used to pick the
*request type* — forecast vs. marine advisory vs. spray timing, etc. — and
to select which advisory rules (`advisory.ts`) apply. It was never meant to
capture *which specific weather variables* a question named, and using it
that way is exactly the "single `topic = 'rain'`" bottleneck described in
the task: a question naming several variables at once had no way to carry
more than one.

## What changed

A new, orthogonal field was added to `Intent` instead of overloading
`topic`:

```ts
needs: WeatherVar[]  // e.g. ["temperature", "humidity", "wind_speed"]
```

- **`llm.ts`**: `WEATHER_VARS` is the fixed list of the 14 supported
  variables. `needs` is populated two ways, same fallback pattern already
  used for the rest of `Intent`:
  - **Primary**: Gemini's structured JSON extraction now also returns
    `needs`, with an explicit instruction to list *every* variable a
    question names (few-shot examples included, including the exact
    "temperature, humidity and wind ... Delhi" case from the task).
  - **Fallback**: `detectNeeds()`, a keyword→variable map in the same style
    as the existing offline `topic`/location heuristics — used only if
    Gemini is unreachable, never as the primary mechanism.
  `narrate()`'s system prompt and slimmed fact payload were extended to
  pass through `facts.requested` (below) and told to explain only what's
  in it.

- **`weather.ts`**: `getForecast()`'s Open-Meteo query was extended (same
  single request, no new API calls) to also ask for:
  - `current`: `apparent_temperature`, `cloud_cover`, `weather_code`
  - `daily`: `apparent_temperature_max/min`, `uv_index_max`, `sunrise`,
    `sunset`, `weather_code`
  - `hourly`: `relative_humidity_2m`, `cloud_cover`, `visibility`,
    `uv_index`
  `DailyRow`/`dailyRows()` were extended with the new daily fields, plus a
  `weatherCodeText()` lookup (the standard WMO weather-code table Open-Meteo
  itself documents — a fixed data table, not a question pattern) turning a
  numeric `weather_code` into e.g. "Slight rain". A new `dayAggregates()`
  rolls the hourly humidity/cloud-cover/visibility arrays up to a single
  local calendar date (Open-Meteo has no daily aggregate for these three),
  mirroring the existing `timeWindowStats()`/`hourlyWindow()` pattern.

- **`chat/index.ts`**: when `intent.needs` is non-empty, a `facts.requested`
  object is built with one entry per named variable, each holding real
  values already computed above (day row / time-window / day aggregates) —
  never anything invented. This is additive: existing `facts.day`,
  `facts.current`, etc. are unchanged, so every existing topic/branch
  (marine, spray, irrigation, harvest, cyclone, history, forecast) keeps
  working exactly as before.

- **`guard.ts`**: `templateAnswer()` (the deterministic fallback used if
  Gemini narration fails or the numbers guard trips) gained a sentence for
  `facts.requested`'s variables that aren't already covered by the existing
  day-summary sentence (temperature/rain/rain-probability/wind-speed), so
  the answer stays fully deterministic-safe even when Gemini is down.

## What did NOT change

- `topic` and `TOPICS` are untouched — every existing branch (spray,
  irrigation, harvest, marine, cyclone, history) behaves exactly as before.
- No hardcoded per-question patterns were added anywhere; `detectNeeds()`
  and `weatherCodeText()` are fixed, generic lookup tables, not
  question-specific logic.
- The frontend (`frontend/`) was not touched — `facts` gained new optional
  keys, which existing UI code simply doesn't read (additive, non-breaking).
- `followup.ts` was left as-is: `needs` is derived fresh from each question
  and doesn't need cross-turn inheritance the way `location`/`topic` do.

## Tests

`tests/test_multi_variable_needs.mjs` (new) exercises, fully offline
against mock Open-Meteo-shaped data:
- `detectNeeds()` pulling multiple variables out of one sentence (the
  Delhi example, an all-14-at-once sentence, and a no-variables-named
  general question).
- The extended `dailyRows()`/`weatherCodeText()`/`dayAggregates()` logic
  against a 2-day mock forecast+hourly payload.
- End-to-end `facts.requested` construction for several multi-variable
  questions (temperature+humidity+wind; UV+sunset; cloud cover+visibility+
  wind gusts), including the time-window-takes-precedence case.
- `templateAnswer()`'s new requested-facts sentence.

All pre-existing test suites (`test_units`, `test_intent`, `test_geocoding`,
`test_frontend`, `test_facts_narration_separation`) still pass unchanged,
and `check_ts_syntax.mjs` passes on every modified file.
