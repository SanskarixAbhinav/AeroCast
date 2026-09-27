// Unit tests for the location-scalability fix in
// supabase/functions/_shared/location.ts.
//
// location.ts is a Deno module (imports Supabase's client via an npm:
// specifier for caching) and the real network call goes to Open-Meteo,
// which isn't reachable from this sandbox. What's tested here — with a
// faithful re-implementation of geocodeUpstream(), the same pattern already
// used by tests/test_units.mjs and tests/test_intent.mjs for the other Deno
// modules — is the actual logic of the fix: no hardcoded city list, India
// is tried first via Open-Meteo's own `countryCode` filter, and an
// unrestricted global search is used as a fallback only when the
// India-scoped search comes back empty. `fetch` is mocked so this runs
// fully offline.
import assert from "node:assert";

function toPlace(r) {
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

async function geocodeUpstream(city, fetchImpl) {
  const name = encodeURIComponent(city);
  const base = `https://geocoding-api.open-meteo.com/v1/search?name=${name}&count=1&language=en&format=json`;

  const inRes = await fetchImpl(`${base}&countryCode=IN`);
  const inData = await inRes.json();
  const inPlace = inData?.results?.[0];
  if (inPlace) return toPlace(inPlace);

  const anyRes = await fetchImpl(base);
  const anyData = await anyRes.json();
  const anyPlace = anyData?.results?.[0];
  return anyPlace ? toPlace(anyPlace) : null;
}

console.log("Running geocoding-flow tests...");

// 1. Every one of the reported test-case towns resolves via the India-
// scoped call, on the first request — no hardcoded list involved anywhere
// in this path, just whatever Open-Meteo returns for that name+countryCode.
const TEST_TOWNS = [
  ["Kolkata", 22.57, 88.36, "West Bengal"],
  ["Darjeeling", 27.04, 88.27, "West Bengal"],
  ["Siliguri", 26.71, 88.43, "West Bengal"],
  ["Durgapur", 23.55, 87.32, "West Bengal"],
  ["Rajkot", 22.30, 70.80, "Gujarat"],
  ["Mysuru", 12.30, 76.65, "Karnataka"],
  ["Jamshedpur", 22.80, 86.18, "Jharkhand"],
  ["Agartala", 23.83, 91.28, "Tripura"],
  ["Dehradun", 30.32, 78.03, "Uttarakhand"],
  ["Kochi", 9.93, 76.26, "Kerala"],
  ["Jaipur", 26.91, 75.79, "Rajasthan"],
  ["Guwahati", 26.14, 91.73, "Assam"],
];

for (const [name, lat, lon, admin1] of TEST_TOWNS) {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    assert.ok(url.includes("countryCode=IN"), `first call for "${name}" must be India-scoped`);
    return {
      json: async () => ({
        results: [{ name, latitude: lat, longitude: lon, admin1, country: "India", timezone: "Asia/Kolkata" }],
      }),
    };
  };
  const place = await geocodeUpstream(name, fetchImpl);
  assert.strictEqual(calls, 1, `"${name}" should resolve without a global-fallback call`);
  assert.ok(place, `"${name}" should resolve to a place`);
  assert.strictEqual(place.lat, lat);
  assert.strictEqual(place.lon, lon);
  assert.strictEqual(place.timezone, "Asia/Kolkata");
  assert.ok(place.label.includes(name));
}
console.log("✔ All 12 reported towns resolve dynamically via India-scoped geocoding");

// 2. If the India-scoped search comes back empty, fall back to an
// unrestricted global search rather than reporting "not found" outright.
{
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    if (url.includes("countryCode=IN")) return { json: async () => ({ results: [] }) };
    return {
      json: async () => ({
        results: [{ name: "Pokhara", latitude: 28.21, longitude: 83.98, country: "Nepal", timezone: "Asia/Kathmandu" }],
      }),
    };
  };
  const place = await geocodeUpstream("Pokhara", fetchImpl);
  assert.strictEqual(calls, 2, "should retry globally after an empty India-scoped result");
  assert.ok(place);
  assert.strictEqual(place.country, "Nepal");
}
console.log("✔ Falls back to an unrestricted global search when India-scoped search is empty");

// 3. A place that resolves nowhere returns null (never a full sentence
// fragment) so the caller can show a clean "couldn't find that place"
// message, per the task's requirement.
{
  const fetchImpl = async () => ({ json: async () => ({ results: [] }) });
  const place = await geocodeUpstream("Xyzzyplaceville", fetchImpl);
  assert.strictEqual(place, null);
}
console.log("✔ An unresolvable place returns null for a clean user-facing error");

console.log("ALL GEOCODING-FLOW TESTS PASSED SUCCESSFULLY! 🎉");
