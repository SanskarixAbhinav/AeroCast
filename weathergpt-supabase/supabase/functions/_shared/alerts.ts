import { db } from "./db.ts";
import type { DailyRow } from "./weather.ts";

export type Level = "yellow" | "orange" | "red";

export interface Alert {
  type: string;
  level: Level;
  date?: string;
  message: string;
  simulated: boolean;
  official: false; // these are threshold advisories, never official warnings
}

// Tune here. Rain thresholds follow IMD's "heavy" / "very heavy" daily bands;
// the level (colour) mapping and the heat/wind thresholds are simple MVP choices.
export const THRESHOLDS = {
  heavyRainMm: 64.5,
  veryHeavyRainMm: 115.6,
  heatwaveC: 40,
  extremeHeatC: 45,
  gustYellowKmh: 50,
  gustOrangeKmh: 70,
};

const mk = (type: string, level: Level, date: string, message: string): Alert => ({
  type,
  level,
  date,
  message,
  simulated: false,
  official: false,
});

export function computeAlerts(rows: DailyRow[]): Alert[] {
  const T = THRESHOLDS;
  const out: Alert[] = [];
  for (const r of rows) {
    if (r.rain_mm >= T.veryHeavyRainMm) out.push(mk("very_heavy_rain", "red", r.date, `Very heavy rain expected (${r.rain_mm} mm).`));
    else if (r.rain_mm >= T.heavyRainMm) out.push(mk("heavy_rain", "orange", r.date, `Heavy rain expected (${r.rain_mm} mm).`));

    if (r.temp_max >= T.extremeHeatC) out.push(mk("heatwave", "red", r.date, `Extreme heat expected (max ${r.temp_max} C).`));
    else if (r.temp_max >= T.heatwaveC) out.push(mk("heatwave", "orange", r.date, `Heatwave conditions expected (max ${r.temp_max} C).`));

    if (r.gust_max_kmh >= T.gustOrangeKmh) out.push(mk("strong_wind", "orange", r.date, `Very strong wind gusts expected (${r.gust_max_kmh} km/h).`));
    else if (r.gust_max_kmh >= T.gustYellowKmh) out.push(mk("strong_wind", "yellow", r.date, `Strong wind gusts expected (${r.gust_max_kmh} km/h).`));
  }
  return out;
}

// Reads the newest active bulletin from the cyclone_bulletins table.
// The seeded row is marked simulated = true and is always labelled as such.
export async function cycloneAlerts() {
  try {
    const { data, error } = await db
      .from("cyclone_bulletins")
      .select("bulletin, simulated")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return { bulletin: null, alerts: [] as Alert[] };

    const b = data.bulletin;
    const alert: Alert = {
      type: "cyclone",
      level: "red",
      message: `${data.simulated ? "SIMULATED: " : ""}${b.name}. ${b.advisory}`,
      simulated: data.simulated,
      official: false,
    };
    return { bulletin: { ...b, simulated: data.simulated }, alerts: [alert] };
  } catch (_e) {
    return { bulletin: null, alerts: [] as Alert[] };
  }
}

