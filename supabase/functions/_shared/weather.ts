import { cacheGet, cacheSet } from "./db.ts";
import { background, fetchJson } from "./utils.ts";
import type { Place } from "./location.ts";

export const round1 = (n: number) => Math.round(n * 10) / 10;

export interface DailyRow {
  date: string;
  temp_max: number;
  temp_min: number;
  rain_mm: number;
  rain_prob: number | null;
  wind_max_kmh: number;
  gust_max_kmh: number;
  et0_mm: number | null;
  // Added to support multi-variable weather questions (temperature is no
  // longer the only thing a DailyRow can answer) - see llm.ts `needs`.
  apparent_temp_max: number | null;
  apparent_temp_min: number | null;
  uv_index_max: number | null;
  sunrise: string | null;
  sunset: string | null;
  weather_code: number | null;
  weather_text: string | null;
}

export interface HourRow {
  time: string;
  rain_prob: number | null;
  wind_kmh: number;
  temp_c: number;
}

export interface Fetched {
  // deno-lint-ignore no-explicit-any
  data: any;
  fetchedAt: string;
  fromCache: boolean;
  stale: boolean; // true = API failed and we served an old cached copy
}

const FORECAST_TTL_MS = 20 * 60 * 1000;
const HISTORY_TTL_MS = 24 * 3600 * 1000;

// Fresh cache -> API -> stale cache -> error.
async function cached(key: string, ttlMs: number, url: string): Promise<Fetched> {
  // deno-lint-ignore no-explicit-any
  const hit = await cacheGet<any>(key, ttlMs);
  if (hit?.fresh) return { data: hit.value, fetchedAt: hit.fetchedAt, fromCache: true, stale: false };
  try {
    const data = await fetchJson(url);
    // Don't make the caller wait for the cache write to land - the response
    // is already correct without it; the write just makes the *next* request
    // faster. Fire it in the background instead of awaiting it here.
    background(cacheSet(key, data));
    return { data, fetchedAt: new Date().toISOString(), fromCache: false, stale: false };
  } catch (_e) {
    if (hit) return { data: hit.value, fetchedAt: hit.fetchedAt, fromCache: true, stale: true };
    throw new Error("WEATHER_UNAVAILABLE");
  }
}

export function getForecast(p: Place): Promise<Fetched> {
  const q = new URLSearchParams({
    latitude: String(p.lat),
    longitude: String(p.lon),
    timezone: "auto",
    forecast_days: "7",
    // "current" additions (apparent_temperature, cloud_cover, weather_code)
    // and the new "daily"/"hourly" fields below exist to answer specific
    // weather-variable questions (humidity, UV, sunrise/sunset, condition,
    // cloud cover, visibility, "feels like") without adding a second API
    // call - Open-Meteo returns them all in this one forecast request.
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "precipitation",
      "wind_speed_10m",
      "wind_gusts_10m",
      "cloud_cover",
      "weather_code",
    ].join(","),
    daily: [
      "temperature_2m_max",
      "temperature_2m_min",
      "apparent_temperature_max",
      "apparent_temperature_min",
      "precipitation_sum",
      "precipitation_probability_max",
      "wind_speed_10m_max",
      "wind_gusts_10m_max",
      "et0_fao_evapotranspiration",
      "uv_index_max",
      "sunrise",
      "sunset",
      "weather_code",
    ].join(","),
    // Cloud cover, visibility, relative humidity and UV are only available
    // from Open-Meteo at hourly resolution (no daily aggregate exists for
    // them), so dayAggregates() below rolls these hourly values up to a
    // single day the same way timeWindowStats()/hourlyWindow() already do
    // for temperature/wind/rain.
    hourly: "precipitation_probability,wind_speed_10m,temperature_2m,relative_humidity_2m,cloud_cover,visibility,uv_index",
  });
  return cached(`fc:${p.lat.toFixed(2)},${p.lon.toFixed(2)}`, FORECAST_TTL_MS, `https://api.open-meteo.com/v1/forecast?${q}`);
}

export function getHistory(p: Place, start: string, end: string): Promise<Fetched> {
  const q = new URLSearchParams({
    latitude: String(p.lat),
    longitude: String(p.lon),
    timezone: "auto",
    start_date: start,
    end_date: end,
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum",
  });
  return cached(
    `hist:${p.lat.toFixed(2)},${p.lon.toFixed(2)}:${start}:${end}`,
    HISTORY_TTL_MS,
    `https://archive-api.open-meteo.com/v1/archive?${q}`,
  );
}

export function getMarine(p: Place): Promise<Fetched> {
  const q = new URLSearchParams({
    latitude: String(p.lat),
    longitude: String(p.lon),
    timezone: "auto",
    current: "wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period",
    daily: "wave_height_max,wave_direction_dominant,wave_period_max,swell_wave_height_max,swell_wave_direction_dominant",
  });
  return cached(
    `marine:${p.lat.toFixed(2)},${p.lon.toFixed(2)}`,
    FORECAST_TTL_MS,
    `https://marine-api.open-meteo.com/v1/marine?${q}`,
  );
}

