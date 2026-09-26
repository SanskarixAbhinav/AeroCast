# AeroCast — second fixes pass

The previous pass (`FIXES_APPLIED.md`) already made the right code changes for
several of these, but two of them were still visible in practice for real
reasons found this pass. Root causes below.

## 1. Read-aloud button "still shows when toggle is off"
The toggle-hiding logic in `app.js`/`style.css` was already correct. The
actual bug: `frontend/sw.js` used a **cache-first** service worker with a
`CACHE_NAME` that never changed between deploys. Once a phone had the old
`app.js` cached, it kept serving that exact old file forever — redeploying a
fix to the server didn't help, because the browser never asked the server
again. Fixed:
- `CACHE_NAME` bumped to `aerocast-shell-v2` (bump this string on every future
  deploy that touches `index.html`/`app.js`/`style.css`, or the same problem
  recurs).
- The app shell (HTML/JS/CSS) now uses **network-first**, falling back to the
  cache only when offline — so live users always get the current deploy.
- `app.js` now also calls `registration.update()` right after registering, so
  phones that already installed the old service worker check for the new one
  sooner instead of waiting for the browser's own update cycle.

**Action needed:** redeploy the frontend. Existing installs will pick up the
new service worker (which then fetches fresh files going forward) within one
or two app opens.

## 2. Overlapping buttons / mobile responsiveness — 3 concrete causes found
- `.chat-input` / `.auth-input` had no `min-width: 0`. A flex item's default
  min-width is its own content width, so on narrow phones the text input
  could refuse to shrink and push the send button partly off-screen/behind
  it. Fixed.
- Those same inputs were `font-size: 0.95rem` (~15px) — under iOS Safari's
  16px auto-zoom threshold. Focusing the input zoomed the whole page in,
  which looks exactly like a broken/overlapping layout until the user manually
  zooms back out. Bumped both to `16px`.
- The architecture modal's title ("System Architecture & Scope Transparency")
  had no shrink/wrap constraint next to its close (×) button — could crowd or
  sit under the button on narrow screens. Added `min-width: 0` /
  `overflow-wrap: anywhere` / `flex-shrink: 0` where appropriate.
- The "🌐 Regional Disaster View" map tab label could overflow its container
  on small phones and run into the map title. Now wraps and truncates with
  ellipsis under 480px.

## 3. Chatbot UI friendliness
Mostly already solid from the previous pass (fade-in bubbles, tailed corners,
shadows, press feedback). The input/zoom fix above is the main additional
friendliness win — a chat input that zooms the page on focus is the most
common "feels broken" complaint on mobile chat UIs.

## 4. Gemini response speed
`supabase/functions/_shared/llm.ts`:
- Default model switched from `gemini-flash-latest` to
  `gemini-flash-lite-latest` (still overridable via the `GEMINI_MODEL` env
  var/secret) — Flash-Lite is built for exactly this kind of short,
  low-complexity call (JSON intent extraction, 3-sentence narration).
- Narration's system prompt trimmed to fewer tokens (same rules, tighter
  wording) — less for the model to read before it starts generating.
- Timeouts tightened further: narration 6s → 4.5s, intent-fallback 5s → 3.5s.
- Token ceilings tightened further: narration 200 → 140, intent JSON
  120 → 90.
- The deterministic heuristic (already in place from the previous pass) still
  answers the large majority of questions with zero Gemini call at all — these
  changes only speed up the fallback path.

**Action needed:** redeploy `supabase/functions/chat`, and set
`GEMINI_MODEL=gemini-flash-lite-latest` as a Supabase secret (or leave it
unset — that's now the default) if you want to fall back to
`gemini-flash-latest` for a demo, override it before judging.

## Verified
`node tests/check_ts_syntax.mjs`, `node tests/test_frontend.mjs`, and
`node tests/test_units.mjs` all still pass after these changes.
