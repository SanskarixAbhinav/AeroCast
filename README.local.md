# WeatherGPT | AI Weather & Agro Advisory Assistant

A production-ready hyperlocal weather advisory and farming assistant for India. Powered by **Supabase Edge Functions (Deno/TypeScript) + Postgres**, **Open-Meteo API** (forecasts & archives, no key required), and **Google Gemini 3.8 Flash** with deterministic rule engines and an anti-hallucination number guard.

---

## Architecture Overview

```
weathergpt/
├── supabase/
│   ├── config.toml                     # Supabase CLI project configuration
│   ├── migrations/
│   │   └── 20260925000000_init.sql     # api_cache, cyclone_bulletins, chat_logs (idempotent)
│   └── functions/
│       ├── _shared/
│       │   ├── utils.ts                # CORS, json responses, resilient fetchJson with retries
│       │   ├── db.ts                   # Supabase client with fail-safe cache helpers
│       │   ├── location.ts             # Open-Meteo geocoding (cached 30 days)
│       │   ├── weather.ts              # 7-day forecast & historical archive with stale fallback
│       │   ├── alerts.ts               # Rain, heat, wind thresholds & active cyclone bulletins
│       │   ├── advisory.ts             # Deterministic rules for spray, irrigation & harvest
│       │   ├── dates.ts                # Date hint normalization & history range clamping
│       │   ├── llm.ts                  # Gemini intent parsing & narration with resilient fallbacks
│       │   └── guard.ts                # Number guard (rejects hallucinated numbers)
│       ├── chat/index.ts               # POST /chat pipeline with per-IP rate limiting
│       └── health/index.ts             # GET /health endpoint
├── frontend/                           # Plain static HTML5 / Vanilla JS frontend (no build step)
│   ├── index.html                      # HTML5 entry with Leaflet CDN & Google Fonts
│   ├── app.js                          # Vanilla JavaScript UI logic, i18n & rendering (<520 lines)
│   ├── style.css                       # Responsive layout & high-contrast themes
│   ├── config.js                       # Runtime configuration (API_URL, USE_MOCK, ANON_KEY)
│   ├── vercel.json                     # Vercel static routing config
│   ├── netlify.toml                    # Netlify static routing config
│   └── README.md                       # Frontend quickstart documentation
├── tests/
│   ├── test_units.mjs                  # Offline tests: guard, dates, advisory, alerts
│   ├── test_frontend.mjs               # Frontend DOM & syntax acceptance tests
│   └── test_live_apis.mjs              # Online tests: Open-Meteo geocoding, forecast, archive
├── server.mjs                          # Standalone Node.js static & API test server
├── package.json                        # Project metadata & npm test/start scripts
└── README.local.md                     # Documentation & deployment guide
```

---

## How the Pipeline Works

1. **User Message** → Received by Edge Function via `POST /chat`.
2. **Intent Parsing** → Gemini extracts location, date hint, topic, and language. If Gemini is unreachable, a rule-based heuristic extractor parses the intent as a fallback.
3. **Geocoding** → Open-Meteo Geocoding API converts city/town to latitude & longitude (cached 30 days in Postgres).
4. **Weather Fetch** → Open-Meteo fetches 7-day forecast or historical weather.
5. **Deterministic Rules** → Computes agricultural advisories (`spray`, `irrigation`, `harvest`) and weather alert thresholds (`heavy_rain`, `heatwave`, `strong_wind`, `cyclone`).
6. **Gemini Narration** → Gemini receives the factual JSON context only and produces a natural-language answer in the user's language (`en`, `hi`, `bn`, `ta`, `te`, `mr`).
7. **Numbers Guard** → Scans every number in the LLM's response. If the LLM fabricated any number not present in the factual weather data, the text is discarded and replaced with a deterministic template answer.
8. **Final Response** → Returns `{ answer, facts, alerts, meta }` with full CORS headers.

---

## Environment & Configuration

### Backend Secrets (Supabase)
| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | **Required.** Google AI Studio / Gemini API Key | `AIzaSy...` |
| `GEMINI_MODEL` | Optional. Gemini model alias or ID | `gemini-flash-latest` |
| `SUPABASE_URL` | Auto-injected in hosted Edge Functions | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected in hosted Edge Functions | `eyJ...` |

