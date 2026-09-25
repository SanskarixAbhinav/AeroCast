// Unit tests for WeatherGPT backend logic
import assert from "node:assert";

// 1. Guard & NumbersOk
const COMMON = new Set([0, 1, 2, 3, 4, 5, 6, 7, 12, 24, 48]);
const ZEROS = [0x0966, 0x09E6, 0x0BE6, 0x0C66];
const toAscii = (s) =>
  s.replace(/[\u0966-\u096F\u09E6-\u09EF\u0BE6-\u0BEF\u0C66-\u0C6F]/g, (c) => {
    const code = c.charCodeAt(0);
    return String(code - ZEROS.find((z) => code >= z && code < z + 10));
  });

function numbersOk(answer, facts) {
  const allowed = new Set(COMMON);
  for (const m of JSON.stringify(facts).match(/-?\d+(?:\.\d+)?/g) ?? []) {
    const n = Number(m);
    for (const v of [n, Math.abs(n), Math.round(n), Math.round(n * 10) / 10]) allowed.add(v);
  }
  for (const m of toAscii(answer).match(/\d+(?:\.\d+)?/g) ?? []) {
    if (!allowed.has(Number(m))) return false;
  }
  return true;
}

function templateAnswer(f) {
  const parts = [];
  if (f.history) {
    parts.push(
      `${f.location}, ${f.history.start} to ${f.history.end}: total rain ${f.history.total_rain_mm} mm, average maximum temperature ${f.history.avg_temp_max} C.`,
    );
  } else if (f.day) {
    parts.push(
      `${f.location} on ${f.day.date}: ${f.day.temp_min} to ${f.day.temp_max} C, rain ${f.day.rain_mm} mm (${f.day.rain_prob ?? "unknown"}% chance), wind up to ${f.day.wind_max_kmh} km/h.`,
    );
  }
  if (f.flags) {
    const why = (f.flags.reason ?? []).join(", ");
    if (f.flags.spray_safe === true) parts.push("Spraying: conditions are suitable.");
    else if (f.flags.spray_safe === false) parts.push(`Spraying: not advisable (${why}).`);
    if (f.flags.harvest_ok === true) parts.push("Harvesting: conditions are suitable.");
    else if (f.flags.harvest_ok === false) parts.push(`Harvesting: not advisable (${why}).`);
    if (f.flags.irrigate === true) parts.push(`Irrigation: recommended (${why}).`);
    else if (f.flags.irrigate === false) parts.push(`Irrigation: not needed (${why}).`);
  }
  for (const a of f.alerts ?? []) parts.push(`${a.simulated ? "[SIMULATED] " : ""}${a.message}`);
  if (f.stale) parts.push("Note: this data may be slightly out of date.");
  return parts.join(" ") || "Weather data is unavailable right now.";
}

// 2. Dates
function resolveIndex(hint, rows) {
  const h = (hint ?? "today").trim();
  if (!h || h === "today") return 0;
  if (h === "tomorrow") return 1;
  if (h === "day_after") return 2;
  return rows.findIndex((r) => r.date === h);
}

function clampHistory(start, end) {
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  if (!start || !end || !ISO.test(start) || !ISO.test(end)) return null;
  const latest = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
  const e = end > latest ? latest : end;
  if (start > e || start < "1940-01-01") return null;
  if ((Date.parse(e) - Date.parse(start)) / 864e5 > 366) return null;
  return { start, end: e };
}

// 3. Advisories
const RULES = {
  spray: { maxWindKmh: 15, maxRainProb: 30, maxTempC: 35 },
  irrigation: { skipIfRain2dMm: 5, highEt0Mm: 5 },
  harvest: { maxRain2dMm: 2, maxRainProb: 40 },
};

function advise(topic, rows, i, hours) {
  const next = rows[i + 1];
  const rain2d = Math.round(((rows[i].rain_mm ?? 0) + (next?.rain_mm ?? 0)) * 10) / 10;
  const prob2d = Math.max(rows[i].rain_prob ?? 0, next?.rain_prob ?? 0);

  if (topic === "spray") {
    const R = RULES.spray;
    if (!hours.length) return { spray_safe: null, reason: ["hourly data unavailable"] };
    const maxProb = Math.max(...hours.map((h) => h.rain_prob ?? 0));
    const maxWind = Math.max(...hours.map((h) => h.wind_kmh ?? 0));
    const maxTemp = Math.max(...hours.map((h) => h.temp_c ?? -99));
    const reason = [];
    if (maxProb >= R.maxRainProb) reason.push("rain likely");
    if (maxWind >= R.maxWindKmh) reason.push(`wind>${R.maxWindKmh}`);
    if (maxTemp >= R.maxTempC) reason.push(`temp>${R.maxTempC}`);
    return {
      spray_safe: reason.length === 0,
      reason,
      window: `${hours[0].time} to ${hours[hours.length - 1].time}`,
      max_rain_prob: maxProb,
      max_wind_kmh: maxWind,
      max_temp_c: maxTemp,
    };
  }

  if (topic === "irrigation") {
    const R = RULES.irrigation;
    const et0 = rows[i].et0_mm;
    const irrigate = rain2d < R.skipIfRain2dMm;
    const reason = [irrigate ? "little rain expected in next 2 days" : "enough rain expected in next 2 days"];
    if (irrigate && et0 != null && et0 >= R.highEt0Mm) reason.push("high evaporation");
    return { irrigate, reason, rain_next_2_days_mm: rain2d, et0_mm: et0 };
  }

  if (topic === "harvest") {
    const R = RULES.harvest;
    const reason = [];
    if (rain2d >= R.maxRain2dMm) reason.push("rain expected");
    if (prob2d >= R.maxRainProb) reason.push("high rain chance");
    return { harvest_ok: reason.length === 0, reason, rain_next_2_days_mm: rain2d, max_rain_prob: prob2d };
  }

  return null;
}

