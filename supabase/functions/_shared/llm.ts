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

export const TIME_RANGES = ["morning", "afternoon", "evening", "night"] as const;
export type TimeRangeValue = typeof TIME_RANGES[number];

// The specific weather variables a question can ask about. This is
// deliberately separate from `topic` above: `topic` is the single overall
// REQUEST TYPE (forecast / marine advisory / spray timing / etc.) used to
// pick which branch of chat/index.ts and which advisory rules apply, while
// `needs` is the (possibly empty, possibly multi-valued) list of specific
// weather variables the question named - e.g. "temperature, humidity and
// wind" all in one sentence. A question is never forced to pick just one of
// these the way a single `topic = "rain"` string would.
export const WEATHER_VARS = [
  "temperature",
  "apparent_temperature",
  "precipitation",
  "precipitation_probability",
  "rain",
  "humidity",
  "wind_speed",
  "wind_gusts",
  "cloud_cover",
  "visibility",
  "uv_index",
  "sunrise",
  "sunset",
  "weather_condition",
] as const;
export type WeatherVar = typeof WEATHER_VARS[number];

export interface Intent {
  location: string | null;
  date: string; // "today" | "tomorrow" | "day_after" | "next_<weekday>" | "this_weekend" | "YYYY-MM-DD"
  time_range: TimeRangeValue | null; // part of day, independent of the date itself
  topic: Topic;
  needs: WeatherVar[]; // specific weather variables asked about; [] if none named
  language: string;
  start: string | null; // history only
  end: string | null; // history only
}

// timeoutMs/retries are tunable per call site: parseIntent's Gemini call is
// the primary intent-extraction path (see below) so it gets one retry before
// giving up to the deterministic heuristic, while narrate has no fallback
// generator so it gets a bit more room, but still fails well short of the
// old 15s × (1 retry) worst case.
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

// Cleans up a location string returned by either extraction path.
// Generic hygiene only (punctuation/whitespace/word-count sanity) — this is
// NOT where per-question fixes belong. If it looks implausible as a place
// (too many words, contains digits, etc.) the caller should prefer the other
// extraction path instead of trusting it.
function sanitizeLocation(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/["'“”‘’]/g, "")
    .replace(/[.?!,;:]+$/g, "")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned) return null;
  // A real place name is a handful of words at most and has no digits.
  // Anything wilder than that (an accidentally-captured clause, a stray
  // sentence fragment) is not trustworthy as a geocoder input.
  if (cleaned.split(" ").length > 4) return null;
  if (/\d/.test(cleaned)) return null;
  return cleaned;
}

// Keyword-based detection of which specific weather variables a question
// names - independent of, and can return several at once unlike, the single
// `topic` string above. Same style/status as the topic keyword-matching
// below: a fixed, generic synonym map (not a list of specific questions),
// used as the offline fallback when Gemini (the primary extractor, see
// parseIntent below) is unavailable.
function detectNeeds(qLower: string): WeatherVar[] {
  const found: WeatherVar[] = [];
  const add = (v: WeatherVar) => { if (!found.includes(v)) found.push(v); };
  if (/feels like|apparent temperature|real feel|heat index/.test(qLower)) add("apparent_temperature");
  if (/\btemp(erature)?\b|\bhot\b|\bcold\b|\bheat\b|\bwarm\b/.test(qLower)) add("temperature");
  if (/precipitation probability|chance of rain|rain chance|probability of rain/.test(qLower)) add("precipitation_probability");
  if (/\bprecipitation\b/.test(qLower)) add("precipitation");
  if (/\brain(ing|fall)?\b|shower|drizzle|barish/.test(qLower)) add("rain");
  if (/\bhumid(ity)?\b|moisture/.test(qLower)) add("humidity");
  if (/\bgust/.test(qLower)) add("wind_gusts");
  if (/\bwind\b|breeze/.test(qLower)) add("wind_speed");
  if (/\bcloud/.test(qLower)) add("cloud_cover");
  if (/visibility|\bfog\b|\bmist\b/.test(qLower)) add("visibility");
  if (/\buv\b|uv index|sunburn/.test(qLower)) add("uv_index");
  if (/sunrise/.test(qLower)) add("sunrise");
  if (/sunset/.test(qLower)) add("sunset");
  if (/weather condition|\bcondition\b|\bsunny\b|\bcloudy\b|clear sky|overcast/.test(qLower)) add("weather_condition");
  return found;
}

