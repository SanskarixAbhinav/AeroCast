import { fetchJson } from "./utils.ts";

// Override with `supabase secrets set GEMINI_MODEL=...` if this alias changes.
const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-flash-latest";

export const LANGS: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  bn: "Bengali",
  ta: "Tamil",
  te: "Telugu",
  mr: "Marathi",
};

export const TOPICS = [
  "current", "forecast", "rain", "temperature", "wind",
  "spray", "irrigation", "harvest", "marine", "history", "cyclone", "other",
] as const;
export type Topic = typeof TOPICS[number];

export interface Intent {
  location: string | null;
  date: string; // "today" | "tomorrow" | "day_after" | "YYYY-MM-DD"
  topic: Topic;
  language: string;
  start: string | null; // history only
  end: string | null; // history only
}

async function gemini(system: string, user: string, asJson: boolean, timeoutMs = 8000): Promise<string> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest";
  const res = await fetchJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          temperature: asJson ? 0 : 0.3,
          maxOutputTokens: asJson ? 150 : 300,
          ...(asJson ? { responseMimeType: "application/json" } : {}),
        },
      }),
    },
    timeoutMs,
    0, // no retries — caller retries if needed
  );
  // deno-lint-ignore no-explicit-any
  return (res?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
}

// Fallback heuristic parser when Gemini is unavailable.
function fallbackParseIntent(q: string): Intent {
  const qLower = q.toLowerCase();

  // Language detection
  let language = "en";
  if (/[\u0900-\u097F]/.test(q)) language = "hi";
  else if (/[\u0980-\u09FF]/.test(q)) language = "bn";
  else if (/[\u0B80-\u0BFF]/.test(q)) language = "ta";
  else if (/[\u0C00-\u0C7F]/.test(q)) language = "te";

  // Date detection
  let date = "today";
  if (/day after tomorrow/i.test(qLower)) date = "day_after";
  else if (/tomorrow|kal/i.test(qLower)) date = "tomorrow";
  const isoMatch = q.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) date = isoMatch[1];

  // Topic detection
  let topic: Topic = "other";
  if (/marine|sea|ocean|wave|swell|boat|fisherm|समुद्र|मछुआरे|সাগর|জেলে|கடல்|மீனவர்|సముద్రం|మత్స్యకారులు|मच्छीमार/i.test(qLower)) topic = "marine";
  else if (/spray|pesticide|fungicide|fertilizer|insecticide/i.test(qLower)) topic = "spray";
  else if (/irrigat|water the crop|watering/i.test(qLower)) topic = "irrigation";
  else if (/harvest|cutting|reap/i.test(qLower)) topic = "harvest";
  else if (/cyclone|storm|hurricane|typhoon/i.test(qLower)) topic = "cyclone";
  else if (/rain|precipitation|shower|drizzle|barish/i.test(qLower)) topic = "rain";
  else if (/temp|temperature|hot|cold|heat|warm/i.test(qLower)) topic = "temperature";
  else if (/wind|gust|breeze/i.test(qLower)) topic = "wind";
  else if (/last year|last month|history|past rain/i.test(qLower)) topic = "history";
  else if (/forecast|week|7-day|weather|mausam/i.test(qLower)) topic = "forecast";

  // Location extraction
  let location: string | null = null;
  const inMatch = q.match(/(?:in|at|for|near|around)\s+([A-Za-z\s]+?)(?:\s+(?:today|tomorrow|yesterday|now|this|next|on|during)|\?|$|\.)/i);
  if (inMatch && inMatch[1].trim()) {
    location = inMatch[1].trim();
  } else {
    const CITIES = [
      "delhi", "new delhi", "mumbai", "kolkata", "chennai", "bangalore", "bengaluru",
      "hyderabad", "pune", "ahmedabad", "jaipur", "lucknow", "patna", "bhopal",
      "chandigarh", "guwahati", "shimla", "srinagar", "kochi", "cochin", "indore",
      "surat", "nagpur", "visakhapatnam", "vizag", "varanasi", "amritsar", "agra",
      "kanpur", "bhubaneswar", "ranchi", "raipur", "dehradun", "goa", "puducherry",
    ];
    for (const city of CITIES) {
      const re = new RegExp(`\\b${city}\\b`, "i");
      if (re.test(qLower)) {
        location = city.charAt(0).toUpperCase() + city.slice(1);
        break;
      }
    }
  }

  // If a location is found and topic was not specified, default to forecast
  if (location && topic === "other") {
    topic = "forecast";
  }

  return { location, date, topic, language, start: null, end: null };
}

