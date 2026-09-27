// Unit tests for multi-variable weather-question support:
//   - llm.ts: WEATHER_VARS / detectNeeds() (the offline fallback for `needs`)
//   - weather.ts: dailyRows()'s new fields, weatherCodeText(), dayAggregates()
//   - chat/index.ts: building facts.requested from intent.needs (several
//     variables from ONE question, never just a single `topic` string)
//   - guard.ts: templateAnswer()'s new facts.requested sentence
//
// These modules are Deno TypeScript (llm.ts also calls the network Gemini
// API), so — same pattern as the other offline tests in this folder — the
// pieces that matter are faithfully re-implemented here and exercised
// against mock Open-Meteo-shaped data, fully offline.
import assert from "node:assert";

const WEATHER_VARS = [
  "temperature", "apparent_temperature", "precipitation", "precipitation_probability",
  "rain", "humidity", "wind_speed", "wind_gusts", "cloud_cover", "visibility",
  "uv_index", "sunrise", "sunset", "weather_condition",
];

function detectNeeds(qLower) {
  const found = [];
  const add = (v) => { if (!found.includes(v)) found.push(v); };
  if (/feels like|apparent temperature|real feel|heat index/.test(qLower)) add("apparent_temperature");
  if (/\btemp(erature)?\b|\bhot\b|\bcold\b|\bheat\b|\bwarm\b/.test(qLower)) add("temperature");
  if (/precipitation probability|chance of rain|rain chance|probability of rain/.test(qLower)) add("precipitation_probability");
  if (/\bprecipitation\b/.test(qLower)) add("precipitation");
  if (/\brain(ing|fall)?\b|shower|drizzle|barish/.test(qLower)) add("rain");
  if (/\bhumid(ity)?\b|moisture/.test(qLower)) add("humidity");
  if (/\bgust/.test(qLower)) add("wind_gusts");
  if (/\bwind\b|breeze/.test(qLower)) add("wind_speed");
  if (/\bcloud/.test(qLower)) add("cloud_cover");
  if (/visibility|\bfog\b|\bmist\b/.test(qLower)) add("visibility");
  if (/\buv\b|uv index|sunburn/.test(qLower)) add("uv_index");
  if (/sunrise/.test(qLower)) add("sunrise");
  if (/sunset/.test(qLower)) add("sunset");
  if (/weather condition|\bcondition\b|\bsunny\b|\bcloudy\b|clear sky|overcast/.test(qLower)) add("weather_condition");
  return found;
}

console.log("Running multi-variable weather-question tests...");

// ---------------------------------------------------------------------
// 1. detectNeeds(): a single question can name several variables at once -
//    this is the core requirement (no single `topic = "rain"` bottleneck).
// ---------------------------------------------------------------------
{
  const needs = detectNeeds("what will the temperature, humidity and wind be tomorrow in delhi?");
  assert.deepStrictEqual(needs, ["temperature", "humidity", "wind_speed"]);
}
{
  const needs = detectNeeds("will it rain tomorrow in kolkata?");
  assert.deepStrictEqual(needs, ["rain"]);
}
{
  const needs = detectNeeds("what's the uv index and sunset time in chennai today?");
  assert.deepStrictEqual(needs, ["uv_index", "sunset"]);
}
{
  // Note: "wind gusts" also contains the standalone word "wind", so the
  // offline heuristic (a coarse fallback - see llm.ts) reasonably detects
  // wind_speed too; Gemini (the primary extraction path) disambiguates this
  // semantically instead of by keyword.
  const needs = detectNeeds("give me cloud cover, visibility and wind gusts for mumbai");
  assert.deepStrictEqual(needs, ["wind_gusts", "wind_speed", "cloud_cover", "visibility"]);
}
{
  // A general/forecast-only question names no specific variable.
  const needs = detectNeeds("what's the weather like in pune this week?");
  assert.deepStrictEqual(needs, []);
}
{
  // Every supported variable, all in one sentence.
  const q =
    "tell me the temperature, feels like temperature, precipitation, chance of rain, rain, humidity, " +
    "wind speed, wind gusts, cloud cover, visibility, uv index, sunrise, sunset and weather condition for jaipur";
  const needs = detectNeeds(q);
  for (const v of WEATHER_VARS) {
    assert.ok(needs.includes(v), `expected "${v}" to be detected in the all-variables question`);
  }
}
console.log("✔ detectNeeds() extracts multiple weather variables from one question, never just one");

