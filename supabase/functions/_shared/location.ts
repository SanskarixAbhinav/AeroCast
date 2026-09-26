import { cacheGet, cacheSet } from "./db.ts";
import { background, fetchJson } from "./utils.ts";

export interface Place {
  name: string;
  admin1?: string;
  country?: string;
  lat: number;
  lon: number;
  timezone?: string;
  label: string; // e.g. "Mumbai, Maharashtra, India" (echoed back to the user)
}

const GEO_TTL_MS = 30 * 24 * 3600 * 1000;

export async function geocode(city: string): Promise<Place | null> {
  const key = `geo:${city.trim().toLowerCase()}`;
  const hit = await cacheGet<Place>(key, GEO_TTL_MS);
  if (hit?.fresh) return hit.value;

  try {
    const data = await fetchJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
    );
    const r = data?.results?.[0];
    if (!r) return null;

    const place: Place = {
      name: r.name,
      admin1: r.admin1,
      country: r.country,
      lat: r.latitude,
      lon: r.longitude,
      timezone: r.timezone,
      label: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
    };
    background(cacheSet(key, place));
    return place;
  } catch (_e) {
    if (hit) return hit.value;
    return null;
  }
}

