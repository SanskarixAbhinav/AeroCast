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
├── frontend/                           # React + Vite frontend application
│   ├── src/                            # App.jsx, index.css, main.jsx
│   ├── index.html                      # HTML5 entry with Google Fonts
│   ├── vite.config.js                  # Vite bundler config
│   ├── vercel.json                     # Vercel SPA routing rewrite
│   ├── netlify.toml                    # Netlify SPA routing rewrite
│   └── .env.example                    # Frontend environment placeholder (VITE_SUPABASE_URL)
├── tests/
│   ├── test_units.mjs                  # Offline tests: guard, dates, advisory, alerts
│   └── test_live_apis.mjs              # Online tests: Open-Meteo geocoding, forecast, archive
├── .env.example                        # Global environment variables template
└── README.md                           # Documentation & deployment guide
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

## Environment Variables

### Backend Secrets (Supabase)
| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | **Required.** Google AI Studio / Gemini API Key | `AIzaSy...` |
| `GEMINI_MODEL` | Optional. Gemini model alias or ID | `gemini-flash-latest` |
| `SUPABASE_URL` | Auto-injected in hosted Edge Functions | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected in hosted Edge Functions | `eyJ...` |

### Frontend Variables (Vite)
| Variable | Description | Example |
| :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | Base URL of your Supabase project | `https://YOUR_PROJECT_REF.supabase.co` |

> [!CAUTION]
> **Never** expose `GEMINI_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in frontend code or repository commits.

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

### Step 2: Deploy Frontend

#### Option A: Run Locally
```powershell
# 1. Navigate to the frontend directory
cd frontend

# 2. Create your local environment file
Copy-Item .env.example .env

# 3. Open .env and set your Supabase project URL:
# VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co

# 4. Start local development server
npm run dev
```
Open `http://localhost:5173` in your browser.

#### Option B: Deploy to Vercel
1. Import repository on [vercel.com](https://vercel.com).
2. Set **Root Directory** to `frontend`.
3. Under **Environment Variables**, add:
   - `VITE_SUPABASE_URL` = `https://YOUR_PROJECT_REF.supabase.co`
4. Click **Deploy**.

#### Option C: Deploy to Netlify
1. Import repository on [netlify.com](https://netlify.com).
2. Set **Base directory** to `frontend`.
3. Set **Build command** to `npm run build`.
4. Set **Publish directory** to `frontend/dist`.
5. Under **Environment Variables**, add:
   - `VITE_SUPABASE_URL` = `https://YOUR_PROJECT_REF.supabase.co`
6. Click **Deploy**.

---

## API Testing (Exact Commands)

Replace `<YOUR_PROJECT_REF>` with your Supabase project reference (or use `http://127.0.0.1:54321` if running locally).

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

The repository includes both offline and live integration test suites:

```powershell
# Run unit tests (numbers guard, date resolver, advisories, alert thresholds)
node tests/test_units.mjs

# Run live API tests (Open-Meteo geocoding, 7-day forecast, archive history)
node tests/test_live_apis.mjs
```