// ---------------------------------------------------------------------
// 2. weather.ts additions: weatherCodeText() and the extended DailyRow
//    shape dailyRows() now produces (apparent temp, UV, sunrise/sunset,
//    weather code/text) straight from Open-Meteo's own daily fields.
// ---------------------------------------------------------------------
const WEATHER_CODE_TEXT = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
  95: "Thunderstorm",
};
function weatherCodeText(code) {
  if (code == null) return null;
  return WEATHER_CODE_TEXT[code] ?? "Unknown";
}
function round1(n) { return Math.round(n * 10) / 10; }

function dailyRows(fc) {
  const d = fc.daily;
  return d.time.map((date, i) => ({
    date,
    temp_max: d.temperature_2m_max[i],
    temp_min: d.temperature_2m_min[i],
    rain_mm: d.precipitation_sum[i] ?? 0,
    rain_prob: d.precipitation_probability_max?.[i] ?? null,
    wind_max_kmh: d.wind_speed_10m_max[i],
    gust_max_kmh: d.wind_gusts_10m_max[i],
    et0_mm: d.et0_fao_evapotranspiration?.[i] ?? null,
    apparent_temp_max: d.apparent_temperature_max?.[i] ?? null,
    apparent_temp_min: d.apparent_temperature_min?.[i] ?? null,
    uv_index_max: d.uv_index_max?.[i] ?? null,
    sunrise: d.sunrise?.[i] ?? null,
    sunset: d.sunset?.[i] ?? null,
    weather_code: d.weather_code?.[i] ?? null,
    weather_text: weatherCodeText(d.weather_code?.[i]),
  }));
}

function dayAggregates(fc, date) {
  const h = fc.hourly;
  const idx = [];
  for (let i = 0; i < (h?.time?.length ?? 0); i++) {
    if (h.time[i].startsWith(date)) idx.push(i);
  }
  const pick = (arr) => idx.map((i) => arr?.[i]).filter((v) => v != null);
  const avg = (a) => a.length ? round1(a.reduce((s, v) => s + v, 0) / a.length) : null;
  const humidity = pick(h?.relative_humidity_2m);
  const cloud = pick(h?.cloud_cover);
  const visibilityM = pick(h?.visibility);
  return {
    humidity_mean_pct: avg(humidity),
    humidity_max_pct: humidity.length ? Math.round(Math.max(...humidity)) : null,
    cloud_cover_mean_pct: avg(cloud),
    cloud_cover_max_pct: cloud.length ? Math.round(Math.max(...cloud)) : null,
    visibility_mean_km: visibilityM.length ? round1(visibilityM.reduce((s, v) => s + v, 0) / visibilityM.length / 1000) : null,
    visibility_min_km: visibilityM.length ? round1(Math.min(...visibilityM) / 1000) : null,
  };
}

// Mock a 2-day Open-Meteo /v1/forecast response shaped like the real API,
// hourly covering 00:00-23:00 on both days.
function mockForecast() {
  const hours = (date, humidity, cloud, visibility) => {
    const time = [], rh = [], cc = [], vis = [];
    for (let h = 0; h < 24; h++) {
      time.push(`${date}T${String(h).padStart(2, "0")}:00`);
      rh.push(humidity + (h % 3)); // small variation
      cc.push(cloud + (h % 5));
      vis.push(visibility - h * 50); // meters
    }
    return { time, rh, cc, vis };
  };
  const d0 = hours("2026-09-27", 60, 20, 20000);
  const d1 = hours("2026-09-28", 70, 40, 15000);
  return {
    daily: {
      time: ["2026-09-27", "2026-09-28"],
      temperature_2m_max: [33.2, 32.1],
      temperature_2m_min: [26.5, 25.9],
      apparent_temperature_max: [36.0, 35.2],
      apparent_temperature_min: [27.8, 27.1],
      precipitation_sum: [5.4, 12.1],
      precipitation_probability_max: [60, 80],
      wind_speed_10m_max: [12.0, 18.5],
      wind_gusts_10m_max: [22.1, 30.4],
      et0_fao_evapotranspiration: [4.1, 3.8],
      uv_index_max: [8.2, 6.5],
      sunrise: ["2026-09-27T05:52", "2026-09-28T05:52"],
      sunset: ["2026-09-27T17:58", "2026-09-28T17:57"],
      weather_code: [61, 3],
    },
    hourly: {
      time: [...d0.time, ...d1.time],
      relative_humidity_2m: [...d0.rh, ...d1.rh],
      cloud_cover: [...d0.cc, ...d1.cc],
      visibility: [...d0.vis, ...d1.vis],
    },
  };
}