export function getModelComparison(p: Place): Promise<Fetched> {
  const q = new URLSearchParams({
    latitude: String(p.lat),
    longitude: String(p.lon),
    timezone: "auto",
    models: "gfs_seamless,ecmwf_ifs",
    daily: "temperature_2m_max,precipitation_sum,precipitation_probability_max",
  });
  return cached(
    `mc:${p.lat.toFixed(2)},${p.lon.toFixed(2)}`,
    FORECAST_TTL_MS,
    `https://api.open-meteo.com/v1/forecast?${q}`,
  );
}

// deno-lint-ignore no-explicit-any
export function extractMarine(marineData: any, i = 0) {
  if (!marineData) return { is_coastal: false, message: "Marine data unavailable." };
  const d = marineData.daily;
  const c = marineData.current;
  const waveHeight = c?.wave_height ?? d?.wave_height_max?.[i] ?? null;
  if (waveHeight == null) {
    return {
      is_coastal: false,
      message: "Location is inland / non-coastal. Marine wave and swell data is only available for coastal waters.",
    };
  }
  return {
    is_coastal: true,
    wave_height_m: round1(waveHeight),
    wave_period_s: round1(c?.wave_period ?? d?.wave_period_max?.[i] ?? 0),
    wave_direction_deg: c?.wave_direction ?? d?.wave_direction_dominant?.[i] ?? null,
    swell_wave_height_m: round1(c?.swell_wave_height ?? d?.swell_wave_height_max?.[i] ?? 0),
    swell_wave_period_s: round1(c?.swell_wave_period ?? 0),
    swell_wave_direction_deg: c?.swell_wave_direction ?? null,
  };
}

// deno-lint-ignore no-explicit-any
export function extractModelComparison(mcData: any, i = 0) {
  if (!mcData?.daily) return null;
  const d = mcData.daily;
  const gfsTemp = d.temperature_2m_max_gfs_seamless?.[i];
  const gfsRain = d.precipitation_sum_gfs_seamless?.[i];
  const gfsProb = d.precipitation_probability_max_gfs_seamless?.[i];

  const ecmwfTemp = d.temperature_2m_max_ecmwf_ifs?.[i];
  const ecmwfRain = d.precipitation_sum_ecmwf_ifs?.[i];
  const ecmwfProb = d.precipitation_probability_max_ecmwf_ifs?.[i];

  if (gfsTemp == null && ecmwfTemp == null) return null;

  const date = d.time?.[i] ?? "";
  const tempDiff = (gfsTemp != null && ecmwfTemp != null) ? Math.abs(round1(gfsTemp - ecmwfTemp)) : null;
  const probDiff = (gfsProb != null && ecmwfProb != null) ? Math.abs(gfsProb - ecmwfProb) : null;
  const agree = (tempDiff !== null && tempDiff <= 2.5) && (probDiff === null || probDiff <= 25);

  return {
    date,
    gfs: {
      model_name: "NOAA GFS (Seamless)",
      temp_max: gfsTemp != null ? round1(gfsTemp) : null,
      rain_mm: gfsRain != null ? round1(gfsRain) : null,
      rain_prob: gfsProb ?? null,
    },
    ecmwf: {
      model_name: "ECMWF IFS",
      temp_max: ecmwfTemp != null ? round1(ecmwfTemp) : null,
      rain_mm: ecmwfRain != null ? round1(ecmwfRain) : null,
      rain_prob: ecmwfProb ?? null,
    },
    agreement: agree
      ? "High model consensus (GFS & ECMWF agree within 2.5°C / 25% rain prob)"
      : "Moderate spread between models — monitor for forecast shifts",
    agreement_bool: agree,
    note: "Two independent forecast models, shown for transparency",
  };
}

// Standard WMO weather-interpretation codes, as used by Open-Meteo's
// `weather_code` field (current/daily/hourly). Fixed lookup table, not a
// per-question pattern - the same table Open-Meteo documents for every user.
const WEATHER_CODE_TEXT: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow fall",
  73: "Moderate snow fall",
  75: "Heavy snow fall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

export function weatherCodeText(code: number | null | undefined): string | null {
  if (code == null) return null;
  return WEATHER_CODE_TEXT[code] ?? "Unknown";
}

