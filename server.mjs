import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const FRONTEND_DIR = path.resolve(__dirname, 'frontend');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

// Helper: read POST request body as JSON
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) { // 1MB limit
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// ---- In-memory caches (avoids repeated API calls for same location) ----
const GEO_CACHE = new Map();   // city -> { lat, lon, name, label, ts }
const WX_CACHE  = new Map();   // `${lat.toFixed(2)},${lon.toFixed(2)}` -> { data, ts }
const GEO_TTL   = 60 * 60 * 1000;   // 1 hour
const WX_TTL    = 5  * 60 * 1000;   // 5 minutes

function geoKey(name) { return name.toLowerCase().trim(); }
function wxKey(lat, lon) { return `${lat.toFixed(2)},${lon.toFixed(2)}`; }

// Fetch with a timeout + one retry on transient failures (timeout, network
// blip, 429, or a 5xx). A plain 4xx (bad request, not found) is not retried
// since retrying won't change the outcome. Every failure is logged with its
// actual reason (status code, timeout, or network error) so a broken
// deployment shows up in the server logs instead of only ever surfacing as
// an opaque "Weather data is unavailable" to the user with no way to tell
// whether it was a timeout, a bad response, or something else. Mirrors the
// retry pattern the Supabase/Deno side already has in _shared/utils.ts's
// fetchJson - server.mjs previously had none of this for its raw fetches.
async function fetchWithRetry(url, { timeoutMs = 6000, retries = 1, label = 'weather' } = {}) {
  let lastReason = 'unknown error';
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;
      lastReason = `HTTP ${res.status}`;
      if (res.status !== 429 && res.status < 500) return res; // non-retryable 4xx
    } catch (err) {
      lastReason = (err?.name === 'TimeoutError' || err?.name === 'AbortError')
        ? `timeout after ${timeoutMs}ms`
        : (err?.message || String(err));
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  console.error(`[AeroCast] ${label} fetch failed (${retries + 1} attempt(s)): ${lastReason} — ${url.split('?')[0]}`);
  return null;
}

// ---------------------------------------------------------------------------
// Intent helpers: date/topic/follow-up resolution.
//
// This mirrors supabase/functions/_shared/{dates,llm,followup}.ts. It exists
// here (duplicated, not imported) because this file is a plain Node/ESM
// script and the Supabase functions are Deno modules (Deno.serve, Deno.env,
// relative ".ts" imports resolved against Postgres-backed db.ts) that can't
// be imported directly into Node. Kept in sync by hand, same pattern the
// existing tests/test_intent.mjs and tests/test_units.mjs already use for
// the rest of this pipeline.
// ---------------------------------------------------------------------------

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// rows[].date is a plain "YYYY-MM-DD" local calendar date (Open-Meteo
// timezone=auto). Using the UTC getter here keeps this pure calendar
// arithmetic on the date string, never a server-timezone conversion.
function weekdayOfDate(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

// hint -> which index into the 7-day `rows` array the question meant.
// -1 = outside the 7-day forecast window (caller should say so, not guess).
function resolveDayIndex(hint, rows) {
  const h = (hint || "today").trim();
  if (!h || h === "today") return 0;
  if (h === "tomorrow") return 1;
  if (h === "day_after") return 2;

  const weekdayHint = h.match(/^next_(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (weekdayHint) {
    const target = WEEKDAYS.indexOf(weekdayHint[1]);
    // "next Monday" never means today, even if today is Monday.
    for (let i = 1; i < rows.length; i++) {
      if (weekdayOfDate(rows[i].date) === target) return i;
    }
    return -1;
  }

  if (h === "this_weekend") {
    for (let i = 0; i < rows.length; i++) {
      const wd = weekdayOfDate(rows[i].date);
      if (wd === 6 || (i === 0 && wd === 0)) return i;
    }
    return -1;
  }

  return rows.findIndex((r) => r.date === h);
}

// Offline date-hint detector (same keyword patterns as llm.ts's
// fallbackParseIntent). Runs on every question here since this file has no
// Gemini-based structured intent extraction.
function detectDateHint(qLower) {
  const weekdayMatch = qLower.match(/\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (/day after tomorrow/.test(qLower)) return "day_after";
  if (weekdayMatch) return `next_${weekdayMatch[1]}`;
  if (/\bthis\s+weekend\b|\bweekend\b/.test(qLower)) return "this_weekend";
  if (/\btomorrow\b|\bkal\b/.test(qLower)) return "tomorrow";
  const iso = qLower.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  return null; // no explicit date phrase in THIS question - let the caller
  // decide between inheriting context.date (follow-up) and "today" (fresh
  // question), the same two-step pattern already used for topic.
}

// Specific weather variables named in the question (independent of topic) -
// used only to enrich the deterministic answer text; never invents values,
// only decides which already-fetched values to mention.
function detectNeeds(qLower) {
  const found = [];
  const add = (v) => { if (!found.includes(v)) found.push(v); };
  if (/feels like|apparent temperature|real feel|heat index/.test(qLower)) add("apparent_temperature");
  if (/\btemp(erature)?\b|\bhot\b|\bcold\b|\bheat\b|\bwarm\b/.test(qLower)) add("temperature");
  if (/precipitation probability|chance of rain|rain chance|probability of rain/.test(qLower)) add("precipitation_probability");
  if (/\bhumid(ity)?\b|moisture/.test(qLower)) add("humidity");
  if (/\bgust/.test(qLower)) add("wind_gusts");
  if (/\bwind\b|breeze/.test(qLower)) add("wind_speed");
  if (/\buv\b|uv index|sunburn/.test(qLower)) add("uv_index");
  return found;
}

// context.location is the full geocoded label ("Kolkata, West Bengal,
// India"); the geocoder wants just the place name.
function primaryName(label) {
  if (!label || typeof label !== "string") return null;
  const first = label.split(",")[0]?.trim();
  return first || null;
}

// Generic Title-Case fallback for place names with no preposition anchor
// ("Rajkot weather", bare "Darjeeling"). No hardcoded city list - just skips
// common English question-starter words, same approach as llm.ts's
// fallbackParseIntent Pass 2.
const LOCATION_STOPWORDS = new Set([
  "will", "is", "are", "do", "does", "did", "can", "could", "should",
  "what", "when", "where", "how", "any", "please",
  "it", "the", "a", "an", "there", "here", "this", "that", "i", "we",
  "you", "they",
]);
function extractTitleCaseLocation(q) {
  const runs = (q.match(/\b[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*\b/g) ?? [])
    .map((r) => r.trim())
    .filter((r) => !r.split(/\s+/).every((w) => LOCATION_STOPWORDS.has(w.toLowerCase())));
  return runs.length ? runs[runs.length - 1] : null;
}

const GEMINI_LANGS = { en: "English", hi: "Hindi", bn: "Bengali", ta: "Tamil", te: "Telugu", mr: "Marathi" };

// Hindi/Marathi (Devanagari), Bengali, Tamil and Telugu digits -> ASCII.
// Without this, a hallucinated number written in a native digit script
// (e.g. Gemini replying in Hindi with "५०") would contain no character
// JS's ASCII-only \d matches, so the loop below would silently find zero
// digits to check and let it through unguarded. Mirrors guard.ts's toAscii.
const NATIVE_DIGIT_ZEROS = [0x0966, 0x09E6, 0x0BE6, 0x0C66];
function toAsciiDigits(s) {
  return s.replace(/[\u0966-\u096F\u09E6-\u09EF\u0BE6-\u0BEF\u0C66-\u0C6F]/g, (c) => {
    const code = c.charCodeAt(0);
    const zero = NATIVE_DIGIT_ZEROS.find((z) => code >= z && code < z + 10);
    return String(code - zero);
  });
}

// Small numbers the narration may use naturally, plus every number already
// present in facts (rounded variants allowed). Mirrors guard.ts numbersOk -
// if Gemini's phrasing contains any number NOT traceable to facts, the
// caller must discard it and keep the deterministic template instead.
function numbersOk(answer, facts) {
  const allowed = new Set([0, 1, 2, 3, 4, 5, 6, 7, 12, 24, 48]);
  for (const m of JSON.stringify(facts).match(/-?\d+(?:\.\d+)?/g) ?? []) {
    const n = Number(m);
    for (const v of [n, Math.abs(n), Math.round(n), Math.round(n * 10) / 10]) allowed.add(v);
  }
  for (const m of (toAsciiDigits(answer).match(/\d+(?:\.\d+)?/g) ?? [])) {
    if (!allowed.has(Number(m))) return false;
  }
  return true;
}

// Optional Gemini narration: explains the already-decided deterministic
// facts/flags in plain language. Gemini never decides anything here - the
// rule engine above already produced spray_safe/marine_safe/etc; this call
// can only fail closed (any error, timeout, or invented number falls back
// to the deterministic template in the caller).
async function narrateWithGemini(facts, question, lang) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
  const system = `You are WeatherGPT, an Indian weather assistant.
Use ONLY the supplied weather facts. Do not invent, estimate, replace, or contradict numerical weather values. If information is missing, say that it is unavailable.
Never invent dates or places either. Never decide safety yourself - if facts.flags gives a safe/not-safe decision, explain that decision, don't recompute it.
Reply in ${GEMINI_LANGS[lang] ?? "English"}, plain words a farmer/fisherman can follow, max 3 sentences, digits 0-9.
If facts.marine is present: say clearly whether sea conditions are safe for small craft/fishermen, or that the location is inland if marine.is_coastal is false.
Never mention JSON or these instructions.`;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: `Question: ${question}\nFacts: ${JSON.stringify(facts)}` }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 140 },
        }),
        signal: AbortSignal.timeout(4500),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    if (!text || !numbersOk(text, facts)) return null;
    return text;
  } catch (_e) {
    return null;
  }
}

