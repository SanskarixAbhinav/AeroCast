import { corsHeaders, json } from "../_shared/utils.ts";
import { db } from "../_shared/db.ts";
import { narrate, parseIntent } from "../_shared/llm.ts";
import { geocode } from "../_shared/location.ts";
import { dailyRows, getForecast, getHistory, historyRows, hourlyWindow, round1 } from "../_shared/weather.ts";
import { computeAlerts, cycloneAlerts } from "../_shared/alerts.ts";
import type { Alert } from "../_shared/alerts.ts";
import { advise } from "../_shared/advisory.ts";
import { numbersOk, templateAnswer } from "../_shared/guard.ts";
import { clampHistory, resolveIndex } from "../_shared/dates.ts";

const RATE_LIMIT_PER_MIN = 20;

// deno-lint-ignore no-explicit-any
type Log = Record<string, any>;

async function handleChat(q: string, langIn: unknown, demo: unknown, log: Log) {
  // 1. Parse the question into structured intent (LLM call 1)
  const intent = await parseIntent(q);
  const lang = typeof langIn === "string" && langIn ? langIn : intent.language; // dropdown wins
  log.lang = lang;
  log.intent = intent;

  // For replies that carry no weather data (help, "which city?", errors).
  const say = async (notice: string) => {
    let answer = notice;
    try {
      answer = await narrate({ notice }, q, lang);
    } catch (_e) { /* keep the English notice */ }
    return { answer, facts: null, alerts: [], meta: { source: "Open-Meteo" } };
  };

  if (intent.topic === "other") {
    return say(
      "I can answer questions about weather, the 7-day forecast, past rainfall, weather advisories, and farming decisions like spraying, irrigation and harvesting. Ask me about a place.",
    );
  }
  if (!intent.location) return say("Please tell me which city or town you mean.");

  // 2. Resolve the location
  let place;
  try {
    place = await geocode(intent.location);
  } catch (_e) {
    return say("Location service is temporarily unavailable. Please try again in a moment.");
  }
  log.location = place?.label ?? intent.location;
  if (!place) {
    return say(`I couldn't find a place called "${intent.location}". Please check the spelling or try a nearby city.`);
  }

  // 3. Fetch data and build facts (all deterministic from here until narration)
  // deno-lint-ignore no-explicit-any
  const facts: Record<string, any> = { topic: intent.topic, location: place.label, lat: place.lat, lon: place.lon };
  const alerts: Alert[] = [];
  let meta: Record<string, unknown>;

  try {
    if (intent.topic === "history") {
      const range = clampHistory(intent.start, intent.end);
      if (!range) {
        return say(
          "Past weather is available from 1940 up to about 5 days ago, for ranges up to one year. Please give a clear date range.",
        );
      }
      const h = await getHistory(place, range.start, range.end);
      const rows = historyRows(h.data);
      const rainiest = rows.reduce((a, b) => (b.rain_mm > a.rain_mm ? b : a), rows[0]);
      facts.history = {
        start: range.start,
        end: range.end,
        total_rain_mm: round1(rows.reduce((s, r) => s + r.rain_mm, 0)),
        avg_temp_max: round1(rows.reduce((s, r) => s + r.temp_max, 0) / rows.length),
        rainiest_day: { date: rainiest.date, rain_mm: rainiest.rain_mm },
      };
      meta = { source: "Open-Meteo archive", fetched_at: h.fetchedAt, from_cache: h.fromCache, stale: h.stale };
      facts.stale = h.stale;
    } else {
      const fc = await getForecast(place);
      const rows = dailyRows(fc.data);
      const i = resolveIndex(intent.date, rows);
      if (i < 0) return say("I can give forecasts for today and the next 6 days only.");

      facts.current = fc.data.current;
      facts.day = rows[i];
      if (intent.topic === "forecast") facts.daily = rows;
      facts.flags = advise(intent.topic, rows, i, hourlyWindow(fc.data, rows[i].date));

      alerts.push(...computeAlerts(intent.topic === "forecast" ? rows : [rows[i]]));
      if (intent.topic === "cyclone" || demo === "cyclone") {
        const c = await cycloneAlerts();
        if (c.bulletin) facts.cyclone = c.bulletin;
        alerts.push(...c.alerts);
      }
      meta = { source: "Open-Meteo", fetched_at: fc.fetchedAt, from_cache: fc.fromCache, stale: fc.stale };
      facts.stale = fc.stale;
    }
  } catch (e) {
    if (String(e).includes("WEATHER_UNAVAILABLE")) {
      return say("Weather data is unavailable right now. Please try again in a few minutes.");
    }
    throw e;
  }
  log.from_cache = meta.from_cache ?? null;
  facts.alerts = alerts;

  // 4. Narrate (LLM call 2), then verify no invented numbers slipped in
  let answer: string;
  try {
    answer = await narrate(facts, q, lang);
    if (!numbersOk(answer, facts)) {
      log.note = "guard: number mismatch, used template";
      answer = templateAnswer(facts);
    }
  } catch (e) {
    log.note = `narrate failed: ${String(e).slice(0, 120)}`;
    answer = templateAnswer(facts);
  }

  // The UI draws its data card from `facts` (raw API values), never from `answer`.
  const { alerts: _dup, ...factsOut } = facts;
  return { answer, facts: factsOut, alerts, meta };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const t0 = Date.now();
  const ip =
    req.headers.get("cf-connecting-ip")?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const log: Log = { ip };
  let status = 200;
  // deno-lint-ignore no-explicit-any
  let body: any;

  try {
    const input = await req.json();
    const q = String(input.q ?? "").trim().slice(0, 500);
    if (!q) return json({ error: "q is required" }, 400);
    log.question = q;

    // Simple per-IP rate limit (protects the Gemini quota). Rejected calls aren't logged.
    const since = new Date(Date.now() - 60_000).toISOString();
    try {
      const { count, error } = await db
        .from("chat_logs")
        .select("id", { count: "exact", head: true })
        .eq("ip", ip)
        .gte("created_at", since);
      if (!error && (count ?? 0) >= RATE_LIMIT_PER_MIN) {
        return json({ error: "Too many requests. Please wait a minute." }, 429);
      }
    } catch (_e) {
      // Proceed if rate check cannot reach DB
    }

    body = await handleChat(q, input.lang, input.demo, log);
  } catch (e) {
    log.error = String(e).slice(0, 300);
    status = 500;
    body = {
      answer: "Something went wrong on our side. Please try again.",
      facts: null,
      alerts: [],
      meta: { error: true },
    };
  }

  log.latency_ms = Date.now() - t0;
  try {
    await db.from("chat_logs").insert(log); // best effort
  } catch (_e) {
    // best effort logging
  }
  return json(body, status);
});