> [!CAUTION]
> **Never** expose `GEMINI_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in frontend code or repository commits.

### Frontend Configuration (`frontend/config.js`)
The frontend is pure static HTML/CSS/JS with **no build step, no npm dependencies, and no bundler (no Vite)**. Runtime settings are configured directly in [`frontend/config.js`](frontend/config.js):

| Setting | Description | Default / Example |
| :--- | :--- | :--- |
| `API_URL` | Base URL of your Supabase Edge Function chat endpoint | `"https://cefbgewshgyekkkwcqxb.supabase.co/functions/v1/chat"` |
| `USE_MOCK` | Toggle built-in canned responses (`true`) vs live Supabase backend (`false`) | `false` |
| `SUPABASE_URL` | Supabase Project URL for client-side Auth & user preferences | `"https://cefbgewshgyekkkwcqxb.supabase.co"` |
| `ANON_KEY` | Public Supabase Anon Key for client-side Auth | `"eyJ..."` |

---

## Authentication & User Preferences

AeroCast features seamless Supabase client-side authentication supporting both Email Magic Links and Phone OTP, with a **zero-friction guest mode guarantee**.

### 1. Email Authentication (Magic Link)
- **Status:** **Works out of the box** by default on any Supabase project.
- **Workflow:** User enters email → clicks "Send Magic Link" → Supabase automatically sends an email with an authentication link → clicking the link logs the user into AeroCast without passwords.
- No third-party SMTP server is required for development/testing; Supabase's built-in mailer handles delivery.

### 2. Phone Authentication (SMS OTP)
- **Status:** **Requires SMS Provider Configuration.**
- **Prerequisite:** Phone OTP requires an active SMS provider (Twilio, MSG91, Vonage, MessageBird, or AWS SNS) configured in your Supabase project:
  1. Open [Supabase Dashboard](https://supabase.com/dashboard).
  2. Navigate to **Authentication** → **Providers** → **Phone**.
  3. Toggle **Enable Phone Provider**.
  4. Select your SMS provider (e.g., Twilio or MSG91) and enter your Account SID, Auth Token, and Sender ID / Twilio Phone Number.
  5. Click **Save**.
- **Workflow:** User inputs their phone number (defaulting to India `+91`) → receives a 6-digit OTP code → enters code to authenticate.
- *Note:* If an SMS provider is not configured, requesting phone OTP will display a clear error message guiding the administrator to enable an SMS gateway.

### 3. Guest Mode Guarantee
- **Authentication is completely optional.** AeroCast is 100% usable and demoable without logging in.
- Guest users enjoy full access to the weather chat pipeline, live Open-Meteo forecasts, marine wave safety, farm advisories, NWP model comparison, flood warnings, cyclone simulation, and offline PWA installation.
- Logging in unlocks three convenience features:
  1. **Search History Drawer:** View past questions grouped by Today / Yesterday / Earlier date, re-ask with one tap, or delete individual records.
  2. **Persisted Language Preference:** Automatically saved and pre-selected across sessions.
  3. **Recent Locations Quick-Tap Bar:** Automatically remembers the user's last 5 queried locations with one-tap chips.

---

## Applying Database Migrations

AeroCast database migrations are versioned under `supabase/migrations/`:
1. `20260925000000_init.sql`: Creates `api_cache`, `cyclone_bulletins`, `chat_logs`, and seeds simulated cyclone data.
2. `20260925000100_user_prefs.sql`: Creates `user_prefs` for authenticated user preferences and recent locations.
3. `20260925000200_search_history.sql`: Creates `search_history` with user-isolated Row Level Security (RLS).

### How to Apply Migrations:

#### Option A: Via Supabase CLI (Recommended)
```powershell
# Push all pending migrations to your linked Supabase database
npx supabase db push
```

#### Option B: Via Supabase Dashboard (SQL Editor)
1. Open the [Supabase Dashboard](https://supabase.com/dashboard).
2. Go to **SQL Editor** → **New Query**.
3. Copy and paste the contents of `supabase/migrations/20260925000100_user_prefs.sql` and `supabase/migrations/20260925000200_search_history.sql`.
4. Click **Run**.

### Row Level Security (RLS) Architecture:
The `user_prefs` and `search_history` tables have strict RLS enabled:
- `user_prefs`: Users can only read and write their own preference row (`auth.uid() = user_id`).
- `search_history`: Users can only `SELECT`, `INSERT`, and `DELETE` their own search log (`auth.uid() = user_id`).
- Written directly from the client using the user's authenticated Supabase session (`supabase.from('search_history').insert(...)`). No custom backend service-role endpoint required.

---

## Real Datasets (Open-Meteo Free APIs)

AeroCast integrates multiple real Open-Meteo APIs (all free, no API keys required):

1. **Weather Forecast API:** Real-time conditions and 7-day outlook including hourly precipitation, wind gusts, relative humidity, and FAO-56 Reference Evapotranspiration ($ET_0$).
2. **Air Quality API:** Real-time PM2.5, PM10, and US AQI indices for current and forecast locations with color-coded UI badges (Good, Moderate, Poor, Unhealthy, Severe).
3. **Flood / River Discharge API:** Daily river discharge telemetry ($m^3/s$) evaluating catchment flood risk and triggering flood warnings.
4. **Marine Wave API:** Coastal wave height, wave period, wave direction, and swell height with deterministic safety thresholds for artisanal fishing vessels.
5. **Historical Archive API:** ERA5 reanalysis data back to 1940 rendered via interactive inline SVG charts.
6. **Multi-NWP Model Comparison:** Contrasting NOAA GFS Seamless vs ECMWF IFS for transparent multi-model consensus.

---

## Deployment Guide (Windows / VS Code)

### Prerequisites
- Node.js (v18+)
- Supabase account ([supabase.com](https://supabase.com))
- Google Gemini API key ([aistudio.google.com](https://aistudio.google.com))

### Step 1: Deploy Backend to Supabase

Open PowerShell or VS Code Integrated Terminal in the workspace root (`d:\AeroCast`):

```powershell
# 1. Log into your Supabase account
npx supabase login

