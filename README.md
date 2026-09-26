# AeroCast | Zero-Guesswork AI Weather & Farming Advisory

AeroCast is an AI-powered hyperlocal weather, marine safety, and agricultural advisory platform engineered specifically for farmers, coastal fishing communities, and field operations across India.

Unlike generic chatbot wrappers, AeroCast pairs **Google Gemini 3.8 Flash** with **deterministic rule engines** (FAO-56 evapotranspiration, IMD agricultural thresholds, and WMO sea-state criteria) and a **strict numerical anti-hallucination guard** that scans every number against live data from **Open-Meteo**.

---

## Key Features

1. **Hyperlocal Weather & 7-Day Forecast:** Live temperature, humidity, precipitation probability, wind speed/gusts, and FAO-56 Reference Evapotranspiration ($ET_0$).
2. **Air Quality & UV Index:** Real-time PM2.5, PM10, and US AQI indices for Indian cities with color-coded severity badges, plus peak solar UV Index forecasts.
3. **Catchment Flood / River Discharge:** Live river discharge telemetry ($m^3/s$) from Open-Meteo Flood API evaluating catchment threshold alerts.
4. **Marine & Coastal Safety:** Coastal wave height, wave period, wave direction, and swell safety checks for artisanal fishing boats.
5. **Farm Decision Engine:** Automated spray windows (wind < 15 km/h, rain < 30%), 2-day irrigation demand, and harvest suitability calculations.
6. **Multi-NWP Model Consensus:** Multi-model ensemble contrasting NOAA GFS vs ECMWF IFS for transparent forecast consensus.
7. **Climate Trends (ERA5 Archive):** Historical weather back to 1940 rendered via lightweight inline SVG trend charts.
8. **6 Indian Languages & Voice I/O:** Conversational support across English, हिंदी (Hindi), বাংলা (Bengali), தமிழ் (Tamil), తెలుగు (Telugu), and मराठी (Marathi) with hands-free speech recognition and synthesis.
9. **Authentication & User Preferences:** Supabase client-side Auth with Email Magic Link and Phone OTP, with an uncompromised **Guest Mode** fallback.
10. **Search History for Logged-In Users:** Saved personal inquiry log grouped by date (Today / Yesterday / Earlier), with one-tap re-querying, per-item deletion, and clear-all capabilities.
11. **Outdoor-Legible Visual Identity:** Typography pairing from Google Fonts (Plus Jakarta Sans + Inter), heavy numbers for rapid sunlight reading, diagonal striped patterns for simulated demo data, and a shimmer skeleton loading state.
12. **Installable PWA:** Static shell caching and Service Worker offline readiness for low-connectivity rural environments.

---

## Architecture Overview

```
AeroCast/
├── frontend/                           # Plain HTML5 / Vanilla JS frontend (no build step)
│   ├── landing.html                    # Marketing landing page with hero, how-it-works, features, roadmap
│   ├── index.html                      # Core interactive application & conversation workspace
│   ├── app.js                          # Client-side UI logic, search history events, mock data, and rendering
│   ├── auth.js                         # Supabase Auth (email magic link + phone OTP) and Search History drawer
│   ├── style.css                       # Responsive design system, typography tokens & high-contrast theme
│   ├── config.js                       # Runtime configuration (API_URL, USE_MOCK, SUPABASE_URL, ANON_KEY)
│   ├── manifest.json                   # Web App Manifest for PWA installation
│   ├── sw.js                           # Service worker for static asset caching
│   └── icon.svg                        # Vector brand mark
├── supabase/
│   ├── migrations/
│   │   ├── 20260925000000_init.sql           # api_cache, cyclone_bulletins, chat_logs
│   │   ├── 20260925000100_user_prefs.sql     # user_prefs table with Row Level Security (RLS)
│   │   └── 20260925000200_search_history.sql # search_history table with user-isolated RLS
│   └── functions/
│       ├── _shared/                    # Shared Deno/TypeScript meteorological & guard modules
│       ├── chat/index.ts               # POST /chat edge function pipeline
│       └── health/index.ts             # GET /health health check endpoint
├── tests/
│   ├── test_units.mjs                  # Offline tests: guard, dates, advisory, alerts, AQI/flood datasets
│   ├── test_frontend.mjs               # Acceptance tests: DOM element IDs, landing page, search history, fonts
│   ├── test_live_apis.mjs              # Online tests: Open-Meteo geocoding, forecast, air quality, flood
│   └── check_ts_syntax.mjs             # TypeScript syntax validation across all edge functions
├── server.mjs                          # Standalone Node.js static & resilient mock API server for local dev
└── package.json
```