{
  const fc = mockForecast();
  const rows = dailyRows(fc);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].apparent_temp_max, 36.0);
  assert.strictEqual(rows[0].uv_index_max, 8.2);
  assert.strictEqual(rows[0].sunrise, "2026-09-27T05:52");
  assert.strictEqual(rows[0].sunset, "2026-09-27T17:58");
  assert.strictEqual(rows[0].weather_code, 61);
  assert.strictEqual(rows[0].weather_text, "Slight rain");
  assert.strictEqual(rows[1].weather_text, "Overcast");
  console.log("✔ dailyRows() carries apparent temp / UV / sunrise / sunset / weather condition");

  const agg0 = dayAggregates(fc, rows[0].date);
  assert.ok(agg0.humidity_mean_pct > 0 && agg0.humidity_mean_pct < 100);
  assert.ok(agg0.cloud_cover_mean_pct >= 0);
  assert.ok(agg0.visibility_mean_km > 0);
  // Day 2 was set up with lower visibility / higher humidity & cloud than day 1.
  const agg1 = dayAggregates(fc, rows[1].date);
  assert.ok(agg1.humidity_mean_pct > agg0.humidity_mean_pct);
  assert.ok(agg1.visibility_mean_km < agg0.visibility_mean_km);
  console.log("✔ dayAggregates() rolls hourly humidity/cloud/visibility up to the requested day");
}

// ---------------------------------------------------------------------
// 3. chat/index.ts's facts.requested construction: given intent.needs with
//    SEVERAL variables from one question, every one of them ends up in
//    facts.requested with a real (not invented) value - this is the actual
//    "temperature, humidity and wind tomorrow in Delhi" scenario end to end.
// ---------------------------------------------------------------------
function buildRequested(needs, day, agg, tw) {
  const requested = {};
  for (const need of needs) {
    switch (need) {
      case "temperature":
        requested.temperature = tw
          ? { min_c: tw.temp_min, max_c: tw.temp_max }
          : { min_c: day.temp_min, max_c: day.temp_max };
        break;
      case "apparent_temperature":
        requested.apparent_temperature = { min_c: day.apparent_temp_min, max_c: day.apparent_temp_max };
        break;
      case "precipitation":
        requested.precipitation = { mm: day.rain_mm };
        break;
      case "rain":
        requested.rain = { mm: day.rain_mm };
        break;
      case "precipitation_probability":
        requested.precipitation_probability = { percent: tw ? tw.rain_prob_max : day.rain_prob };
        break;
      case "humidity":
        requested.humidity = { mean_percent: agg.humidity_mean_pct, max_percent: agg.humidity_max_pct };
        break;
      case "wind_speed":
        requested.wind_speed = { max_kmh: tw ? tw.wind_max_kmh : day.wind_max_kmh };
        break;
      case "wind_gusts":
        requested.wind_gusts = { max_kmh: day.gust_max_kmh };
        break;
      case "cloud_cover":
        requested.cloud_cover = { mean_percent: agg.cloud_cover_mean_pct, max_percent: agg.cloud_cover_max_pct };
        break;
      case "visibility":
        requested.visibility = { mean_km: agg.visibility_mean_km, min_km: agg.visibility_min_km };
        break;
      case "uv_index":
        requested.uv_index = { max: day.uv_index_max };
        break;
      case "sunrise":
        requested.sunrise = { time: day.sunrise };
        break;
      case "sunset":
        requested.sunset = { time: day.sunset };
        break;
      case "weather_condition":
        requested.weather_condition = { code: day.weather_code, text: day.weather_text };
        break;
    }
  }
  return requested;
}

{
  // "What will the temperature, humidity and wind be tomorrow in Delhi?"
  const fc = mockForecast();
  const rows = dailyRows(fc);
  const day = rows[1]; // "tomorrow" (index 1, per resolveIndex's own date math)
  const needs = detectNeeds("what will the temperature, humidity and wind be tomorrow in delhi?");
  const agg = dayAggregates(fc, day.date);
  const requested = buildRequested(needs, day, agg, undefined);

  assert.deepStrictEqual(Object.keys(requested).sort(), ["humidity", "temperature", "wind_speed"].sort());
  assert.strictEqual(requested.temperature.max_c, day.temp_max);
  assert.strictEqual(requested.temperature.min_c, day.temp_min);
  assert.strictEqual(requested.wind_speed.max_kmh, day.wind_max_kmh);
  assert.ok(requested.humidity.mean_percent > 0);
  // No topic-only bottleneck: three distinct variables came back from ONE
  // question, none of them discarded in favour of a single "topic" pick.
  console.log("✔ facts.requested carries all three variables from one multi-variable question (Delhi example)");
}