// Offline/resilience fallback parser — used ONLY when Gemini is unreachable
// (no API key, network error, timeout, bad JSON). This is intentionally a
// blunt instrument: it is not the mechanism that is supposed to handle every
// phrasing correctly (that's Gemini's job, see parseIntent below), it just
// needs to keep the app answering *something* sensible while Gemini is down.
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
  const weekdayMatch = qLower.match(/\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (/day after tomorrow/i.test(qLower)) date = "day_after";
  else if (weekdayMatch) date = `next_${weekdayMatch[1]}`;
  else if (/\bthis\s+weekend\b|\bweekend\b/i.test(qLower)) date = "this_weekend";
  else if (/tomorrow|kal/i.test(qLower)) date = "tomorrow";
  const isoMatch = q.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) date = isoMatch[1];

  // Time-of-day detection - independent of which date is meant.
  let time_range: TimeRangeValue | null = null;
  if (/\bmorning\b/i.test(qLower)) time_range = "morning";
  else if (/\bafternoon\b/i.test(qLower)) time_range = "afternoon";
  else if (/\bevening\b/i.test(qLower)) time_range = "evening";
  else if (/\bnight\b/i.test(qLower)) time_range = "night";

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

  // Location extraction — no hardcoded city list, scales to any Indian
  // town. What comes out of this function is only a *candidate* string;
  // the real geocoder (Open-Meteo, see location.ts) is what actually
  // resolves and validates it, so this only needs to isolate the right
  // *word(s)*, not know which towns exist.
  //
  // Pass 1 — preposition-anchored: "in/at/for/near/around <Place>".
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
  let location: string | null = null;
  const inMatch = q.match(/\b(?:in|at|for|near|around)\b\s+([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*)/);
  if (inMatch && inMatch[1].trim()) {
    location = inMatch[1].trim();
  } else {
    // Pass 2 — no preposition anchor at all (e.g. "Darjeeling weather
    // tomorrow", or just "Rajkot"). Take any standalone run of Title-Case
    // word(s) in the sentence, skipping runs that are only common
    // question-starter words ("Will", "Is", "Any", ...) — that's a small
    // fixed set of English function words, not a list of places, so it
    // doesn't grow as new towns come up. Among what's left, prefer the
    // last run: question words front-load a sentence, so the place name
    // (however unfamiliar) tends to come after them.
    const STOPWORDS = new Set([
      "will", "is", "are", "do", "does", "did", "can", "could", "should",
      "what", "when", "where", "how", "any", "please",
    ]);
    const runs = (q.match(/\b[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*\b/g) ?? [])
      .map((r) => r.trim())
      .filter((r) => !r.split(/\s+/).every((w) => STOPWORDS.has(w.toLowerCase())));
    if (runs.length) location = runs[runs.length - 1];
  }

  // If a location is found and topic was not specified, default to forecast
  if (location && topic === "other") {
    topic = "forecast";
  }

  const needs = detectNeeds(qLower);

  return { location, date, time_range, topic, needs, language, start: null, end: null };
}

// Call 1: question -> structured intent. Never answers the question itself.
//
// A single user sentence can mix several distinct things together — a PLACE,
// a DATE/TIME, a REQUEST TYPE (forecast / marine advisory / spray timing /
// etc.), and specific weather requirements ("safe for fishing", "chance of
// rain"). Those have to be pulled apart *before* anything is handed to the
// geocoder, or a phrase like "coastal fishing in Mumbai tomorrow" ends up
// treating the whole clause as a place name.
//
// Gemini's structured JSON extraction is the primary path for this, because
// it separates those concepts semantically instead of guessing from sentence
// position — which is exactly what regex-matching on prepositions/casing
// cannot robustly do across arbitrary phrasing, languages, and unlisted
// towns. The deterministic heuristic below still runs first (it's free) and
// is used as the *offline resilience fallback* if Gemini is unavailable,
// times out, or returns something that doesn't parse — never as the primary
// mechanism for getting individual questions right.
export async function parseIntent(q: string): Promise<Intent> {
  const heuristic = fallbackParseIntent(q); // cheap, used only if Gemini fails below

  // This runs BEFORE geocoding, so the target location's own timezone isn't
  // known yet - there's no place to look it up from until parseIntent
  // returns. Using the server's UTC date here is a deliberate, narrow
  // exception to "never use server UTC for date math": it only seeds
  // Gemini's sense of "today" for computing a history date RANGE (e.g.
  // "last month"), where a same-day offset from a location's local midnight
  // is immaterial to a month-scale range. It never affects today/tomorrow/
  // weekend/weekday resolution for forecasts - that happens later in
  // dates.ts, entirely against the forecast's own local calendar dates.
  const today = new Date().toISOString().slice(0, 10);
  const system = `You extract structured intent from a weather question written in any language.
The sentence may name a PLACE, a DATE/TIME, a REQUEST TYPE (what kind of weather info is wanted), and specific weather details all in one clause. You must separate these cleanly: never let date/time words or activity/request words leak into the location, and never let the place name leak into anything else.

Reply with JSON only, exactly this shape:
{"location": string|null, "date": string, "time_range": string|null, "topic": string, "needs": string[], "language": string, "start": string|null, "end": string|null}
- location: ONLY the city/town/place name, in English (romanized). Nothing else — no date words ("tomorrow", "today"), no activity/request words ("fishing", "spraying", "coastal", "safe", "harvest"), no filler. null if no place is named (e.g. a follow-up question that doesn't repeat the place).
- date: "today", "tomorrow", "day_after", "next_<weekday>" (e.g. "next_monday" for "next Monday"), "this_weekend", or "YYYY-MM-DD". Default "today".
- time_range: one of ${TIME_RANGES.join(", ")} if the question names a part of day, else null. This is separate from date - a question can name both (e.g. "tomorrow morning") or just one.
- topic: one of ${TOPICS.join(", ")}.
  "forecast" = multi-day / 7-day outlook. "history" = weather in the past. "spray"/"irrigation"/"harvest" = farming decisions. "marine" = coastal, sea conditions, wave height & fishermen safety (this is the "marine advisory" request type). "cyclone" = cyclone or storm status. "other" = not about weather, OR a follow-up question that gives no topic signal on its own (e.g. "What about the day after tomorrow?").
- needs: array of the SPECIFIC weather variables the question explicitly asks about, chosen ONLY from this fixed list: ${WEATHER_VARS.join(", ")}. A question can name several at once (e.g. "temperature, humidity and wind") - list every one it names, not just the first. [] if the question doesn't name specific variables (a general "weather"/"forecast" question, or a request-type-only question like a spray/irrigation/marine/harvest/cyclone request that doesn't itself name a variable).
- language: ISO 639-1 code of the question's language.
- start, end: only for topic "history": the date range as YYYY-MM-DD. Today is ${today}. Otherwise null.

Examples of correct separation (location must never absorb date/topic words):
Q: "Will it rain tomorrow in Kolkata?" -> {"location":"Kolkata","date":"tomorrow","time_range":null,"topic":"rain","needs":["rain"],"language":"en","start":null,"end":null}
Q: "Is it safe for coastal fishing in Mumbai tomorrow?" -> {"location":"Mumbai","date":"tomorrow","time_range":null,"topic":"marine","needs":[],"language":"en","start":null,"end":null}
Q: "How hot will it be next Monday in Jaipur?" -> {"location":"Jaipur","date":"next_monday","time_range":null,"topic":"temperature","needs":["temperature"],"language":"en","start":null,"end":null}
Q: "Will it rain this weekend in Mumbai?" -> {"location":"Mumbai","date":"this_weekend","time_range":null,"topic":"rain","needs":["rain"],"language":"en","start":null,"end":null}
Q: "What will the temperature, humidity and wind be tomorrow in Delhi?" -> {"location":"Delhi","date":"tomorrow","time_range":null,"topic":"forecast","needs":["temperature","humidity","wind_speed"],"language":"en","start":null,"end":null}
Q: "What's the UV index and sunset time in Chennai today?" -> {"location":"Chennai","date":"today","time_range":null,"topic":"forecast","needs":["uv_index","sunset"],"language":"en","start":null,"end":null}
Q: "What about the day after tomorrow?" (a follow-up, no place or topic stated) -> {"location":null,"date":"day_after","time_range":null,"topic":"other","needs":[],"language":"en","start":null,"end":null}
Q: "Will it rain?" (a follow-up, no place stated) -> {"location":null,"date":"today","time_range":null,"topic":"rain","needs":["rain"],"language":"en","start":null,"end":null}
Do not answer the question.`;

  try {
    // Primary path: one attempt with a short retry, since this now runs on
    // every request rather than only as a fallback.
    const raw = await gemini(system, q, true, 6000, 1);
    const p = JSON.parse(raw.replace(/```json|```/g, "").trim());
    const geminiLocation = sanitizeLocation(typeof p.location === "string" ? p.location : null);
    // Gemini's `needs` array is trusted only where every entry is one of
    // the fixed WEATHER_VARS - anything else falls back to the keyword
    // heuristic's needs, same pattern as every other field here.
    const geminiNeeds = Array.isArray(p.needs) &&
        p.needs.every((n: unknown) => typeof n === "string" && (WEATHER_VARS as readonly string[]).includes(n))
      ? (p.needs as WeatherVar[])
      : null;
    return {
      // If Gemini's location fails the generic plausibility check, prefer
      // the heuristic's independently-extracted location over discarding it
      // outright — but never fall back to stitching together raw sentence
      // fragments beyond what either extractor already produced.
      location: geminiLocation ?? heuristic.location,
      date: typeof p.date === "string" && p.date ? p.date : heuristic.date,
      time_range: (TIME_RANGES as readonly string[]).includes(p.time_range) ? p.time_range : heuristic.time_range,
      topic: (TOPICS as readonly string[]).includes(p.topic) ? p.topic : heuristic.topic,
      needs: geminiNeeds ?? heuristic.needs,
      language: typeof p.language === "string" && p.language ? p.language : heuristic.language,
      start: p.start ?? null,
      end: p.end ?? null,
    };
  } catch (_e) {
    // Gemini unavailable, slow, or returned unparseable JSON — use the
    // deterministic offline fallback so the app still answers.
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
Use ONLY the supplied weather facts. Do not invent, estimate, replace, or contradict numerical weather values. If information is missing, say that it is unavailable.
Never invent dates or places either.
Reply in ${LANGS[lang] ?? "English"}, plain words a farmer/fisherman can follow, max 3 sentences, digits 0-9.
If marine data present: say clearly if sea conditions are safe for small craft/fishermen. If inland: say marine data is coastal-only.
If time_window present: the person asked about a specific part of day (morning/afternoon/evening/night) - answer using ONLY time_window's values for that window, not the full day's, and say which part of day it is.
If model_comparison present: say whether models agree.
If requested is present: the person asked about those specific weather variables by name (e.g. humidity, wind, UV index, sunrise) - explain exactly those values from requested, in plain words, and don't add variables that aren't in requested.
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
    time_window: f.time_window,
    requested: f.requested,
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
