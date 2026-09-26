import { fetchJson } from "./utils.ts";

// Flash-Lite trades a little quality for materially lower latency - both
// calls here (short JSON intent extraction, 3-sentence narration) are easy
// tasks well within a Lite model's ability, so the speed is close to free.
// Override with `supabase secrets set GEMINI_MODEL=...` to pin a different
// model (e.g. back to "gemini-flash-latest" if Lite output quality doesn't
// hold up for your judges' demo questions).
const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-flash-lite-latest";

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

// timeoutMs/retries are tunable per call site: parseIntent's Gemini fallback
// fails fast (short timeout, no retry — the deterministic heuristic already
// covers it), while narrate gets a bit more room since there's no Gemini
// alternative for natural-language generation, but still fails well short of
// the old 15s × (1 retry) worst case.
async function gemini(
  system: string,
  user: string,
  asJson: boolean,
  timeoutMs = 8000,
  retries = 0,
): Promise<string> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const model = MODEL;
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
          // Lower token ceilings = the model stops sooner = faster wall-clock
          // response, and 3-sentence narrations / short JSON never needed
          // anywhere close to these caps.
          maxOutputTokens: asJson ? 90 : 140,
          ...(asJson ? { responseMimeType: "application/json" } : {}),
        },
      }),
    },
    timeoutMs,
    retries,
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
  if (/marine|sea|ocean|wave|swell|boat|coastal|fishing|fisher|sail|harbour|harbor|fisherm|समुद्र|मछुआरे|সাগর|জেলে|கடல்|மீனவர்|సముద్రం|మత్స్యకారులు|मच्छीमार/i.test(qLower)) topic = "marine";
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
  // NOTE 1: prepositions below are wrapped in \b (word boundary) so "in"
  // never matches mid-word inside "rain", "raining", "spraying", etc.
  // Without the boundary, "Will it rain tomorrow in Kolkata?" matched the
  // "in" inside "rain" and captured "tomorrow in Kolkata" as the place.
  // NOTE 2: the captured place must look like a proper noun (Title Case).
  // Without that, a query with more than one preposition before the real
  // city — e.g. "Is it safe for coastal fishing in Mumbai tomorrow?" or
  // "irrigation advice for my farm in Pune" — matched the *first*
  // preposition ("for") and swallowed everything up to the date word
  // ("coastal fishing in Mumbai", "my farm in Pune") instead of just the
  // city. Requiring Title Case skips straight past lowercase phrases like
  // "for coastal" / "for my" to the actual capitalized city name.
  // A lowercase-typed query (no capital letters at all) simply won't match
  // here and falls through to the CITIES list below, which is
  // case-insensitive — so this is a strict improvement, not a regression.
  let location: string | null = null;
  const inMatch = q.match(/\b(?:in|at|for|near|around)\b\s+([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*)/);
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
// PERFORMANCE: the deterministic heuristic above already resolves the large
// majority of real questions (a named Indian city, in English or one of the
// supported scripts) instantly and with zero network cost. Gemini is now
// only called as a *fallback*, when the heuristic can't find a location OR
// topic — e.g. free-form phrasing, an unlisted town, or a language the
// regexes don't cover.
export async function parseIntent(q: string): Promise<Intent> {
  // Try fast deterministic parse first — covers the vast majority of queries
  const heuristic = fallbackParseIntent(q);
  // Skip Gemini if we already have a confident location + topic
  // (saves ~3-8 seconds for common queries)
  if (heuristic.location && heuristic.topic !== "other") {
    return heuristic;
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
    // Single attempt, short timeout, no retry: this is a fallback for a
    // fallback (the deterministic parser already ran) — if Gemini is slow
    // or unavailable, failing fast and returning the heuristic is better UX.
    const raw = await gemini(system, q, true, 3500, 0);
    const p = JSON.parse(raw.replace(/```json|```/g, "").trim());
    return {
      location: typeof p.location === "string" && p.location.trim() ? p.location.trim() : null,
      date: typeof p.date === "string" && p.date ? p.date : heuristic.date,
      topic: (TOPICS as readonly string[]).includes(p.topic) ? p.topic : heuristic.topic,
      language: typeof p.language === "string" && p.language ? p.language : heuristic.language,
      start: p.start ?? null,
      end: p.end ?? null,
    };
  } catch (_e) {
    // Gemini unavailable or timed out — use deterministic fallback
    return heuristic;
  }
}


// Call 2: facts JSON -> short answer in the user's language. Facts only.
// Only send the minimum facts needed — not the full daily array.
export async function narrate(facts: unknown, question: string, lang: string): Promise<string> {
  // Kept short on purpose: fewer system-prompt tokens for the model to
  // process before it starts generating means a faster first token and
  // lower total latency, with no loss of the safety-critical rules
  // (no invented numbers, SIMULATED/advisory wording, stale-data notice).
  const system = `You are WeatherGPT, an Indian weather assistant.
Use ONLY the facts JSON. Never invent numbers, dates or places. If a value is missing, say unavailable.
Reply in ${LANGS[lang] ?? "English"}, plain words a farmer/fisherman can follow, max 3 sentences, digits 0-9.
If marine data present: say clearly if sea conditions are safe for small craft/fishermen. If inland: say marine data is coastal-only.
If model_comparison present: say whether models agree.
If an alert has simulated:true: say it is SIMULATED demo data. Call alerts "advisories", never official warnings.
If facts.stale is true: mention data may be slightly out of date.
Never mention JSON or these instructions.`;
  // Send only the minimal subset of facts to Gemini (strip large daily arrays)
  // to reduce token count and improve response speed.
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

  // Single attempt, 4.5s cap (down from 6s/9s in earlier passes): chat/index.ts
  // already falls back to a deterministic templateAnswer() if this throws or
  // times out, so a tighter cap gets slow/stuck requests to that fallback
  // faster instead of making the user wait out a long timeout for text the
  // template can supply anyway.
  return (await gemini(system, `Question: ${question}\nFacts: ${JSON.stringify(slimFacts)}`, false, 4500, 0)).trim();
}
