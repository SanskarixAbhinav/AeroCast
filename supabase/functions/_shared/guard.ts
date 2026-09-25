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