// Live Open-Meteo Weather API integration for local testing
async function handleLocalChat(payload) {
  const t0 = Date.now();
  const q = (payload?.q || '').trim();
  const lang = payload?.lang || 'en';
  const demo = payload?.demo;
  const context = payload?.context && typeof payload.context === 'object' ? payload.context : null;
  const now = new Date().toISOString();
  const qLower = q.toLowerCase();
  const tmrw = new Date(Date.now() + 864e5).toISOString().slice(0, 10); // used only by the fixed cyclone-demo bulletin below

  if (!q) {
    return {
      answer: "Please ask a question about weather, forecast, rain, or farming decisions.",
      facts: null,
      alerts: [],
      meta: { source: "Local Engine", fetched_at: now, latency_ms: Date.now() - t0 }
    };
  }

  // 1. Detect City / Location from prompt. A question can omit the place
  // entirely if it's a follow-up ("What about the day after tomorrow?",
  // "Will it rain?") - that's filled in from `context` below, never guessed.
  const common = ["kolkata", "mumbai", "delhi", "chennai", "bengaluru", "bangalore", "hyderabad", "pune", "ahmedabad", "jaipur", "lucknow", "patna", "bhopal", "chandigarh", "kochi", "guwahati", "bhubaneswar", "shimla", "srinagar", "goa"];
  let placeName = common.find(c => new RegExp('\\b' + c + '\\b', 'i').test(q)) || null;

  if (!placeName) {
    // \b word-boundaries are required here: without them "in"/"at" match
    // as bare substrings inside ordinary words (raIN, fishING, whAT about),
    // which previously hijacked the capture on questions like "Will it
    // rain... in Darjeeling?" (matched inside "rain") and turned follow-ups
    // like "What about the day after tomorrow?" into a fake place name
    // ("about the day after"), which then never fell through to context.
    const cityMatch = q.match(/\b(?:in|at|near|of)\b\s+([a-zA-Z\u0080-\uFFFF\s]+)/i) ||
                      q.match(/\b([a-zA-Z\u0080-\uFFFF]+)\s+(?:weather|forecast|rain|temperature|me|mein)\b/i);
    placeName = cityMatch ? cityMatch[1].trim().replace(/[?,.!]+$/, '') : null;
    if (placeName) {
      placeName = placeName.replace(/\b(?:tomorrow|today|yesterday|next\s+week|this\s+week|july|spray|pesticide|harvest|irrigation|forecast|weather|rain|marine|sea|coastal|fishing|please|now)\b/gi, '').trim();
      // The preposition regex can occasionally capture nothing usable once
      // date/topic words are stripped (e.g. it matched on "of" in an
      // unrelated clause) - don't trust an empty leftover as a place.
      // It can also capture a lone pronoun/article ("it" from "Will it
      // rain?") when the keyword-adjacency pattern fires - reject those
      // the same way extractTitleCaseLocation rejects stopword-only runs.
      if (!placeName || placeName.split(/\s+/).every((w) => LOCATION_STOPWORDS.has(w.toLowerCase()))) {
        placeName = null;
      }
    }
  }
  if (!placeName) {
    placeName = extractTitleCaseLocation(q);
  }

  // Follow-up: this question named no place of its own - reuse the previous
  // turn's resolved location, exactly like followup.ts's resolveFollowUp.
  // Never overrides a place the question DID name.
  let usedContextLocation = false;
  if (!placeName && context) {
    const fromContext = primaryName(context.location);
    if (fromContext) { placeName = fromContext; usedContextLocation = true; }
  }

  if (!placeName && !demo) {
    return {
      answer: "Please specify a city or town name (e.g., 'Will it rain tomorrow in Kolkata?').",
      facts: null,
      alerts: [],
      meta: { source: "Local Engine", fetched_at: now, latency_ms: Date.now() - t0 }
    };
  }

  // 2. Geocode with Open-Meteo (with in-memory cache).
  // These Kolkata values are ONLY a placeholder for the no-location cyclone
  // demo path below (demo === 'cyclone' with no city named). They must
  // never silently stand in for a real place the user asked about - if
  // placeName was given and geocoding fails/returns nothing, that's a
  // geocodeFailed error, not "answer as if they asked about Kolkata".
  let lat = 22.57, lon = 88.36, label = "Kolkata, West Bengal, India", name = "Kolkata";
  let geocodeFailed = false;
  if (placeName) {
    const ck = geoKey(placeName);
    const cached = GEO_CACHE.get(ck);
    if (cached && Date.now() - cached.ts < GEO_TTL) {
      ({ lat, lon, name, label } = cached);
    } else {
      try {
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(placeName)}&count=1&language=en&format=json`;
        const gRes = await fetchWithRetry(geoUrl, { label: 'geocoding' });
        if (gRes && gRes.ok) {
          const gData = await gRes.json().catch((e) => {
            console.error(`[AeroCast] geocoding response was not valid JSON: ${e.message}`);
            return null;
          });
          if (gData?.results && gData.results.length > 0) {
            const r = gData.results[0];
            lat = r.latitude;
            lon = r.longitude;
            name = r.name;
            label = [r.name, r.admin1, r.country].filter(Boolean).join(", ");
            GEO_CACHE.set(ck, { lat, lon, name, label, ts: Date.now() });
          } else {
            geocodeFailed = true; // city not found in gazetteer (or unparseable response)
          }
        } else {
          if (gRes) console.error(`[AeroCast] geocoding fetch returned HTTP ${gRes.status}`);
          geocodeFailed = true; // geocoding API unreachable or returned an error status
        }
      } catch (err) {
        // offline, timed out, or an unexpected error - logged instead of silent
        console.error(`[AeroCast] geocoding block threw: ${err?.stack || err}`);
        if (cached) ({ lat, lon, name, label } = cached); // use stale if available
        else geocodeFailed = true;
      }
    }
  }

  // Never answer about Kolkata when the user actually named a different,
  // unresolvable place - say so plainly instead of silently substituting
  // a hardcoded location (this would otherwise give wrong-place advisory
  // data, e.g. marine safety, for someone's real city).
  if (geocodeFailed && !demo) {
    return {
      answer: `Sorry, I couldn't find "${placeName}". Please check the spelling, or try a nearby larger town or city.`,
      facts: null,
      alerts: [],
      meta: { source: "Local Engine", fetched_at: now, latency_ms: Date.now() - t0, context: { location: placeName, topic: null } }
    };
  }

  // 3. Cyclone demo handling
  if (demo === 'cyclone' || /cyclone|storm|चक्रवात|ঘূর্ণিঝড়|புயல்/i.test(q)) {
    const basin = lon > 80 ? "Bay of Bengal" : "Arabian Sea";
    return {
      answer: `A severe cyclonic storm 'Cyclone DEMO' is active over the ${basin} with sustained winds up to 110 km/h near ${name}. Fishermen and coastal communities are advised to suspend all marine activities.`,
      facts: {
        topic: "cyclone",
        location: label,
        lat, lon, stale: false,
        day: { date: tmrw, temp_max: 29, temp_min: 24, rain_mm: 85, rain_prob: 90, wind_max_kmh: 65, gust_max_kmh: 95, et0_mm: 2 },
        cyclone: {
          name: "Cyclone DEMO",
          basin,
          category: "Severe Cyclonic Storm",
          max_wind_kmh: 110,
          landfall_estimate: "Coastal belt in 36h",
          advisory: "Coastal communities should avoid open waters. Secure temporary structures.",
          simulated: true
        }
      },
      alerts: [{
        type: "cyclone",
        level: "red",
        date: tmrw,
        message: "SIMULATED: Cyclone DEMO bulletin in effect (110 km/h winds).",
        simulated: true,
        official: false
      }],
      meta: { source: "AeroCast Local Simulation", fetched_at: now, from_cache: false, stale: false, latency_ms: Date.now() - t0, context: { location: label, topic: "cyclone" } }
    };
  }

  // 4. Past History handling (e.g. July rain)
  if (/july|history|past|archive|last\s+year|last\s+month/i.test(q)) {
    const startDate = "2025-07-01";
    const endDate = "2025-07-31";
    let histRows = [];
    try {
      const hUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;
      const hRes = await fetchWithRetry(hUrl, { label: 'archive' });
      if (hRes && hRes.ok) {
        const hData = await hRes.json().catch(() => null);
        if (hData?.daily?.time) {
          histRows = hData.daily.time.map((d, idx) => ({
            date: d,
            temp_max: Math.round(hData.daily.temperature_2m_max[idx] ?? 31),
            temp_min: Math.round(hData.daily.temperature_2m_min[idx] ?? 25),
            rain_mm: Math.round((hData.daily.precipitation_sum[idx] ?? 0) * 10) / 10
          }));
        }
      }
    } catch (e) {
      console.error(`[AeroCast] archive block threw: ${e?.stack || e}`);
    }

    if (!histRows.length) {
      // Mock rows for July if archive unavailable
      for (let dayNum = 1; dayNum <= 31; dayNum++) {
        const dStr = `2025-07-${String(dayNum).padStart(2, '0')}`;
        histRows.push({
          date: dStr,
          temp_max: 30 + (dayNum % 4),
          temp_min: 25,
          rain_mm: (dayNum === 18) ? 120 : (dayNum % 3 === 0 ? 35 : (dayNum % 2 === 0 ? 12 : 2))
        });
      }
    }

    const totalRain = Math.round(histRows.reduce((sum, r) => sum + r.rain_mm, 0) * 10) / 10;
    const avgMax = Math.round((histRows.reduce((sum, r) => sum + r.temp_max, 0) / histRows.length) * 10) / 10;
    const rainiest = histRows.reduce((max, r) => r.rain_mm > max.rain_mm ? r : max, histRows[0]);

    return {
      answer: `${name} recorded ${totalRain} mm of total rain between ${startDate} and ${endDate}, with an average maximum temperature of ${avgMax}°C. The rainiest day had ${rainiest.rain_mm} mm on ${rainiest.date}.`,
      facts: {
        topic: "history",
        location: label,
        lat, lon, stale: false,
        history: {
          start: startDate,
          end: endDate,
          total_rain_mm: totalRain,
          avg_temp_max: avgMax,
          rainiest_day: { date: rainiest.date, rain_mm: rainiest.rain_mm },
          daily: histRows
        }
      },
      alerts: [],
      meta: { source: "Open-Meteo Archive", fetched_at: now, from_cache: false, stale: false, latency_ms: Date.now() - t0, context: { location: label, topic: "history" } }
    };
  }

  // 5. Resolve topic (with follow-up inheritance) and date, then fetch Live
  // Forecast & Multi-Model Comparison & Marine & Air Quality & Flood APIs.
  //
  // Priority order mirrors llm.ts's fallbackParseIntent: marine > spray >
  // irrigation > harvest > air_quality > flood > rain > temperature > wind
  // > forecast. If NONE of these give a signal (e.g. "What about the day
  // after tomorrow?"), the question is a follow-up with no topic of its
  // own - inherit the previous turn's topic (context.topic), same as
  // followup.ts's resolveFollowUp. Only fall back to "forecast" if there is
  // no context topic to inherit either.
  const isMarine = /marine|sea|ocean|wave|swell|boat|fish|मछली|मछुआरे|সাগর|মাছ|জেলে|கடல்|மீன்|மீனவர்|సముద్రం|చేప|మత్స్యకారులు|मच्छीमार/i.test(q);
  const isSprayKw = /spray|pesticide|fungicide|insecticide|कीटनाशक|কীটনাশক|பூச்சிக்கொல்லி/i.test(q);
  const isIrrigateKw = /irrigat|water the crop|watering|पानी|सिंचाई|সেচ|பாசனம்/i.test(q);
  const isHarvestKw = /harvest|cutting|reap|कटाई|ফসল|அறுவடை/i.test(q);
  const isFlood = /flood|river|discharge|water\s*level|inundat|बाढ़|বন্যা|வெள்ளம்|వరద|पूर/i.test(q);
  const isAirQuality = /air\s*quality|aqi|pollution|pm2\.5|pm10|smog|clean\s*air|प्रदूषण|বায়ু দূষণ|காற்றுத் தரம்|గాలి నాణ్యత/i.test(q);

  let topic = null;
  if (isMarine) topic = "marine";
  else if (isSprayKw) topic = "spray";
  else if (isIrrigateKw) topic = "irrigation";
  else if (isHarvestKw) topic = "harvest";
  else if (isAirQuality) topic = "air_quality";
  else if (isFlood) topic = "flood";
  else if (/\brain(ing|fall)?\b|precipitation|shower|drizzle|barish/i.test(q)) topic = "rain";
  else if (/\btemp(erature)?\b|\bhot\b|\bcold\b|\bheat\b|\bwarm\b/i.test(q)) topic = "temperature";
  else if (/\bwind\b|gust|breeze/i.test(q)) topic = "wind";
  else if (/forecast|week|7-day|weather|mausam/i.test(q)) topic = "forecast";
  if (!topic && context?.topic) topic = context.topic; // pure follow-up
  if (!topic) topic = "forecast";

  const needs = detectNeeds(qLower);
  // A follow-up that names no date of its own ("Will it rain?" after "...the
  // day after tomorrow?") should keep meaning the day the conversation was
  // already on, not silently reset to today - same inheritance topic
  // already gets from context, below at "if (!topic && context?.topic)".
  let dateHint = detectDateHint(qLower);
  if (!dateHint && context?.date) dateHint = context.date;
  if (!dateHint) dateHint = "today";

  let forecastData = null;
  let mcData = null;
  let marineData = null;
  let aqData = null;
  let flData = null;

  const tFetch = Date.now();

  // Check weather cache first
  const wk = wxKey(lat, lon);
  const wxCached = WX_CACHE.get(wk);
  let wxFromCache = false;
  if (wxCached && Date.now() - wxCached.ts < WX_TTL) {
    forecastData = wxCached.forecastData;
    mcData = wxCached.mcData;
    wxFromCache = true;
  }

  try {
    const fUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_gusts_10m&hourly=temperature_2m,precipitation_probability,wind_speed_10m,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,et0_fao_evapotranspiration,uv_index_max&timezone=auto&forecast_days=7`;
    const mcUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&models=gfs_seamless,ecmwf_ifs&daily=temperature_2m_max,precipitation_sum,precipitation_probability_max&timezone=auto&forecast_days=7`;
    // Marine forecast needs to cover the same 7-day window as the land
    // forecast - a 3-day window meant "day after tomorrow" or "next Monday"
    // marine questions silently had no wave data to resolve against.
    const mUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=wave_height,wave_direction,wave_period,swell_wave_height&daily=wave_height_max,wave_period_max,swell_wave_height_max&timezone=auto&forecast_days=7`;
    const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm10,pm2_5,us_aqi&timezone=auto`;
    const flUrl = `https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lon}&daily=river_discharge&forecast_days=7`;

    // 6s per attempt + 1 retry with backoff (see fetchWithRetry) - still
    // well inside the frontend's 20s AbortController ceiling even in the
    // worst case (one timeout + one retry) for every call below.
    // Fetch marine/AQ/flood whenever the RESOLVED topic needs them - not just
    // when this question's own text mentions them - so a follow-up that
    // inherited topic="marine" from context still gets wave data.
    const [fRes, mcRes, mRes, aqRes, flRes] = await Promise.all([
      wxFromCache ? Promise.resolve(null) : fetchWithRetry(fUrl, { label: 'forecast' }),
      wxFromCache ? Promise.resolve(null) : fetchWithRetry(mcUrl, { label: 'multi-model' }),
      topic === 'marine' ? fetchWithRetry(mUrl, { label: 'marine' }) : Promise.resolve(null),
      topic === 'air_quality' ? fetchWithRetry(aqUrl, { label: 'air-quality' }) : Promise.resolve(null),
      (topic === 'flood' || demo === 'cyclone') ? fetchWithRetry(flUrl, { label: 'flood' }) : Promise.resolve(null)
    ]);

    if (fRes && fRes.ok) {
      forecastData = await fRes.json().catch((e) => {
        console.error(`[AeroCast] forecast response was not valid JSON: ${e.message}`);
        return null;
      });
      if (forecastData) WX_CACHE.set(wk, { forecastData, mcData, ts: Date.now() });
    } else if (fRes) {
      console.error(`[AeroCast] forecast fetch returned HTTP ${fRes.status}`);
    }
    if (mcRes && mcRes.ok) {
      mcData = await mcRes.json().catch(() => null);
      // Update cache entry with mc data
      const existing = WX_CACHE.get(wk);
      if (existing) existing.mcData = mcData;
    }
    if (mRes && mRes.ok) marineData = await mRes.json().catch(() => null);
    if (aqRes && aqRes.ok) aqData = await aqRes.json().catch(() => null);
    if (flRes && flRes.ok) flData = await flRes.json().catch(() => null);
  } catch (e) {
    // Previously fully silent, so any failure here - even an unrelated bug,
    // not just a network issue - was invisible and only ever surfaced to the
    // user as the generic "Weather data is unavailable" message below, with
    // no way to tell what actually went wrong.
    console.error(`[AeroCast] weather-fetch block threw: ${e?.stack || e}`);
  }

  console.log(`[AeroCast] ${name}: geo=${wxFromCache ? 'cached' : 'fresh'} fetch=${Date.now() - tFetch}ms total=${Date.now() - t0}ms`);

  // Parse Air Quality
  let airQuality = null;
  if (aqData?.current) {
    const c = aqData.current;
    const aqi = c.us_aqi != null ? Math.round(c.us_aqi) : null;
    let category = "Good";
    if (aqi != null) {
      if (aqi > 300) category = "Hazardous";
      else if (aqi > 200) category = "Very Unhealthy";
      else if (aqi > 150) category = "Unhealthy";
      else if (aqi > 100) category = "Poor";
      else if (aqi > 50) category = "Moderate";
      else category = "Good";
    }
    airQuality = {
      pm2_5: c.pm2_5 != null ? Math.round(c.pm2_5 * 10) / 10 : null,
      pm10: c.pm10 != null ? Math.round(c.pm10 * 10) / 10 : null,
      aqi,
      category
    };
  }

  // Parse Flood / River Discharge
  let flood = null;
  if (flData?.daily?.river_discharge) {
    const d = flData.daily;
    const val = d.river_discharge[1] ?? d.river_discharge[0] ?? null;
    if (val != null) {
      const valid = d.river_discharge.filter(v => v != null);
      const max7d = valid.length ? Math.max(...valid) : val;
      flood = {
        river_discharge_m3s: Math.round(val * 10) / 10,
        max_discharge_7d_m3s: Math.round(max7d * 10) / 10,
        is_elevated: val >= 100 || max7d >= 150
      };
    }
  }

  // Prepare Daily Outlook
  const daily = [];
  if (forecastData?.daily?.time) {
    for (let i = 0; i < Math.min(forecastData.daily.time.length, 7); i++) {
      daily.push({
        date: forecastData.daily.time[i],
        temp_max: Math.round(forecastData.daily.temperature_2m_max[i] ?? 30),
        temp_min: Math.round(forecastData.daily.temperature_2m_min[i] ?? 24),
        rain_mm: Math.round((forecastData.daily.precipitation_sum[i] ?? 0) * 10) / 10,
        rain_prob: forecastData.daily.precipitation_probability_max?.[i] ?? 0,
        wind_max_kmh: Math.round(forecastData.daily.wind_speed_10m_max[i] ?? 15),
        gust_max_kmh: Math.round(forecastData.daily.wind_gusts_10m_max[i] ?? 25),
        et0_mm: Math.round((forecastData.daily.et0_fao_evapotranspiration?.[i] ?? 3.5) * 10) / 10,
        uv_index: forecastData.daily.uv_index_max?.[i] != null ? Math.round(forecastData.daily.uv_index_max[i] * 10) / 10 : 7.5
      });
    }
  }

  // No invented weather: if the forecast API genuinely returned nothing (not
  // even a stale/partial response), say so plainly instead of answering with
  // made-up numbers. This mirrors weather.ts's WEATHER_UNAVAILABLE path.
  if (!daily.length) {
    return {
      answer: "Weather data is unavailable right now. Please try again in a few minutes.",
      facts: null,
      alerts: [],
      meta: { source: "Open-Meteo Live API", fetched_at: now, from_cache: false, stale: false, latency_ms: Date.now() - t0, context: { location: label, topic, date: dateHint } }
    };
  }

  // Resolve which of the 7 forecast days this question means (see
  // resolveDayIndex above). -1 = outside the 7-day window (e.g. "next
  // Monday" more than a week out) - say so rather than silently showing the
  // wrong day.
  const dayIndex = resolveDayIndex(dateHint, daily);
  if (dayIndex < 0) {
    return {
      answer: "I can give forecasts for today and the next 6 days only.",
      facts: null,
      alerts: [],
      meta: { source: "Open-Meteo Live API", fetched_at: now, from_cache: false, stale: false, latency_ms: Date.now() - t0, context: { location: label, topic, date: dateHint } }
    };
  }
  const dayData = daily[dayIndex];
  const nextDayData = daily[dayIndex + 1] || null; // for 2-day-ahead spray/irrigation/harvest windows

  // Humidity has no daily aggregate from Open-Meteo - roll up the hourly
  // values for the resolved day's local date, same idea as dayAggregates()
  // in weather.ts.
  let humidityMeanPct = null, humidityMaxPct = null;
  const hh = forecastData?.hourly;
  if (hh?.time && hh?.relative_humidity_2m) {
    const vals = [];
    for (let i = 0; i < hh.time.length; i++) {
      if (hh.time[i].startsWith(dayData.date) && hh.relative_humidity_2m[i] != null) vals.push(hh.relative_humidity_2m[i]);
    }
    if (vals.length) {
      humidityMeanPct = Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10;
      humidityMaxPct = Math.round(Math.max(...vals));
    }
  }

  const currentConditions = forecastData?.current ? {
    time: forecastData.current.time,
    temperature_2m: Math.round(forecastData.current.temperature_2m * 10) / 10,
    relative_humidity_2m: forecastData.current.relative_humidity_2m,
    precipitation: forecastData.current.precipitation,
    wind_speed_10m: Math.round(forecastData.current.wind_speed_10m),
    wind_gusts_10m: Math.round(forecastData.current.wind_gusts_10m)
  } : null;

  let flags = null;
  let factsMarine = null;

  if (topic === "marine") {
    // marineData was only fetched when topic === "marine" (see the fetch
    // section above), so this is always the right index into it, using the
    // SAME resolved day as the rest of the answer (not always "tomorrow").
    const rawWave = marineData?.daily?.wave_height_max?.[dayIndex] ?? (dayIndex === 0 ? marineData?.current?.wave_height : null) ?? null;
    if (rawWave == null) {
      // Genuinely no marine data for this location/day - inland coordinates,
      // or the marine API didn't return this far out. Never invent a wave
      // height; say plainly that marine data isn't available.
      factsMarine = {
        is_coastal: false,
        message: `${name} is an inland location. Marine wave data is only available for coastal waters.`
      };
      flags = {
        marine_safe: null,
        reason: ["location is inland / non-coastal, or marine data unavailable for this day"]
      };
    } else {
      const waveM = Math.round(rawWave * 10) / 10;
      const wavePer = Math.round((marineData?.daily?.wave_period_max?.[dayIndex] ?? marineData?.current?.wave_period ?? 6) * 10) / 10;
      const swellM = Math.round((marineData?.daily?.swell_wave_height_max?.[dayIndex] ?? marineData?.current?.swell_wave_height ?? 0.5) * 10) / 10;
      const reasons = [];
      if (waveM >= 1.5) reasons.push(`wave height ${waveM}m (limit 1.5m)`);
      if (dayData.wind_max_kmh >= 25) reasons.push(`wind ${dayData.wind_max_kmh} km/h (limit 25 km/h)`);
      const safe = reasons.length === 0;

      factsMarine = {
        is_coastal: true,
        wave_height_m: waveM,
        wave_period_s: wavePer,
        swell_wave_height_m: swellM,
        wave_direction_deg: marineData?.daily?.wave_direction_dominant?.[dayIndex] ?? marineData?.current?.wave_direction ?? null
      };
      flags = {
        marine_safe: safe,
        reason: safe ? ["calm sea conditions suitable for small craft and fishing"] : reasons,
        wave_height_m: waveM,
        wave_period_s: wavePer,
        swell_wave_height_m: swellM,
        max_wind_kmh: dayData.wind_max_kmh
      };
    }
  } else if (topic === "spray") {
    const spraySafe = dayData.rain_prob < 30 && dayData.wind_max_kmh <= 15 && dayData.temp_max <= 35;
    const reasons = [];
    if (dayData.rain_prob >= 30) reasons.push("rain likely");
    if (dayData.wind_max_kmh > 15) reasons.push(`wind>${15} km/h`);
    if (dayData.temp_max > 35) reasons.push(`temp>${35}°C`);
    flags = {
      spray_safe: spraySafe,
      reason: spraySafe ? ["optimal calm weather"] : reasons,
      window: `${dayData.date} 06:00 - 18:00`,
      max_rain_prob: dayData.rain_prob,
      max_wind_kmh: dayData.wind_max_kmh,
      max_temp_c: dayData.temp_max
    };
  } else if (topic === "irrigation") {
    const rain2d = dayData.rain_mm + (nextDayData?.rain_mm || 0);
    const needIrrigate = rain2d < 5;
    flags = {
      irrigate: needIrrigate,
      reason: [needIrrigate ? "little rain expected in next 2 days" : "enough rain expected in next 2 days"],
      rain_next_2_days_mm: Math.round(rain2d * 10) / 10,
      et0_mm: dayData.et0_mm
    };
  } else if (topic === "harvest") {
    const rain2d = dayData.rain_mm + (nextDayData?.rain_mm || 0);
    const maxProb2d = Math.max(dayData.rain_prob || 0, nextDayData?.rain_prob || 0);
    const harvestOk = rain2d < 2 && maxProb2d < 40;
    flags = {
      harvest_ok: harvestOk,
      reason: harvestOk ? ["dry conditions suitable for harvest"] : ["rain expected in next 48h"],
      rain_next_2_days_mm: Math.round(rain2d * 10) / 10,
      max_rain_prob: maxProb2d
    };
  }

  // Model comparison extraction
  let modelComparison = null;
  if (mcData?.daily) {
    const gfsTemp = mcData.daily.temperature_2m_max_gfs_seamless?.[1] ?? mcData.daily.temperature_2m_max_gfs_seamless?.[0];
    const gfsRain = mcData.daily.precipitation_sum_gfs_seamless?.[1] ?? mcData.daily.precipitation_sum_gfs_seamless?.[0];
    const gfsProb = mcData.daily.precipitation_probability_max_gfs_seamless?.[1] ?? mcData.daily.precipitation_probability_max_gfs_seamless?.[0];

    const ecmwfTemp = mcData.daily.temperature_2m_max_ecmwf_ifs?.[1] ?? mcData.daily.temperature_2m_max_ecmwf_ifs?.[0];
    const ecmwfRain = mcData.daily.precipitation_sum_ecmwf_ifs?.[1] ?? mcData.daily.precipitation_sum_ecmwf_ifs?.[0];
    const ecmwfProb = mcData.daily.precipitation_probability_max_ecmwf_ifs?.[1] ?? mcData.daily.precipitation_probability_max_ecmwf_ifs?.[0];

    if (gfsTemp != null && ecmwfTemp != null) {
      const tempDiff = Math.abs(Math.round((gfsTemp - ecmwfTemp) * 10) / 10);
      const probDiff = (gfsProb != null && ecmwfProb != null) ? Math.abs(gfsProb - ecmwfProb) : null;
      const agree = tempDiff <= 2.5 && (probDiff === null || probDiff <= 25);
      modelComparison = {
        date: tmrw,
        gfs: {
          model_name: "NOAA GFS (Seamless)",
          temp_max: Math.round(gfsTemp * 10) / 10,
          rain_mm: Math.round((gfsRain ?? 0) * 10) / 10,
          rain_prob: gfsProb ?? 0
        },
        ecmwf: {
          model_name: "ECMWF IFS",
          temp_max: Math.round(ecmwfTemp * 10) / 10,
          rain_mm: Math.round((ecmwfRain ?? 0) * 10) / 10,
          rain_prob: ecmwfProb ?? 0
        },
        agreement: agree
          ? "High model consensus (GFS & ECMWF agree within 2.5°C / 25% rain prob)"
          : "Moderate spread between models — monitor for forecast shifts",
        agreement_bool: agree,
        note: "Two independent forecast models, shown for transparency"
      };
    }
  }

  // Alerts - dated against the actually-resolved day, not always "tomorrow".
  const alerts = [];
  if (dayData.rain_mm >= 115.6) {
    alerts.push({ type: "very_heavy_rain", level: "red", date: dayData.date, message: `Very heavy rain forecast (${dayData.rain_mm} mm). Risk of waterlogging.` });
  } else if (dayData.rain_mm >= 64.5) {
    alerts.push({ type: "heavy_rain", level: "orange", date: dayData.date, message: `Heavy rain expected (${dayData.rain_mm} mm).` });
  }
  if (dayData.temp_max >= 40) {
    alerts.push({ type: "heatwave", level: "orange", date: dayData.date, message: `High temperatures expected (${dayData.temp_max}°C).` });
  }
  if (factsMarine?.is_coastal && (factsMarine.wave_height_m ?? 0) >= 2.0) {
    alerts.push({
      type: "rough_sea",
      level: (factsMarine.wave_height_m >= 3.0) ? "red" : "orange",
      date: dayData.date,
      message: `Rough sea conditions (${factsMarine.wave_height_m}m waves). Fishermen and small craft advised to exercise extreme caution.`
    });
  }
  if (flood?.is_elevated) {
    alerts.push({
      type: "flood",
      level: (flood.river_discharge_m3s >= 150) ? "red" : "orange",
      date: dayData.date,
      message: `Elevated river discharge forecast (${flood.river_discharge_m3s} m³/s). Flood watch advisory.`
    });
  }

  // Specific variables the question named (see detectNeeds above) that
  // aren't already covered by the day-summary sentence below - real values
  // only, from what was already fetched.
  const requested = {};
  if (needs.includes("humidity") && humidityMeanPct != null) requested.humidity = { mean_percent: humidityMeanPct, max_percent: humidityMaxPct };
  if (needs.includes("wind_gusts")) requested.wind_gusts = { max_kmh: dayData.gust_max_kmh };
  if (needs.includes("uv_index") && dayData.uv_index != null) requested.uv_index = { max: dayData.uv_index };
  if (needs.includes("precipitation_probability")) requested.precipitation_probability = { percent: dayData.rain_prob };

  const dayLabel = dayIndex === 0 ? "today" : dayIndex === 1 ? "tomorrow" : `on ${dayData.date}`;

  let answer = "";
  if (topic === "marine") {
    if (!factsMarine?.is_coastal) {
      answer = `${name} is an inland location. Marine wave and swell advisories are only available for coastal waters. ${dayLabel === "today" ? "Today's" : dayLabel === "tomorrow" ? "Tomorrow's" : `${dayData.date}'s`} land weather: ${dayData.temp_min}°C to ${dayData.temp_max}°C with wind ${dayData.wind_max_kmh} km/h.`;
    } else if (flags.marine_safe) {
      answer = `Marine conditions off ${name} ${dayLabel} are suitable for small craft and fishing: wave heights around ${flags.wave_height_m} m with winds at ${flags.max_wind_kmh} km/h.`;
    } else {
      answer = `Marine advisory for ${name} ${dayLabel}: sea conditions are not advisable for small craft due to ${flags.reason.join(', ')}.`;
    }
  } else if (topic === "air_quality") {
    answer = airQuality
      ? `Air quality in ${name} is currently ${airQuality.category} with an AQI of ${airQuality.aqi} (PM2.5: ${airQuality.pm2_5} µg/m³, PM10: ${airQuality.pm10} µg/m³).`
      : `Air quality data for ${name} is unavailable right now.`;
  } else if (topic === "flood") {
    answer = flood
      ? `River discharge near ${name} is projected at ${flood.river_discharge_m3s} m³/s.${flood.is_elevated ? ' Caution: elevated river water levels detected.' : ' Flow levels remain within normal seasonal bounds.'}`
      : `Flood/river discharge data for ${name} is unavailable right now.`;
  } else if (topic === "spray") {
    answer = flags.spray_safe
      ? `Spraying pesticides in ${name} ${dayLabel} is suitable. Winds remain calm at ${dayData.wind_max_kmh} km/h with low rain probability (${dayData.rain_prob}%).`
      : `Spraying pesticides in ${name} ${dayLabel} is not advisable due to: ${flags.reason.join(', ')}.`;
  } else if (topic === "irrigation") {
    answer = flags.irrigate
      ? `Irrigation is recommended in ${name}. Only ${flags.rain_next_2_days_mm} mm rain is expected in the next 2 days with ${flags.et0_mm} mm evapotranspiration.`
      : `Irrigation is not needed in ${name}. Substantial rain (${flags.rain_next_2_days_mm} mm) is expected in the next 2 days.`;
  } else if (topic === "harvest") {
    answer = flags.harvest_ok
      ? `Harvesting in ${name} is suitable over the next 48 hours with dry weather expected.`
      : `Harvesting in ${name} is not advisable due to expected rain in the next 48 hours (${flags.rain_next_2_days_mm} mm).`;
  } else {
    const uvText = dayData.uv_index != null ? `, max UV index ${dayData.uv_index}` : "";
    const extraBits = [];
    if (requested.humidity) extraBits.push(`humidity around ${requested.humidity.mean_percent}%`);
    if (requested.wind_gusts) extraBits.push(`gusts up to ${requested.wind_gusts.max_kmh} km/h`);
    const extraText = extraBits.length ? ` ${extraBits.join(', ')}.` : "";
    answer = `${name} forecast for ${dayLabel} (${dayData.date}): temperatures ${dayData.temp_min}°C to ${dayData.temp_max}°C, ${dayData.rain_mm} mm rain (${dayData.rain_prob}% chance), max winds ${dayData.wind_max_kmh} km/h${uvText}.${extraText}`;
  }

  const facts = {
    topic,
    location: label,
    lat, lon,
    stale: false,
    current: currentConditions,
    day: dayData,
    daily: daily.length ? daily : undefined,
    requested: Object.keys(requested).length ? requested : undefined,
    air_quality: airQuality || undefined,
    flood: flood || undefined,
    flags: flags || undefined,
    marine: factsMarine || undefined,
    model_comparison: modelComparison || undefined,
    alerts
  };

  // Gemini narration (optional): explains the deterministic `facts`/`flags`
  // above in the user's language. Never allowed to override the decision -
  // if it's unavailable, times out, or its phrasing contains a number the
  // guard can't trace back to `facts`, fall back to the deterministic
  // template answer already built.
  const narrated = await narrateWithGemini(facts, q, lang);
  if (narrated) answer = narrated;

  return {
    answer,
    facts,
    alerts,
    meta: {
      source: "Open-Meteo Live API",
      fetched_at: now,
      from_cache: false,
      stale: false,
      latency_ms: Date.now() - t0,
      context: { location: label, topic, date: dateHint }
    }
  };
}

