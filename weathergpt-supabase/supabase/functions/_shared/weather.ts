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
