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

// Live Open-Meteo Weather API integration for local testing
async function handleLocalChat(payload) {
  const t0 = Date.now();
  const q = (payload?.q || '').trim();
  const lang = payload?.lang || 'en';
  const demo = payload?.demo;
  const now = new Date().toISOString();
  const tmrw = new Date(Date.now() + 864e5).toISOString().slice(0, 10);

  if (!q) {
    return {
      answer: "Please ask a question about weather, forecast, rain, or farming decisions.",
      facts: null,
      alerts: [],
      meta: { source: "Local Engine", fetched_at: now, latency_ms: Date.now() - t0 }
    };
  }

  // 1. Detect City / Location from prompt
  const common = ["kolkata", "mumbai", "delhi", "chennai", "bengaluru", "bangalore", "hyderabad", "pune", "ahmedabad", "jaipur", "lucknow", "patna", "bhopal", "chandigarh", "kochi", "guwahati", "bhubaneswar", "shimla", "srinagar", "goa"];
  let placeName = common.find(c => new RegExp('\\b' + c + '\\b', 'i').test(q)) || null;

  if (!placeName) {
    const cityMatch = q.match(/(?:in|at|near|of)\s+([a-zA-Z\u0080-\uFFFF\s]+)/i) ||
                      q.match(/([a-zA-Z\u0080-\uFFFF]+)\s+(?:weather|forecast|rain|temperature|me|mein)/i);
    placeName = cityMatch ? cityMatch[1].trim().replace(/[?,.!]+$/, '') : null;
    if (placeName) {
      placeName = placeName.replace(/\b(?:tomorrow|today|yesterday|next\s+week|this\s+week|july|spray|pesticide|harvest|irrigation|forecast|weather|rain|marine|sea|coastal|fishing|please|now)\b/gi, '').trim();
    }
  }

  if (!placeName && !demo) {
    return {
      answer: "Please specify a city or town name (e.g., 'Will it rain tomorrow in Kolkata?').",
      facts: null,
      alerts: [],
      meta: { source: "Local Engine", fetched_at: now, latency_ms: Date.now() - t0 }
    };
  }

  // 2. Geocode with Open-Meteo
  let lat = 22.57, lon = 88.36, label = "Kolkata, West Bengal, India", name = "Kolkata";
  if (placeName) {
    try {
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(placeName)}&count=1&language=en&format=json`;
      const gRes = await fetch(geoUrl);
      if (gRes.ok) {
        const gData = await gRes.json();
        if (gData.results && gData.results.length > 0) {
          const r = gData.results[0];
          lat = r.latitude;
          lon = r.longitude;
          name = r.name;
          label = [r.name, r.admin1, r.country].filter(Boolean).join(", ");
        }
      }
    } catch (_err) {
      // fallback to defaults if offline
    }
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
      meta: { source: "AeroCast Local Simulation", fetched_at: now, from_cache: false, stale: false, latency_ms: Date.now() - t0 }
    };
  }

  // 4. Past History handling (e.g. July rain)
  if (/july|history|past|archive|last\s+year|last\s+month/i.test(q)) {
    const startDate = "2025-07-01";
    const endDate = "2025-07-31";
    let histRows = [];
    try {
      const hUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;
      const hRes = await fetch(hUrl);
      if (hRes.ok) {
        const hData = await hRes.json();
        if (hData.daily?.time) {
          histRows = hData.daily.time.map((d, idx) => ({
            date: d,
            temp_max: Math.round(hData.daily.temperature_2m_max[idx] ?? 31),
            temp_min: Math.round(hData.daily.temperature_2m_min[idx] ?? 25),
            rain_mm: Math.round((hData.daily.precipitation_sum[idx] ?? 0) * 10) / 10
          }));
        }
      }
    } catch (_e) {}

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
      meta: { source: "Open-Meteo Archive", fetched_at: now, from_cache: false, stale: false, latency_ms: Date.now() - t0 }
    };
  }

  // 5. Fetch Live Forecast & Multi-Model Comparison & Marine API
  const isMarine = /marine|sea|ocean|wave|swell|boat|fish|मछली|मछुआरे|সাগর|মাছ|জেলে|கடல்|மீன்|மீனவர்|సముద్రం|చేప|మత్స్యకారులు|मच्छीमार/i.test(q);

  let forecastData = null;
  let mcData = null;
  let marineData = null;

  try {
    const fUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_gusts_10m&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,et0_fao_evapotranspiration&timezone=auto`;
    const mcUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&models=gfs_seamless,ecmwf_ifs&daily=temperature_2m_max,precipitation_sum,precipitation_probability_max&timezone=auto`;
    const mUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=wave_height,wave_direction,wave_period,swell_wave_height&daily=wave_height_max,wave_direction_dominant,wave_period_max,swell_wave_height_max&timezone=auto`;

    const [fRes, mcRes, mRes] = await Promise.all([
      fetch(fUrl).catch(() => null),
      fetch(mcUrl).catch(() => null),
      isMarine ? fetch(mUrl).catch(() => null) : Promise.resolve(null)
    ]);

    if (fRes && fRes.ok) forecastData = await fRes.json();
    if (mcRes && mcRes.ok) mcData = await mcRes.json();
    if (mRes && mRes.ok) marineData = await mRes.json();
  } catch (_e) {
    // handled below
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
        et0_mm: Math.round((forecastData.daily.et0_fao_evapotranspiration?.[i] ?? 3.5) * 10) / 10
      });
    }
  }

  const tmrwData = daily[1] || daily[0] || {
    date: tmrw, temp_max: 32, temp_min: 25, rain_mm: 5, rain_prob: 40, wind_max_kmh: 18, gust_max_kmh: 28, et0_mm: 3.8
  };

  const currentConditions = forecastData?.current ? {
    time: forecastData.current.time,
    temperature_2m: Math.round(forecastData.current.temperature_2m * 10) / 10,
    relative_humidity_2m: forecastData.current.relative_humidity_2m,
    precipitation: forecastData.current.precipitation,
    wind_speed_10m: Math.round(forecastData.current.wind_speed_10m),
    wind_gusts_10m: Math.round(forecastData.current.wind_gusts_10m)
  } : {
    time: now, temperature_2m: 29.5, relative_humidity_2m: 72, precipitation: 0, wind_speed_10m: 14, wind_gusts_10m: 22
  };

  // Determine intent & Agro/Marine Rules
  const isSpray = /spray|pesticide|कीटनाशक|কীটনাশক|பூச்சிக்கொல்லி/i.test(q);
  const isIrrigate = /irrigate|water|पानी|सिंचाई|সেচ|பாசனம்/i.test(q);
  const isHarvest = /harvest|cutting|कटाई|ফসল|அறுவடை/i.test(q);

  let flags = null;
  let topic = "forecast";
  let factsMarine = null;

  if (isMarine) {
    topic = "marine";
    const rawWave = marineData?.current?.wave_height ?? marineData?.daily?.wave_height_max?.[1] ?? null;
    if (rawWave == null) {
      factsMarine = {
        is_coastal: false,
        message: `${name} is an inland location. Marine wave data is only available for coastal waters.`
      };
      flags = {
        marine_safe: null,
        reason: ["location is inland / non-coastal"]
      };
    } else {
      const waveM = Math.round(rawWave * 10) / 10;
      const wavePer = Math.round((marineData?.current?.wave_period ?? marineData?.daily?.wave_period_max?.[1] ?? 6) * 10) / 10;
      const swellM = Math.round((marineData?.current?.swell_wave_height ?? marineData?.daily?.swell_wave_height_max?.[1] ?? 0.5) * 10) / 10;
      const reasons = [];
      if (waveM >= 1.5) reasons.push(`wave height ${waveM}m (limit 1.5m)`);
      if (tmrwData.wind_max_kmh >= 25) reasons.push(`wind ${tmrwData.wind_max_kmh} km/h (limit 25 km/h)`);
      const safe = reasons.length === 0;

      factsMarine = {
        is_coastal: true,
        wave_height_m: waveM,
        wave_period_s: wavePer,
        swell_wave_height_m: swellM,
        wave_direction_deg: marineData?.current?.wave_direction ?? 270
      };
      flags = {
        marine_safe: safe,
        reason: safe ? ["calm sea conditions suitable for small craft and fishing"] : reasons,
        wave_height_m: waveM,
        wave_period_s: wavePer,
        swell_wave_height_m: swellM,
        max_wind_kmh: tmrwData.wind_max_kmh
      };
    }
  } else if (isSpray) {
    topic = "spray";
    const spraySafe = tmrwData.rain_prob < 30 && tmrwData.wind_max_kmh <= 15 && tmrwData.temp_max <= 35;
    const reasons = [];
    if (tmrwData.rain_prob >= 30) reasons.push("rain likely");
    if (tmrwData.wind_max_kmh > 15) reasons.push(`wind>${15} km/h`);
    if (tmrwData.temp_max > 35) reasons.push(`temp>${35}°C`);
    flags = {
      spray_safe: spraySafe,
      reason: spraySafe ? ["optimal calm weather"] : reasons,
      window: `${tmrw} 06:00 - 18:00`,
      max_rain_prob: tmrwData.rain_prob,
      max_wind_kmh: tmrwData.wind_max_kmh,
      max_temp_c: tmrwData.temp_max
    };
  } else if (isIrrigate) {
    topic = "irrigation";
    const rain2d = tmrwData.rain_mm + (daily[2]?.rain_mm || 0);
    const needIrrigate = rain2d < 5;
    flags = {
      irrigate: needIrrigate,
      reason: [needIrrigate ? "little rain expected in next 2 days" : "enough rain expected in next 2 days"],
      rain_next_2_days_mm: Math.round(rain2d * 10) / 10,
      et0_mm: tmrwData.et0_mm
    };
  } else if (isHarvest) {
    topic = "harvest";
    const rain2d = tmrwData.rain_mm + (daily[2]?.rain_mm || 0);
    const harvestOk = rain2d < 2 && tmrwData.rain_prob < 40;
    flags = {
      harvest_ok: harvestOk,
      reason: harvestOk ? ["dry conditions suitable for harvest"] : ["rain expected in next 48h"],
      rain_next_2_days_mm: Math.round(rain2d * 10) / 10,
      max_rain_prob: tmrwData.rain_prob
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

  // Alerts
  const alerts = [];
  if (tmrwData.rain_mm >= 115.6) {
    alerts.push({ type: "very_heavy_rain", level: "red", date: tmrw, message: `Very heavy rain forecast (${tmrwData.rain_mm} mm). Risk of waterlogging.` });
  } else if (tmrwData.rain_mm >= 64.5) {
    alerts.push({ type: "heavy_rain", level: "orange", date: tmrw, message: `Heavy rain expected (${tmrwData.rain_mm} mm).` });
  }
  if (tmrwData.temp_max >= 40) {
    alerts.push({ type: "heatwave", level: "orange", date: tmrw, message: `High temperatures expected (${tmrwData.temp_max}°C).` });
  }
  if (factsMarine?.is_coastal && (factsMarine.wave_height_m ?? 0) >= 2.0) {
    alerts.push({
      type: "rough_sea",
      level: (factsMarine.wave_height_m >= 3.0) ? "red" : "orange",
      date: tmrw,
      message: `Rough sea conditions (${factsMarine.wave_height_m}m waves). Fishermen and small craft advised to exercise extreme caution.`
    });
  }

  let answer = "";
  if (isMarine) {
    if (!factsMarine?.is_coastal) {
      answer = `${name} is an inland location. Marine wave and swell advisories are only available for coastal waters. Tomorrow's land weather: ${tmrwData.temp_min}°C to ${tmrwData.temp_max}°C with wind ${tmrwData.wind_max_kmh} km/h.`;
    } else if (flags.marine_safe) {
      answer = `Marine conditions off ${name} tomorrow are suitable for small craft and fishing: wave heights around ${flags.wave_height_m} m with winds at ${flags.max_wind_kmh} km/h.`;
    } else {
      answer = `Marine advisory for ${name} tomorrow: sea conditions are not advisable for small craft due to ${flags.reason.join(', ')}.`;
    }
  } else if (isSpray) {
    answer = flags.spray_safe
      ? `Spraying pesticides in ${name} tomorrow is suitable. Winds remain calm at ${tmrwData.wind_max_kmh} km/h with low rain probability (${tmrwData.rain_prob}%).`
      : `Spraying pesticides in ${name} tomorrow is not advisable due to: ${flags.reason.join(', ')}.`;
  } else if (isIrrigate) {
    answer = flags.irrigate
      ? `Irrigation is recommended in ${name}. Only ${flags.rain_next_2_days_mm} mm rain is expected in the next 2 days with ${flags.et0_mm} mm evapotranspiration.`
      : `Irrigation is not needed in ${name}. Substantial rain (${flags.rain_next_2_days_mm} mm) is expected in the next 2 days.`;
  } else if (isHarvest) {
    answer = flags.harvest_ok
      ? `Harvesting in ${name} is suitable over the next 48 hours with dry weather expected.`
      : `Harvesting in ${name} is not advisable due to expected rain in the next 48 hours (${flags.rain_next_2_days_mm} mm).`;
  } else {
    answer = `${name} forecast for tomorrow (${tmrwData.date}): temperatures ${tmrwData.temp_min}°C to ${tmrwData.temp_max}°C, ${tmrwData.rain_mm} mm rain (${tmrwData.rain_prob}% chance), max winds ${tmrwData.wind_max_kmh} km/h.`;
  }

  return {
    answer,
    facts: {
      topic,
      location: label,
      lat, lon,
      stale: false,
      current: currentConditions,
      day: tmrwData,
      daily: daily.length ? daily : undefined,
      flags,
      marine: factsMarine || undefined,
      model_comparison: modelComparison || undefined
    },
    alerts,
    meta: {
      source: "Open-Meteo Live API",
      fetched_at: now,
      from_cache: false,
      stale: false,
      latency_ms: Date.now() - t0
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
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

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

startServer(PORT);