---

## Authentication & Search History

AeroCast uses client-side Supabase Auth with zero custom backend dependencies:

### 1. Email Magic Link
- **Enabled by default** in all Supabase projects.
- Users input their email address and click "Send magic link" in the sign-in modal (top-right of the app, or `index.html?auth=1`). Supabase dispatches the login link automatically.
- Clicking the link logs the user into AeroCast without requiring any password creation.

### 2. Phone OTP Authentication
- **Requires SMS Provider Setup:** Phone authentication relies on Supabase Auth's phone provider.
- In production, an SMS provider (Twilio, MSG91, Vonage, or AWS SNS) must be enabled in the Supabase Dashboard:
  1. Go to **Supabase Dashboard** → **Authentication** → **Providers** → **Phone**.
  2. Toggle **Enable Phone Provider**.
  3. Enter your SMS provider credentials (e.g., Twilio Account SID & Auth Token or MSG91 Auth Key).
  4. Save changes.
- In the app, users switch to the **Phone** tab, enter their number with country code (e.g. `+91 98765 43210`), receive a 6-digit OTP, and enter it to verify.

### 3. Guest Mode Guarantee
- **No login wall:** You do **NOT** need to log in or set up an SMS provider to demo or use AeroCast.
- Unauthenticated guest users have full access to:
  - Weather chat pipeline and voice recognition
  - Live forecasts, Air Quality (AQI), and Flood river discharge
  - Marine safety checks and farming advisories
  - Multi-NWP model comparison and ERA5 historical charts
  - Interactive location map and the live regional map watch
  - Cyclone simulation and PWA offline installation
- Logging in unlocks:
  - **Search History Drawer** (`frontend/auth.js`): view past questions grouped by Today / Yesterday / Earlier, re-ask with one tap, or delete records (individually or all at once).
  - **Persisted Language Preference:** Restores the user's preferred Indian language across sessions.

### 4. Enabling it in your own deployment
Set `SUPABASE_URL` and `ANON_KEY` in `frontend/config.js` (the anon/public key from Supabase Dashboard → Project Settings → API). Until `ANON_KEY` is set, the sign-in modal shows a friendly notice and the app keeps working fully in Guest Mode — nothing breaks.

---

## Applying Database Migrations

Apply migrations to your Supabase project:

### Using Supabase CLI:
```powershell
npx supabase db push
```

### Using Supabase SQL Editor:
Copy and paste the contents of `supabase/migrations/20260925000100_user_prefs.sql` and `supabase/migrations/20260925000200_search_history.sql` into the Supabase Dashboard SQL Editor and execute them:

```sql
-- Search history table with RLS
create table if not exists public.search_history (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  question text not null,
  lang text default 'en',
  location text,
  topic text,
  created_at timestamptz default now()
);

alter table public.search_history enable row level security;

create policy "Users can select own search history"
  on public.search_history for select
  using (auth.uid() = user_id);

create policy "Users can insert own search history"
  on public.search_history for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own search history"
  on public.search_history for delete
  using (auth.uid() = user_id);
```

---

## Quickstart & Local Development

### 1. Run Locally
```powershell
# Install optional dev packages (no bundler required)
npm install

# Start local server on port 3000
npm start
```
Visit:
- Landing Page: **[http://localhost:3000/](http://localhost:3000/)** (or [http://localhost:3000/landing.html](http://localhost:3000/landing.html))
- Main Application: **[http://localhost:3000/index.html](http://localhost:3000/index.html)**
- Direct Auth Modal: **[http://localhost:3000/index.html?auth=1](http://localhost:3000/index.html?auth=1)**

### 2. Localhost Fallback Engine
Even when running without an active internet connection or on basic static servers without the `/api/chat` route (e.g. `python -m http.server` or VS Code Live Server), AeroCast automatically falls back to its responsive local meteorological engine. The app will never crash or present a broken error page.

### 3. Run Test Suites
```powershell
# Run all unit, frontend, and live API tests
npm test
```

---

## License
MIT License • 2026 AeroCast Team