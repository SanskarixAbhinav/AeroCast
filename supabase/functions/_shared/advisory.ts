import { round1 } from "./weather.ts";
import type { DailyRow, HourRow } from "./weather.ts";

// Spray thresholds come from the project plan. Irrigation and harvest values
// are starting points: tune them with an agronomy source before real use.
export const RULES = {
  spray: { maxWindKmh: 15, maxRainProb: 30, maxTempC: 35 },
  irrigation: { skipIfRain2dMm: 5, highEt0Mm: 5 },
  harvest: { maxRain2dMm: 2, maxRainProb: 40 },
};

// Returns flags plus short reasons. The LLM only explains these; it never decides.
export function advise(
  topic: string,
  rows: DailyRow[],
  i: number,
  hours: HourRow[],
): Record<string, unknown> | null {
  const next = rows[i + 1];
  const rain2d = round1((rows[i].rain_mm ?? 0) + (next?.rain_mm ?? 0));
  const prob2d = Math.max(rows[i].rain_prob ?? 0, next?.rain_prob ?? 0);

  if (topic === "spray") {
    const R = RULES.spray;
    if (!hours.length) return { spray_safe: null, reason: ["hourly data unavailable"] };
    const maxProb = Math.max(...hours.map((h) => h.rain_prob ?? 0));
    const maxWind = Math.max(...hours.map((h) => h.wind_kmh ?? 0));
    const maxTemp = Math.max(...hours.map((h) => h.temp_c ?? -99));
    const reason: string[] = [];
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
    const reason: string[] = [];
    if (rain2d >= R.maxRain2dMm) reason.push("rain expected");
    if (prob2d >= R.maxRainProb) reason.push("high rain chance");
    return { harvest_ok: reason.length === 0, reason, rain_next_2_days_mm: rain2d, max_rain_prob: prob2d };
  }

  return null;
}
