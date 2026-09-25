import { cacheGet, cacheSet } from "./db.ts";
import { fetchJson } from "./utils.ts";
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
    await cacheSet(key, data);
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
    current: "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_gusts_10m",
    daily: [
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_sum",
      "precipitation_probability_max",
      "wind_speed_10m_max",
      "wind_gusts_10m_max",
      "et0_fao_evapotranspiration",
    ].join(","),
    hourly: "precipitation_probability,wind_speed_10m,temperature_2m",
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
  }));
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