const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // 1. Health Endpoint
  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString(), service: 'AeroCast Local Server' }));
    return;
  }

  // 2. Chat Endpoint (Live Local / Fallback API)
  if (pathname === '/api/chat' && req.method === 'POST') {
    try {
      const payload = await parseJsonBody(req);
      const response = await handleLocalChat(payload);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
    }
    return;
  }

  // 3. Static Files from frontend/
  let reqPath = pathname;
  if (reqPath === '/' || reqPath === '') reqPath = '/landing.html';

  const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(FRONTEND_DIR, safePath);

  // Prevent directory traversal
  if (!filePath.startsWith(FRONTEND_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // SPA Fallback to index.html if route not found
      const fallbackPath = path.join(FRONTEND_DIR, 'index.html');
      fs.readFile(fallbackPath, (fbErr, fbData) => {
        if (fbErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        } else {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          });
          res.end(fbData);
        }
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

function startServer(port) {
  server.listen(port, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`  🌾 AeroCast / WeatherGPT Local Server is Active!`);
    console.log(`======================================================`);
    console.log(`  ➜ Local:   http://localhost:${port}/`);
    console.log(`  ➜ Network: http://127.0.0.1:${port}/`);
    console.log(`  ➜ Health:  http://localhost:${port}/api/health`);
    console.log(`  ➜ Mode:    Static Frontend + Live Weather Engine (/api/chat)`);
    console.log(`======================================================\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} in use, trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

// Only auto-start the HTTP server when this file is run directly (`node
// server.mjs` / `npm start`), not when it's imported by a test harness that
// wants to call handleLocalChat() in isolation.
if (process.argv[1] === __filename) {
  startServer(PORT);
}

export { handleLocalChat };
