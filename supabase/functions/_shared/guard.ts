// Small numbers the narration may use naturally ("next 12 hours", "7-day").
const COMMON = new Set([0, 1, 2, 3, 4, 5, 6, 7, 12, 24, 48]);

// Hindi/Marathi (Devanagari), Bengali, Tamil and Telugu digits -> ASCII.
const ZEROS = [0x0966, 0x09E6, 0x0BE6, 0x0C66];
const toAscii = (s: string) =>
  s.replace(/[\u0966-\u096F\u09E6-\u09EF\u0BE6-\u0BEF\u0C66-\u0C6F]/g, (c) => {
    const code = c.charCodeAt(0);
    return String(code - ZEROS.find((z) => code >= z && code < z + 10)!);
  });

// True only if every number in the answer also appears in the facts
// (allowing rounding). If false, the caller discards the LLM text.
export function numbersOk(answer: string, facts: unknown): boolean {
  const allowed = new Set<number>(COMMON);
  for (const m of JSON.stringify(facts).match(/-?\d+(?:\.\d+)?/g) ?? []) {
    const n = Number(m);
    for (const v of [n, Math.abs(n), Math.round(n), Math.round(n * 10) / 10]) allowed.add(v);
  }
  for (const m of toAscii(answer).match(/\d+(?:\.\d+)?/g) ?? []) {
    if (!allowed.has(Number(m))) return false;
  }
  return true;
}

// Plain English answer built straight from the facts (used if Gemini fails or the guard trips).
// deno-lint-ignore no-explicit-any
export function templateAnswer(f: any): string {
  const parts: string[] = [];
  if (f.history) {
    parts.push(
      `${f.location}, ${f.history.start} to ${f.history.end}: total rain ${f.history.total_rain_mm} mm, average maximum temperature ${f.history.avg_temp_max} C.`,
    );
  } else if (f.time_window) {
    const tw = f.time_window;
    parts.push(
      `${f.location}, ${f.day?.date ?? ""} ${tw.range} (${tw.hours}): ${tw.temp_min} to ${tw.temp_max} C${
        tw.rain_prob_max != null ? `, rain chance up to ${tw.rain_prob_max}%` : ""
      }, wind up to ${tw.wind_max_kmh} km/h.`,
    );
  } else if (f.day) {
    parts.push(
      `${f.location} on ${f.day.date}: ${f.day.temp_min} to ${f.day.temp_max} C, rain ${f.day.rain_mm} mm (${f.day.rain_prob ?? "unknown"}% chance), wind up to ${f.day.wind_max_kmh} km/h.`,
    );
  }
  // Facts for specific variables the question named (see llm.ts `needs` /
  // chat/index.ts facts.requested). Skip temperature/rain/precipitation/
  // wind_speed here — those are already covered by the f.day/time_window
  // sentence above — and only add what that sentence doesn't say.
  if (f.requested) {
    const r = f.requested;
    const bits: string[] = [];
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
  if (f.flags) {
    const why = (f.flags.reason ?? []).join(", ");
    if (f.flags.spray_safe === true) parts.push("Spraying: conditions are suitable.");
    else if (f.flags.spray_safe === false) parts.push(`Spraying: not advisable (${why}).`);
    if (f.flags.harvest_ok === true) parts.push("Harvesting: conditions are suitable.");
    else if (f.flags.harvest_ok === false) parts.push(`Harvesting: not advisable (${why}).`);
    if (f.flags.irrigate === true) parts.push(`Irrigation: recommended (${why}).`);
    else if (f.flags.irrigate === false) parts.push(`Irrigation: not needed (${why}).`);
    if (f.flags.marine_safe === true) parts.push(`Marine advisory: conditions are suitable for small craft and fishing (waves ${f.flags.wave_height_m} m, wind ${f.flags.max_wind_kmh} km/h).`);
    else if (f.flags.marine_safe === false) parts.push(`Marine advisory: not advisable for small craft or fishing (${why}).`);
    else if (f.flags.marine_safe === null && f.marine && !f.marine.is_coastal) parts.push(`${f.location} is an inland location. Marine wave forecasts are only available for coastal waters.`);
  }
  if (f.marine && !f.marine.is_coastal && (!f.flags || f.flags.marine_safe === undefined)) {
    parts.push(`${f.location} is an inland location. Marine wave forecasts are only available for coastal waters.`);
  }
  if (f.model_comparison) {
    const mc = f.model_comparison;
    parts.push(`Model comparison: GFS (${mc.gfs.temp_max} C, ${mc.gfs.rain_prob}%) and ECMWF (${mc.ecmwf.temp_max} C, ${mc.ecmwf.rain_prob}%).`);
  }
  for (const a of f.alerts ?? []) parts.push(`${a.simulated ? "[SIMULATED] " : ""}${a.message}`);
  if (f.stale) parts.push("Note: this data may be slightly out of date.");
  return parts.join(" ") || "Weather data is unavailable right now.";
}
