# WeatherGPT Frontend

A lightweight, high-performance static frontend for WeatherGPT. Built with **pure HTML5, CSS, and Vanilla JavaScript** — **NO framework, NO npm dependencies, and NO build step required**.

---

## Quick Start (Run Locally)

You can run this frontend with any static web server:

### Option 1: Python (Built-in)
```bash
# Navigate to the frontend directory
cd frontend

# Python 3
python -m http.server 3000
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### Option 2: Node.js `serve` (No installation needed)
```bash
cd frontend
npx serve .
```

### Option 3: VS Code Live Server
Right-click `index.html` in VS Code and select **"Open with Live Server"**.

---

## Configuration (`config.js`)

All runtime options are configured in [`config.js`](config.js):

```javascript
window.CONFIG = {
  // 1. Supabase Edge Function chat endpoint
  API_URL: "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/chat",

  // 2. Set to true to test UI with realistic mock data (no backend needed)
  //    Set to false when connecting to your live Supabase Edge Function
  USE_MOCK: true,

  // 3. Optional: Supabase Anon Key (if deployed with JWT verification enabled)
  ANON_KEY: ""
};
```

> [!TIP]
> While developing or verifying UI features, keep `USE_MOCK: true`. When you deploy your Supabase backend functions, switch `USE_MOCK: false` and set `API_URL` to your live Supabase endpoint.

---

## Deployment Instructions

Because this frontend consists only of static files (`index.html`, `style.css`, `app.js`, `config.js`), you can host it anywhere for free.

### 1. Netlify
1. Log into [Netlify](https://www.netlify.com/).
2. Drag and drop the `frontend/` folder directly into the Netlify dashboard, OR link your Git repository and set:
   - **Base directory:** `frontend`
   - **Build command:** *(leave empty)*
   - **Publish directory:** `frontend` (or `.` if base directory is set to `frontend`)
3. Edit `config.js` with your production Supabase URL.

### 2. Vercel
1. Log into [Vercel](https://vercel.com/).
2. Import your Git repository.
3. Configure the project:
   - **Root Directory:** `frontend`
   - **Framework Preset:** `Other`
   - **Build & Output Settings:** None needed
4. Click **Deploy**.

### 3. GitHub Pages
1. Push this repository to GitHub.
2. Go to **Settings** → **Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**.
4. Choose your branch and select `/frontend` as the folder (or move files to root or `/docs`).
5. Click **Save**.

---

## Features & Accessibility

- **Multilingual Support:** English, Hindi (हिन्दी), Bengali (বাংলা), Tamil (தமிழ்), Telugu (తెలుగు), and Marathi (मराठी).
- **Anti-Hallucination Data Card:** Rendered strictly from `response.facts` and `response.alerts` (temperature, rainfall, wind, 7-day strip, farming advisories, cyclone status).
- **Interactive Map:** Leaflet map with OpenStreetMap tiles displaying the location pin.
- **Voice Input:** Web Speech Recognition with Indian locale support (`en-IN`, `hi-IN`, `bn-IN`, etc.).
- **Voice Output:** Speech Synthesis text-to-speech with replay speaker button on assistant responses.
- **Sunlight Readability & Dark Mode:** High-contrast palette compliant with `prefers-color-scheme: dark`.
- **Fail-safe Network Handling:** 20-second timeout handling with a built-in retry button.