# 2. Link to your remote Supabase project (replace YOUR_PROJECT_REF)
npx supabase link --project-ref YOUR_PROJECT_REF

# 3. Push the database schema & seed simulated cyclone bulletin
npx supabase db push

# 4. Set the Gemini API secret
npx supabase secrets set GEMINI_API_KEY=YOUR_GEMINI_API_KEY

# Optional: override model if desired (defaults to gemini-flash-latest)
# npx supabase secrets set GEMINI_MODEL=gemini-flash-latest

# 5. Deploy the Edge Functions
npx supabase functions deploy chat --no-verify-jwt
npx supabase functions deploy health --no-verify-jwt
```

### Step 2: Run / Host Frontend

Because the frontend consists only of static files (`index.html`, `app.js`, `style.css`, `config.js`), there is **no build step, no Vite, and no compilation required**.

#### Option A: Run Locally on Localhost

From the workspace root:

```powershell
# Using the built-in Node server
npm start
# or
node server.mjs
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

Alternatively, using Python 3:
```powershell
python -m http.server 3000 --directory frontend
```
Or with Node's static `serve`:
```powershell
npx serve frontend
```

#### Option B: Deploy to Vercel
1. Import repository on [vercel.com](https://vercel.com).
2. Set **Root Directory** to `frontend`.
3. Set **Framework Preset** to `Other` (no build command needed).
4. Update `frontend/config.js` with your production Supabase Edge Function URL.
5. Click **Deploy**.

#### Option C: Deploy to Netlify
1. Import repository on [netlify.com](https://netlify.com).
2. Set **Base directory** to `frontend`.
3. Leave **Build command** empty.
4. Set **Publish directory** to `frontend` (or `.` if base directory is set to `frontend`).
5. Click **Deploy**.

#### Option D: Deploy to GitHub Pages
1. Push the repository to GitHub.
2. Go to **Settings** → **Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**.
4. Select your branch and set `/frontend` as the folder.
5. Click **Save**.

---

## API Testing (Exact Commands)

Replace `<YOUR_PROJECT_REF>` with your Supabase project reference (or use `https://cefbgewshgyekkkwcqxb.supabase.co`).

### 1. Health Check (`/health`)

**PowerShell:**
```powershell
Invoke-RestMethod -Uri "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/health" -Method GET | ConvertTo-Json
```

**curl:**
```bash
curl -X GET "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/health"
```

**Expected Response (HTTP 200):**
```json
{
  "status": "ok",
  "time": "2026-09-25T01:30:00.000Z"
}
```

---

### 2. Basic Weather Question (`/chat`)

**PowerShell:**
```powershell
$body = @{ q = "What is the weather in Delhi today?"; lang = "en" } | ConvertTo-Json
Invoke-RestMethod -Uri "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/chat" -Method POST -Headers @{ "Content-Type" = "application/json" } -Body $body | ConvertTo-Json -Depth 5
```

**curl:**
```bash
curl -X POST "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/chat" \
  -H "Content-Type: application/json" \
  -d '{"q":"What is the weather in Delhi today?","lang":"en"}'
```

---

### 3. Rain Question (`/chat`)

**PowerShell:**
```powershell
$body = @{ q = "Will it rain tomorrow in Kolkata?"; lang = "en" } | ConvertTo-Json
Invoke-RestMethod -Uri "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/chat" -Method POST -Headers @{ "Content-Type" = "application/json" } -Body $body | ConvertTo-Json -Depth 5
```

**curl:**
```bash
curl -X POST "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/chat" \
  -H "Content-Type: application/json" \
  -d '{"q":"Will it rain tomorrow in Kolkata?","lang":"en"}'
```

---

### 4. Spraying Decision Question (`/chat`)

**PowerShell:**
```powershell
$body = @{ q = "Is it safe to spray pesticides in Lucknow tomorrow?"; lang = "hi" } | ConvertTo-Json
Invoke-RestMethod -Uri "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/chat" -Method POST -Headers @{ "Content-Type" = "application/json" } -Body $body | ConvertTo-Json -Depth 5
```

**curl:**
```bash
curl -X POST "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/chat" \
  -H "Content-Type: application/json" \
  -d '{"q":"Is it safe to spray pesticides in Lucknow tomorrow?","lang":"hi"}'
```

---

### 5. Irrigation Question (`/chat`)

**PowerShell:**
```powershell
$body = @{ q = "Should I irrigate wheat crops in Jaipur?"; lang = "en" } | ConvertTo-Json
Invoke-RestMethod -Uri "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/chat" -Method POST -Headers @{ "Content-Type" = "application/json" } -Body $body | ConvertTo-Json -Depth 5
```

**curl:**
```bash
curl -X POST "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/chat" \
  -H "Content-Type: application/json" \
  -d '{"q":"Should I irrigate wheat crops in Jaipur?","lang":"en"}'
```

---

### 6. Harvest Question (`/chat`)

**PowerShell:**
```powershell
$body = @{ q = "Can I harvest my crop in Pune tomorrow?"; lang = "mr" } | ConvertTo-Json
Invoke-RestMethod -Uri "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/chat" -Method POST -Headers @{ "Content-Type" = "application/json" } -Body $body | ConvertTo-Json -Depth 5
```

**curl:**
```bash
curl -X POST "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/chat" \
  -H "Content-Type: application/json" \
  -d '{"q":"Can I harvest my crop in Pune tomorrow?","lang":"mr"}'
```

---

### 7. Simulated Cyclone Demo (`/chat`)

**PowerShell:**
```powershell
$body = @{ q = "Any cyclone near Kolkata?"; lang = "bn"; demo = "cyclone" } | ConvertTo-Json
Invoke-RestMethod -Uri "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/chat" -Method POST -Headers @{ "Content-Type" = "application/json" } -Body $body | ConvertTo-Json -Depth 5
```

**curl:**
```bash
curl -X POST "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/chat" \
  -H "Content-Type: application/json" \
  -d '{"q":"Any cyclone near Kolkata?","lang":"bn","demo":"cyclone"}'
```

---

### 8. Invalid Input Handling (`/chat`)

**Missing `q` parameter:**
```powershell
# Returns HTTP 400 with {"error": "q is required"}
$body = @{ lang = "en" } | ConvertTo-Json
try {
  Invoke-RestMethod -Uri "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/chat" -Method POST -Headers @{ "Content-Type" = "application/json" } -Body $body
} catch {
  $_.Exception.Response.StatusCode.value__
  (New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd()
}
```

**Non-weather or unknown location question:**
```bash
curl -X POST "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/chat" \
  -H "Content-Type: application/json" \
  -d '{"q":"Tell me a joke","lang":"en"}'
```
*Returns friendly guide indicating what topics can be answered.*

---

### 9. Rate Limit Behavior (`/chat`)

Limit: **20 requests per minute per IP**.

When exceeded:
- **HTTP Status:** `429 Too Many Requests`
- **Body:**
  ```json
  {
    "error": "Too many requests. Please wait a minute."
  }
  ```

Test loop in PowerShell:
```powershell
1..25 | ForEach-Object {
  Write-Host "Request $_..."
  $body = @{ q = "Weather in Delhi"; lang = "en" } | ConvertTo-Json
  try {
    $res = Invoke-RestMethod -Uri "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/chat" -Method POST -Headers @{ "Content-Type" = "application/json" } -Body $body
    Write-Host "Success ($($res.facts.location))"
  } catch {
    Write-Host "Caught expected HTTP $($_.Exception.Response.StatusCode.value__)"
  }
}
```

---

## Running Local Unit & Integration Tests

The repository includes offline unit tests, frontend acceptance tests, and live integration test suites:

```powershell
# Run the entire test suite via npm
npm test

# Or run individual test suites directly:
node tests/test_units.mjs      # Unit tests (numbers guard, date resolver, advisories, alerts)
node tests/test_frontend.mjs   # Frontend acceptance tests (DOM IDs, config.js, app.js constraints)
node tests/test_live_apis.mjs  # Live Open-Meteo API tests (geocoding, 7-day forecast, archive)
```