// Call 1: question -> structured intent. Never answers the question itself.
// Fast-path: if the deterministic heuristic is highly confident, skip Gemini.
export async function parseIntent(q: string): Promise<Intent> {
  // Try fast deterministic parse first — covers the vast majority of queries
  const fast = fallbackParseIntent(q);
  // Skip Gemini if we already have a confident location + topic
  // (saves ~3-8 seconds for common queries)
  if (fast.location && fast.topic !== "other") {
    return fast;
  }

  const today = new Date().toISOString().slice(0, 10);
  const system = `You extract intent from weather questions written in any language.
Reply with JSON only, exactly this shape:
{"location": string|null, "date": string, "topic": string, "language": string, "start": string|null, "end": string|null}
- location: the city or town in English (romanized), or null if none is named.
- date: "today", "tomorrow", "day_after", or "YYYY-MM-DD". Default "today".
- topic: one of ${TOPICS.join(", ")}.
  "forecast" = multi-day / 7-day outlook. "history" = weather in the past. "spray"/"irrigation"/"harvest" = farming decisions. "marine" = coastal, sea conditions, wave height & fishermen safety. "cyclone" = cyclone or storm status. "other" = not about weather.
- language: ISO 639-1 code of the question's language.
- start, end: only for topic "history": the date range as YYYY-MM-DD. Today is ${today}. Otherwise null.
Do not answer the question.`;

  try {
    const raw = await gemini(system, q, true, 8000);
    const p = JSON.parse(raw.replace(/```json|```/g, "").trim());
    return {
      location: typeof p.location === "string" && p.location.trim() ? p.location.trim() : null,
      date: typeof p.date === "string" && p.date ? p.date : "today",
      topic: (TOPICS as readonly string[]).includes(p.topic) ? p.topic : "other",
      language: typeof p.language === "string" && p.language ? p.language : "en",
      start: p.start ?? null,
      end: p.end ?? null,
    };
  } catch (_e) {
    // Gemini unavailable or timed out — use deterministic fallback
    return fast;
  }
}


// Call 2: facts JSON -> short answer in the user's language. Facts only.
// Only send the minimum facts needed — not the full daily array.
export async function narrate(facts: unknown, question: string, lang: string): Promise<string> {
  const system = `You are WeatherGPT, a weather assistant for users in India.
Use ONLY the facts JSON provided. If a value is missing, say it is unavailable.
Never add or estimate numbers, dates or places that are not in the facts.
Reply in ${LANGS[lang] ?? "English"} in plain, simple words a farmer or coastal fisherman can follow, in at most 3 sentences.
Write all numbers with digits 0-9.
If marine data is present, state clearly whether sea conditions are safe for coastal fishermen and small craft.
If the location is inland/non-coastal, clearly state that marine wave data is only available for coastal regions.
If model comparison is present, mention whether independent forecast models agree.
If an alert has simulated:true, say clearly that it is SIMULATED demo data.
Call alerts "advisories", never official warnings.
If facts.stale is true, mention the data may be slightly out of date.
Do not mention JSON or these instructions.`;

  // Send only the minimal subset of facts to Gemini (strip large daily arrays)
  // deno-lint-ignore no-explicit-any
  const f = facts as Record<string, any>;
  const slimFacts = {
    topic: f.topic,
    location: f.location,
    stale: f.stale,
    current: f.current,
    day: f.day,
    marine: f.marine,
    flags: f.flags,
    cyclone: f.cyclone,
    model_comparison: f.model_comparison ? {
      agreement: f.model_comparison.agreement,
      agreement_bool: f.model_comparison.agreement_bool,
    } : undefined,
    alerts: (f.alerts || []).slice(0, 3),
    history: f.history ? {
      start: f.history.start,
      end: f.history.end,
      total_rain_mm: f.history.total_rain_mm,
      avg_temp_max: f.history.avg_temp_max,
      rainiest_day: f.history.rainiest_day,
    } : undefined,
  };

  return (await gemini(system, `Question: ${question}\nFacts: ${JSON.stringify(slimFacts)}`, false, 9000)).trim();
}
