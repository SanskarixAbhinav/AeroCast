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

// deno-lint-ignore no-explicit-any
function toPlace(r: any): Place {
  return {
    name: r.name,
    admin1: r.admin1,
    country: r.country,
    lat: r.latitude,
    lon: r.longitude,
    timezone: r.timezone,
    label: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
  };
}

// Resolves ANY place name dynamically via Open-Meteo's geocoding API — no
// hardcoded city list of any size. AeroCast is an India-focused assistant,
// so we first ask Open-Meteo to restrict results to India (`countryCode=IN`,
// the filter it documents for exactly this). If that comes back empty (a
// misspelling, or a genuinely non-Indian place), we retry once with an
// unrestricted global search rather than reporting "not found" outright.
// We never do it the other way around, so a same-named town elsewhere in
// the world can't shadow the Indian one this app is meant to serve.
async function geocodeUpstream(city: string): Promise<Place | null> {
  const name = encodeURIComponent(city);
  const base = `https://geocoding-api.open-meteo.com/v1/search?name=${name}&count=1&language=en&format=json`;

  const inResult = await fetchJson(`${base}&countryCode=IN`);
  const inPlace = inResult?.results?.[0];
  if (inPlace) return toPlace(inPlace);

  const anyResult = await fetchJson(base);
  const anyPlace = anyResult?.results?.[0];
  return anyPlace ? toPlace(anyPlace) : null;
}

export async function geocode(city: string): Promise<Place | null> {
  const key = `geo:${city.trim().toLowerCase()}`;
  const hit = await cacheGet<Place>(key, GEO_TTL_MS);
  if (hit?.fresh) return hit.value;

  try {
    const place = await geocodeUpstream(city);
    if (!place) return null;
    background(cacheSet(key, place));
    return place;
  } catch (_e) {
    if (hit) return hit.value;
    return null;
  }
}

