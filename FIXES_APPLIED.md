# AeroCast — fixes applied

This pass went through the codebase against the 10 items you listed. Below is
what's fixed in code (verified against the repo's own test suite — all pass),
and what's actually a deployment/dashboard config issue rather than a code bug.

## Fixed in code

1. **Response error bugs** (`"couldn't find tomorrow in Kolkata"`)
   `supabase/functions/_shared/llm.ts` — the location-extraction regex matched
   the word "in" without a word boundary, so it matched *inside* "ra-in" and
   captured "tomorrow in Kolkata" as the place name. Also tightened so a
   sentence with two prepositions ("for coastal fishing **in** Mumbai") no
   longer swallows the wrong words — it now requires the captured place to
   look like a proper noun (Title Case), which reliably lands on the actual
   city. Verified against 8 real sample questions.

2. **Read-aloud button showing when the toggle is off**
   `frontend/app.js` / `style.css` — the per-message 🔊 button now only shows
   while the header "Read aloud" toggle is on, and flipping the toggle
   immediately hides/shows it on already-sent messages too.

3. **Microphone**
   `frontend/app.js` — the mic itself wasn't obviously broken in code, but it
   failed *silently* (permission denied, no HTTPS, etc. just reset the button
   with no explanation — which looks exactly like "not working"). Now:
   - Checks for a secure context (HTTPS) up front and explains if that's the
     blocker.
   - Surfaces the actual reason on failure (permission denied, no mic found,
     no speech detected, network issue) as text under the input box instead
     of failing silently.

4. **Landing page "6 languages, shows 4"**
   `frontend/landing.html` + `frontend/index.html` + `style.css` — root cause
   was a missing font fallback: Telugu (and on some systems Tamil/Bengali)
   has no default font on many OSes, so it rendered as blank boxes, making it
   look like only 4 of 6 languages were listed. Added Noto Sans Devanagari /
   Bengali / Tamil / Telugu web fonts with proper CSS fallback stacks on both
   the landing page and the main app, so all six always render.

5. **Overlapping buttons / mobile responsiveness**
   `style.css` (main app) + `landing.html` (marketing page):
   - Main app header now has a dedicated stacked layout under 560px, with a
     further simplification (drops toggle text labels) under 380px, so the
     language select / cyclone & read-aloud toggles / Scope button / sign-in
     controls never crowd into one unreadable row.
   - The `.auth-controls` group (History / Sign in / user chip) now wraps
     instead of forcing a single unbreakable row.
   - Chat bubble action row (speaker icon + latency pill) wraps on narrow
     screens instead of squeezing together.
   - Landing page top bar (logo + Try as guest + Sign in) now wraps into two
     rows under 480px instead of clipping/overlapping.

6. **Chatbot UI friendliness**
   Small, low-risk polish: smooth scroll on the chat thread, visible
   press/tap feedback on all buttons, no lingering mobile tap-highlight flash.

7. **Gemini response speed**
   `supabase/functions/_shared/llm.ts` — trimmed the narration timeout
   (9s → 6s) and lowered max output tokens (300 → 200 for narration, 150 → 120
   for intent JSON). The app already does the smart thing (a deterministic
   heuristic parses intent first and only calls Gemini as a fallback) — this
   just makes the fallback/narration path fail over to the fast, deterministic
   template sooner instead of making the user wait out a long timeout.

## Already implemented in code, but needs action outside this repo

These three showed up as broken in your screenshots, but the *code* already
has them — the screenshots are from an older deployed build, or the feature
depends on settings that live in the Supabase Dashboard rather than in this
repo:

8. **Google auth sign-in option** — already built (`frontend/auth.js` has a
   full Google OAuth button wired to `supabase.auth.signInWithOAuth`). For it
   to work in production, your Supabase project needs the Google provider
   enabled under **Authentication → Providers → Google**, with a real Google
   Cloud OAuth Client ID/Secret and your site's redirect URL registered.

9. **Email sign-in not working** — the code calls
   `supabase.auth.signInWithOtp({ email })` correctly. If it's failing in
   production, check in the Supabase Dashboard:
   - **Authentication → URL Configuration**: Site URL and Redirect URLs must
     include your deployed origin (e.g. `https://aerocast-nuc3.onrender.com`).
   - **Authentication → Email**: default Supabase email has low rate limits;
     for real usage you'll want your own SMTP configured there.

10. **Search history for signed-in users** — the drawer, CRUD calls, and RLS
    policies are all already implemented and look correct
    (`supabase/migrations/20260925000200_search_history.sql`). If it's not
    showing entries in production, the most likely cause is that this
    migration hasn't been applied to your live Supabase project yet — run
    `supabase db push` (or apply the SQL file directly) against production.

## Map feature

The map code (Leaflet, single-city view, regional view) looked structurally
sound already. It's very likely it "looked missing" mainly because most
queries were hitting the location bug (#1) and erroring out before any data
ever reached the map. Worth re-testing after redeploying the backend fix.

## What to do next

1. Redeploy the `supabase/functions/chat` function (picks up the location-fix
   and speed tuning).
2. Redeploy the frontend (`frontend/`) — picks up the font, mic, read-aloud,
   and responsive fixes.
3. In the Supabase Dashboard: apply the `search_history` migration if not
   already applied, and configure Google OAuth + Site URL/redirect allowlist
   as described above.
4. All existing repo tests still pass: `node tests/check_ts_syntax.mjs`,
   `node tests/test_frontend.mjs`, `node tests/test_units.mjs`.
