// Live integration test for Open-Meteo Geocoding, Forecast, and Archive APIs
import assert from "node:assert";

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

console.log("Testing live Open-Meteo APIs...");

// 1. Geocoding
console.log("1. Testing Geocoding for Kolkata...");
const geoData = await fetchJson(
  "https://geocoding-api.open-meteo.com/v1/search?name=Kolkata&count=1&language=en&format=json"
);
assert.ok(geoData.results && geoData.results.length > 0, "Geocoding returned results");
const place = geoData.results[0];
assert.strictEqual(place.name, "Kolkata");
console.log(`✔ Geocoded: ${place.name}, lat=${place.latitude}, lon=${place.longitude}`);

// 2. Forecast API
console.log("2. Testing 7-day Forecast API...");
const q = new URLSearchParams({
  latitude: String(place.latitude),
  longitude: String(place.longitude),
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
const fcData = await fetchJson(`https://api.open-meteo.com/v1/forecast?${q}`);
assert.ok(fcData.current, "Forecast has current weather");
assert.ok(fcData.daily && fcData.daily.time.length === 7, "Forecast has 7 daily rows");
assert.ok(fcData.hourly && fcData.hourly.time.length > 0, "Forecast has hourly rows");
console.log(`✔ Forecast received: Current Temp = ${fcData.current.temperature_2m}°C, 7-day forecast available`);

// 3. Archive API
console.log("3. Testing Archive API...");
const qHist = new URLSearchParams({
  latitude: String(place.latitude),
  longitude: String(place.longitude),
  timezone: "auto",
  start_date: "2025-07-01",
  end_date: "2025-07-31",
  daily: "temperature_2m_max,temperature_2m_min,precipitation_sum",
});
const histData = await fetchJson(`https://archive-api.open-meteo.com/v1/archive?${qHist}`);
assert.ok(histData.daily && histData.daily.time.length === 31, "Archive has 31 July days");
const totalRain = histData.daily.precipitation_sum.reduce((a, b) => a + (b || 0), 0);
console.log(`✔ Archive received: Total Rain July 2025 = ${Math.round(totalRain * 10) / 10} mm`);

console.log("ALL LIVE API TESTS PASSED! 🎉");