// 4. Alerts
const THRESHOLDS = {
  heavyRainMm: 64.5,
  veryHeavyRainMm: 115.6,
  heatwaveC: 40,
  extremeHeatC: 45,
  gustYellowKmh: 50,
  gustOrangeKmh: 70,
};

function computeAlerts(rows) {
  const T = THRESHOLDS;
  const out = [];
  for (const r of rows) {
    if (r.rain_mm >= T.veryHeavyRainMm) out.push({ type: "very_heavy_rain", level: "red", date: r.date, message: `Very heavy rain expected (${r.rain_mm} mm).` });
    else if (r.rain_mm >= T.heavyRainMm) out.push({ type: "heavy_rain", level: "orange", date: r.date, message: `Heavy rain expected (${r.rain_mm} mm).` });

    if (r.temp_max >= T.extremeHeatC) out.push({ type: "heatwave", level: "red", date: r.date, message: `Extreme heat expected (max ${r.temp_max} C).` });
    else if (r.temp_max >= T.heatwaveC) out.push({ type: "heatwave", level: "orange", date: r.date, message: `Heatwave conditions expected (max ${r.temp_max} C).` });

    if (r.gust_max_kmh >= T.gustOrangeKmh) out.push({ type: "strong_wind", level: "orange", date: r.date, message: `Very strong wind gusts expected (${r.gust_max_kmh} km/h).` });
    else if (r.gust_max_kmh >= T.gustYellowKmh) out.push({ type: "strong_wind", level: "yellow", date: r.date, message: `Strong wind gusts expected (${r.gust_max_kmh} km/h).` });
  }
  return out;
}

// Run test suite
console.log("Running unit tests...");

// Test 1: Guard checks
const factsSample = {
  location: "Kolkata, West Bengal, India",
  day: {
    date: "2026-09-26",
    temp_max: 33.2,
    temp_min: 26.5,
    rain_mm: 5.4,
    rain_prob: 60,
    wind_max_kmh: 12.0,
    gust_max_kmh: 22.1,
    et0_mm: 4.1,
  },
};

// Supported numbers should pass
assert.strictEqual(numbersOk("In Kolkata, temperature will reach 33.2 C and rain probability is 60%.", factsSample), true);

// Hallucinated number (e.g. 99) should fail
assert.strictEqual(numbersOk("In Kolkata, temperature will reach 99 C.", factsSample), false);

// Common numbers (0, 1, 2, 7, 12, etc.) should pass
assert.strictEqual(numbersOk("In the next 24 hours, expect rain.", factsSample), true);

// Template answer should always pass numbers guard
const tmpl = templateAnswer(factsSample);
assert.strictEqual(numbersOk(tmpl, factsSample), true);
console.log("✔ Numbers guard passed");

// Test 2: Date resolution
const mockRows = [{ date: "2026-09-25" }, { date: "2026-09-26" }, { date: "2026-09-27" }];
assert.strictEqual(resolveIndex("today", mockRows), 0);
assert.strictEqual(resolveIndex("tomorrow", mockRows), 1);
assert.strictEqual(resolveIndex("day_after", mockRows), 2);
assert.strictEqual(resolveIndex("2026-09-27", mockRows), 2);
assert.strictEqual(resolveIndex("2026-10-15", mockRows), -1);
console.log("✔ Date resolution passed");

// Test 3: History clamping
assert.strictEqual(clampHistory("invalid", "2026-01-01"), null);
assert.strictEqual(clampHistory("1930-01-01", "1931-01-01"), null); // pre-1940
const clamped = clampHistory("2025-01-01", "2025-01-10");
assert.deepStrictEqual(clamped, { start: "2025-01-01", end: "2025-01-10" });
console.log("✔ History clamp passed");

// Test 4: Advisory rules
const hoursOk = [
  { time: "2026-09-25T06:00", rain_prob: 10, wind_kmh: 8, temp_c: 28 },
  { time: "2026-09-25T07:00", rain_prob: 15, wind_kmh: 10, temp_c: 30 },
];
const sprayDecision = advise("spray", mockRows.map(r => ({ ...r, rain_mm: 0 })), 0, hoursOk);
assert.strictEqual(sprayDecision.spray_safe, true);

const hoursHighWind = [
  { time: "2026-09-25T06:00", rain_prob: 10, wind_kmh: 22, temp_c: 28 },
];
const sprayWindDecision = advise("spray", mockRows.map(r => ({ ...r, rain_mm: 0 })), 0, hoursHighWind);
assert.strictEqual(sprayWindDecision.spray_safe, false);
assert.ok(sprayWindDecision.reason.some(r => r.includes("wind")));
console.log("✔ Advisory rules passed");

// Test 5: Alert thresholds
const normalRow = { date: "2026-09-25", rain_mm: 10, temp_max: 32, gust_max_kmh: 30 };
assert.strictEqual(computeAlerts([normalRow]).length, 0);

const extremeRow = { date: "2026-09-25", rain_mm: 120, temp_max: 46, gust_max_kmh: 75 };
const alerts = computeAlerts([extremeRow]);
assert.strictEqual(alerts.length, 3);
assert.ok(alerts.some(a => a.type === "very_heavy_rain" && a.level === "red"));
assert.ok(alerts.some(a => a.type === "heatwave" && a.level === "red"));
assert.ok(alerts.some(a => a.type === "strong_wind" && a.level === "orange"));
console.log("✔ Alerts computation passed");

console.log("ALL UNIT TESTS PASSED SUCCESSFULLY! 🎉");