{
  // "What's the UV index and sunset time in Chennai today?"
  const fc = mockForecast();
  const rows = dailyRows(fc);
  const day = rows[0]; // "today"
  const needs = detectNeeds("what's the uv index and sunset time in chennai today?");
  const agg = dayAggregates(fc, day.date);
  const requested = buildRequested(needs, day, agg, undefined);

  assert.deepStrictEqual(Object.keys(requested).sort(), ["sunset", "uv_index"].sort());
  assert.strictEqual(requested.uv_index.max, day.uv_index_max);
  assert.strictEqual(requested.sunset.time, day.sunset);
  console.log("✔ facts.requested handles a non-numeric (sunset time) + numeric (UV) combination");
}

{
  // "Cloud cover, visibility and wind gusts for Mumbai" (no explicit date -> today)
  const fc = mockForecast();
  const rows = dailyRows(fc);
  const day = rows[0];
  const needs = detectNeeds("give me cloud cover, visibility and wind gusts for mumbai");
  const agg = dayAggregates(fc, day.date);
  const requested = buildRequested(needs, day, agg, undefined);

  assert.deepStrictEqual(Object.keys(requested).sort(), ["cloud_cover", "visibility", "wind_gusts", "wind_speed"].sort());
  assert.strictEqual(requested.wind_gusts.max_kmh, day.gust_max_kmh);
  assert.ok(requested.cloud_cover.mean_percent >= 0);
  assert.ok(requested.visibility.mean_km > 0);
  console.log("✔ facts.requested handles cloud cover / visibility / wind gusts together");
}

{
  // A time-of-day-scoped multi-variable question: when a time_window exists,
  // temperature/wind/precip-probability must come from the window, not the
  // full day.
  const fc = mockForecast();
  const rows = dailyRows(fc);
  const day = rows[1];
  const tw = { temp_min: 27.0, temp_max: 30.0, rain_prob_max: 75, wind_max_kmh: 20.0 };
  const needs = ["temperature", "wind_speed"];
  const agg = dayAggregates(fc, day.date);
  const requested = buildRequested(needs, day, agg, tw);
  assert.strictEqual(requested.temperature.max_c, tw.temp_max);
  assert.strictEqual(requested.wind_speed.max_kmh, tw.wind_max_kmh);
  console.log("✔ facts.requested prefers the narrower time_window over the full day when both exist");
}

// ---------------------------------------------------------------------
// 4. guard.ts templateAnswer(): the deterministic fallback must surface
//    facts.requested's non-day-summary variables if Gemini narration fails.
// ---------------------------------------------------------------------
function templateAnswer(f) {
  const parts = [];
  if (f.day) {
    parts.push(
      `${f.location} on ${f.day.date}: ${f.day.temp_min} to ${f.day.temp_max} C, rain ${f.day.rain_mm} mm (${f.day.rain_prob ?? "unknown"}% chance), wind up to ${f.day.wind_max_kmh} km/h.`,
    );
  }
  if (f.requested) {
    const r = f.requested;
    const bits = [];
    if (r.apparent_temperature) bits.push(`feels like ${r.apparent_temperature.min_c} to ${r.apparent_temperature.max_c} C`);
    if (r.humidity) bits.push(`humidity around ${r.humidity.mean_percent}%`);
    if (r.wind_gusts) bits.push(`gusts up to ${r.wind_gusts.max_kmh} km/h`);
    if (r.cloud_cover) bits.push(`cloud cover around ${r.cloud_cover.mean_percent}%`);
    if (r.visibility) bits.push(`visibility around ${r.visibility.mean_km} km`);
    if (r.uv_index) bits.push(`UV index ${r.uv_index.max}`);
    if (r.sunrise) bits.push(`sunrise ${r.sunrise.time}`);
    if (r.sunset) bits.push(`sunset ${r.sunset.time}`);
    if (r.weather_condition) bits.push(`condition: ${r.weather_condition.text}`);
    if (bits.length) parts.push(`${bits.join(", ")}.`);
  }
  return parts.join(" ") || "Weather data is unavailable right now.";
}

{
  const facts = {
    location: "Delhi, India",
    day: { date: "2026-09-28", temp_min: 25.9, temp_max: 32.1, rain_mm: 12.1, rain_prob: 80, wind_max_kmh: 18.5 },
    requested: {
      temperature: { min_c: 25.9, max_c: 32.1 },
      humidity: { mean_percent: 71.2, max_percent: 74 },
      wind_speed: { max_kmh: 18.5 },
    },
  };
  const answer = templateAnswer(facts);
  assert.ok(answer.includes("humidity around 71.2%"), "template must mention humidity when requested");
  assert.ok(!answer.includes("undefined"), "template must never print undefined for unrequested fields");
  console.log("✔ templateAnswer() surfaces requested variables (humidity) without Gemini");
}

console.log("ALL MULTI-VARIABLE WEATHER-QUESTION TESTS PASSED SUCCESSFULLY! 🎉");