// deno-lint-ignore no-explicit-any
export function dailyRows(fc: any): DailyRow[] {
  const d = fc.daily;
  return d.time.map((date: string, i: number) => ({
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

export interface DayAggregates {
  humidity_mean_pct: number | null;
  humidity_max_pct: number | null;
  cloud_cover_mean_pct: number | null;
  cloud_cover_max_pct: number | null;
  visibility_mean_km: number | null;
  visibility_min_km: number | null;
}

// Rolls the hourly arrays up to a single local calendar date, for weather
// variables Open-Meteo only exposes hourly (humidity, cloud cover,
// visibility) - same "hourly -> one day" idea as timeWindowStats()/
// hourlyWindow() above, just covering the whole day instead of one part of
// it. Hourly timestamps are already local to the forecast location
// (timezone=auto), so this is a plain string-prefix match, never a
// server-timezone conversion.
// deno-lint-ignore no-explicit-any
export function dayAggregates(fc: any, date: string): DayAggregates {
  const h = fc.hourly;
  const idx: number[] = [];
  for (let i = 0; i < (h?.time?.length ?? 0); i++) {
    if (h.time[i].startsWith(date)) idx.push(i);
  }
  // deno-lint-ignore no-explicit-any
  const pick = (arr?: any[]) => idx.map((i) => arr?.[i]).filter((v: number | null | undefined): v is number => v != null);
  const avg = (a: number[]) => a.length ? round1(a.reduce((s, v) => s + v, 0) / a.length) : null;
  const humidity = pick(h?.relative_humidity_2m);
  const cloud = pick(h?.cloud_cover);
  const visibilityM = pick(h?.visibility); // meters, per Open-Meteo
  return {
    humidity_mean_pct: avg(humidity),
    humidity_max_pct: humidity.length ? Math.round(Math.max(...humidity)) : null,
    cloud_cover_mean_pct: avg(cloud),
    cloud_cover_max_pct: cloud.length ? Math.round(Math.max(...cloud)) : null,
    visibility_mean_km: visibilityM.length ? round1(visibilityM.reduce((s, v) => s + v, 0) / visibilityM.length / 1000) : null,
    visibility_min_km: visibilityM.length ? round1(Math.min(...visibilityM) / 1000) : null,
  };
}

// deno-lint-ignore no-explicit-any
export function historyRows(h: any): { date: string; temp_max: number; temp_min: number; rain_mm: number }[] {
  const d = h.daily;
  return d.time.map((date: string, i: number) => ({
    date,
    temp_max: d.temperature_2m_max[i],
    temp_min: d.temperature_2m_min[i],
    rain_mm: d.precipitation_sum[i] ?? 0,
  }));
}

export interface TimeWindowStats {
  hours: string; // "06:00-12:00" style label for the window that was used
  temp_max: number;
  temp_min: number;
  rain_prob_max: number | null;
  wind_max_kmh: number;
}

// Slices the hourly array down to a single part-of-day window (morning/
// afternoon/evening/night) on one local calendar date, for questions like
// "how hot will it be tomorrow afternoon". Open-Meteo's hourly timestamps
// are already local to the forecast location (timezone=auto), so — same as
// hourlyWindow() above — this is a plain string comparison, never a
// server-timezone conversion.
// deno-lint-ignore no-explicit-any
export function timeWindowStats(fc: any, date: string, hours: [number, number]): TimeWindowStats | null {
  const h = fc.hourly;
  const [from, to] = hours;
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${date}T${pad(from)}:00`;
  const end = `${date}T${pad(to === 24 ? 23 : to)}:${to === 24 ? "59" : "00"}`;
  const idx: number[] = [];
  for (let i = 0; i < h.time.length; i++) {
    if (h.time[i] >= start && h.time[i] <= end) idx.push(i);
  }
  if (!idx.length) return null;
  const temps = idx.map((i) => h.temperature_2m[i]).filter((v: number) => v != null);
  const rainProbs = idx.map((i) => h.precipitation_probability?.[i]).filter((v: number | undefined) => v != null);
  const winds = idx.map((i) => h.wind_speed_10m[i]).filter((v: number) => v != null);
  if (!temps.length) return null;
  return {
    hours: `${pad(from)}:00-${pad(to === 24 ? 0 : to)}:00`,
    temp_max: round1(Math.max(...temps)),
    temp_min: round1(Math.min(...temps)),
    rain_prob_max: rainProbs.length ? Math.max(...rainProbs) : null,
    wind_max_kmh: round1(Math.max(...winds)),
  };
}

// Up to 12 hourly rows for spray decisions.
// Today: from the current hour. Other days: 06:00 onward on that date.
// Open-Meteo returns local-time ISO strings (timezone=auto), so string compare works.
// deno-lint-ignore no-explicit-any
export function hourlyWindow(fc: any, date: string): HourRow[] {
  const h = fc.hourly;
  const nowLocal: string = fc.current.time; // e.g. "2026-09-25T14:15"
  const start = date === nowLocal.slice(0, 10) ? `${nowLocal.slice(0, 13)}:00` : `${date}T06:00`;
  const from = h.time.findIndex((t: string) => t >= start);
  if (from < 0) return [];
  return h.time.slice(from, from + 12).map((time: string, j: number) => ({
    time,
    rain_prob: h.precipitation_probability?.[from + j] ?? null,
    wind_kmh: h.wind_speed_10m[from + j],
    temp_c: h.temperature_2m[from + j],
  }));
}
