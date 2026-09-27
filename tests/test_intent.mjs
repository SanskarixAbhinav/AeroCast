// Unit tests for location/intent extraction (supabase/functions/_shared/llm.ts).
//
// The real parseIntent() calls Gemini (Deno-only, needs GEMINI_API_KEY), so it
// can't run directly under Node. What CAN be tested here without a network or
// Deno is the same thing that matters most for this bug class: the offline
// fallbackParseIntent() heuristic (no hardcoded city list — see the
// location-scalability cases below), and the sanitizeLocation() safety net
// that both extraction paths run through before anything reaches the
// geocoder. This is a faithful re-implementation (kept in sync with
// llm.ts), the same pattern already used by tests/test_units.mjs for the
// other Deno modules.
import assert from "node:assert";

function sanitizeLocation(raw) {
  if (!raw) return null;
  const cleaned = raw
    .replace(/["'“”‘’]/g, "")
    .replace(/[.?!,;:]+$/g, "")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned) return null;
  if (cleaned.split(" ").length > 4) return null;
  if (/\d/.test(cleaned)) return null;
  return cleaned;
}

function fallbackParseIntent(q) {
  const qLower = q.toLowerCase();

  let language = "en";
  if (/[\u0900-\u097F]/.test(q)) language = "hi";
  else if (/[\u0980-\u09FF]/.test(q)) language = "bn";
  else if (/[\u0B80-\u0BFF]/.test(q)) language = "ta";
  else if (/[\u0C00-\u0C7F]/.test(q)) language = "te";

  let date = "today";
  const weekdayMatch = qLower.match(/\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (/day after tomorrow/i.test(qLower)) date = "day_after";
  else if (weekdayMatch) date = `next_${weekdayMatch[1]}`;
  else if (/\bthis\s+weekend\b|\bweekend\b/i.test(qLower)) date = "this_weekend";
  else if (/tomorrow|kal/i.test(qLower)) date = "tomorrow";
  const isoMatch = q.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) date = isoMatch[1];

  let time_range = null;
  if (/\bmorning\b/i.test(qLower)) time_range = "morning";
  else if (/\bafternoon\b/i.test(qLower)) time_range = "afternoon";
  else if (/\bevening\b/i.test(qLower)) time_range = "evening";
  else if (/\bnight\b/i.test(qLower)) time_range = "night";

  let topic = "other";
  if (/marine|sea|ocean|wave|swell|boat|coastal|fishing|fisher|sail|harbour|harbor|fisherm/i.test(qLower)) topic = "marine";
  else if (/spray|pesticide|fungicide|fertilizer|insecticide/i.test(qLower)) topic = "spray";
  else if (/irrigat|water the crop|watering/i.test(qLower)) topic = "irrigation";
  else if (/harvest|cutting|reap/i.test(qLower)) topic = "harvest";
  else if (/cyclone|storm|hurricane|typhoon/i.test(qLower)) topic = "cyclone";
  else if (/rain|precipitation|shower|drizzle|barish/i.test(qLower)) topic = "rain";
  else if (/temp|temperature|hot|cold|heat|warm/i.test(qLower)) topic = "temperature";
  else if (/wind|gust|breeze/i.test(qLower)) topic = "wind";
  else if (/last year|last month|history|past rain/i.test(qLower)) topic = "history";
  else if (/forecast|week|7-day|weather|mausam/i.test(qLower)) topic = "forecast";

  let location = null;
  const inMatch = q.match(/\b(?:in|at|for|near|around)\b\s+([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*)/);
  if (inMatch && inMatch[1].trim()) {
    location = inMatch[1].trim();
  } else {
    // No hardcoded city list: any standalone Title-Case run is a candidate,
    // minus a small fixed set of English question-starter words. The real
    // geocoder is what validates it.
    const STOPWORDS = new Set([
      "will", "is", "are", "do", "does", "did", "can", "could", "should",
      "what", "when", "where", "how", "any", "please",
    ]);
    const runs = (q.match(/\b[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*\b/g) ?? [])
      .map((r) => r.trim())
      .filter((r) => !r.split(/\s+/).every((w) => STOPWORDS.has(w.toLowerCase())));
    if (runs.length) location = runs[runs.length - 1];
  }

  if (location && topic === "other") topic = "forecast";

  return { location, date, time_range, topic, language, start: null, end: null };
}

console.log("Running intent/location extraction tests...");

// The two bug reports from the issue: location must be ONLY the city, never
// the whole clause, and never fed to the geocoder as anything else.
{
  const i = fallbackParseIntent("Will it rain tomorrow in Kolkata?");
  assert.strictEqual(i.location, "Kolkata");
  assert.strictEqual(i.date, "tomorrow");
  assert.strictEqual(i.topic, "rain");
}
{
  const i = fallbackParseIntent("Is it safe for coastal fishing in Mumbai tomorrow?");
  assert.strictEqual(i.location, "Mumbai");
  assert.strictEqual(i.date, "tomorrow");
  assert.strictEqual(i.topic, "marine"); // request_type = marine advisory
}
console.log("✔ Bug-report examples resolve to clean location/date/topic");

// A few more phrasings that must not regress: location never absorbs
// surrounding date/activity words regardless of sentence shape.
const cases = [
  ["What's the weather like in Kolkata right now?", "Kolkata", "forecast"],
  ["Kolkata weather tomorrow", "Kolkata", "forecast"],
  ["Any advisory for coastal fishing near Mumbai tomorrow?", "Mumbai", "marine"],
  ["irrigation advice for my farm in Pune", "Pune", "irrigation"],
];
for (const [q, expectLoc, expectTopicMaybe] of cases) {
  const i = fallbackParseIntent(q);
  assert.strictEqual(i.location, expectLoc, `location for "${q}"`);
  if (expectTopicMaybe) assert.strictEqual(i.topic, expectTopicMaybe, `topic for "${q}"`);
}
console.log("✔ Additional phrasings keep location separated from date/topic");

// Location-scalability fix: none of these towns are in any hardcoded list —
// the extractor must isolate the right word purely from sentence shape, and
// leave validating it as a real place to the geocoder (location.ts).
const scalabilityCases = [
  ["Will it rain tomorrow in Darjeeling?", "Darjeeling"],
  ["Siliguri weather tomorrow", "Siliguri"],
  ["Durgapur rain forecast", "Durgapur"],
  ["Rajkot temperature today", "Rajkot"],
  ["Is it safe for coastal fishing near Mysuru tomorrow?", "Mysuru"],
  ["Jamshedpur harvest advice", "Jamshedpur"],
  ["Agartala cyclone alert", "Agartala"],
  ["7-day forecast for Dehradun", "Dehradun"],
  ["Kochi marine advisory tomorrow", "Kochi"],
  ["Is it safe to spray pesticides in Jaipur tomorrow?", "Jaipur"],
  ["Guwahati irrigation advice", "Guwahati"],
  ["Kolkata weather tomorrow", "Kolkata"],
];
for (const [q, expectLoc] of scalabilityCases) {
  const i = fallbackParseIntent(q);
  assert.strictEqual(i.location, expectLoc, `location for "${q}"`);
}
console.log("✔ Unlisted Indian towns resolve without any hardcoded city list");

// New NLU cases: weekday/weekend date hints, time-of-day, and the
// no-location/no-topic follow-up shapes ("What about the day after
// tomorrow?", "Will it rain?") that resolveFollowUp() (followup.ts) fills
// in from conversation context.
{
  const i = fallbackParseIntent("How hot will it be next Monday in Jaipur?");
  assert.strictEqual(i.location, "Jaipur");
  assert.strictEqual(i.date, "next_monday");
  assert.strictEqual(i.topic, "temperature");
}
{
  const i = fallbackParseIntent("Will it rain this weekend in Mumbai?");
  assert.strictEqual(i.location, "Mumbai");
  assert.strictEqual(i.date, "this_weekend");
  assert.strictEqual(i.topic, "rain");
}
{
  const i = fallbackParseIntent("What will the weather be like in Darjeeling tomorrow?");
  assert.strictEqual(i.location, "Darjeeling");
  assert.strictEqual(i.date, "tomorrow");
}
{
  // A bare follow-up fragment: no place, no topic keyword at all.
  const i = fallbackParseIntent("What about the day after tomorrow?");
  assert.strictEqual(i.location, null);
  assert.strictEqual(i.date, "day_after");
  assert.strictEqual(i.topic, "other");
}
{
  // A bare follow-up with a topic but no place.
  const i = fallbackParseIntent("Will it rain?");
  assert.strictEqual(i.location, null);
  assert.strictEqual(i.date, "today");
  assert.strictEqual(i.topic, "rain");
}
{
  const i = fallbackParseIntent("Will it rain tomorrow morning in Kolkata?");
  assert.strictEqual(i.location, "Kolkata");
  assert.strictEqual(i.date, "tomorrow");
  assert.strictEqual(i.time_range, "morning");
}
{
  const i = fallbackParseIntent("What's the temperature this evening in Pune?");
  assert.strictEqual(i.location, "Pune");
  assert.strictEqual(i.time_range, "evening");
}
{
  const i = fallbackParseIntent("Is it cold at night in Shimla?");
  assert.strictEqual(i.location, "Shimla");
  assert.strictEqual(i.time_range, "night");
}
{
  // No time-of-day word at all -> stays null, never guessed.
  const i = fallbackParseIntent("Will it rain tomorrow in Kolkata?");
  assert.strictEqual(i.time_range, null);
}
console.log("✔ Weekday/weekend dates, time-of-day, and bare follow-up fragments resolve correctly");

// resolveFollowUp() (supabase/functions/_shared/followup.ts): fills in only
// what the CURRENT question left unspecified, from the previous turn's
// context - never overrides anything the question itself stated.
function primaryName(label) {
  if (!label) return null;
  const first = label.split(",")[0]?.trim();
  return first || null;
}
function resolveFollowUp(intent, context) {
  if (!context) return intent;
  const location = intent.location ?? primaryName(context.location);
  const topic = intent.topic === "other" && context.topic && context.topic !== "other"
    ? context.topic
    : intent.topic;
  return { ...intent, location, topic };
}

{
  // "What about the day after tomorrow?" after "...in Kolkata" - retains Kolkata.
  const prev = { location: "Kolkata, West Bengal, India", topic: "forecast" };
  const i = fallbackParseIntent("What about the day after tomorrow?");
  const merged = resolveFollowUp(i, prev);
  assert.strictEqual(merged.location, "Kolkata");
  assert.strictEqual(merged.topic, "forecast");
  assert.strictEqual(merged.date, "day_after");
}
{
  // "Will it rain?" after "...in Kolkata" - retains Kolkata; keeps its own topic.
  const prev = { location: "Kolkata, West Bengal, India", topic: "forecast" };
  const i = fallbackParseIntent("Will it rain?");
  const merged = resolveFollowUp(i, prev);
  assert.strictEqual(merged.location, "Kolkata");
  assert.strictEqual(merged.topic, "rain");
}
{
  // A question that names its own place is never overridden by context.
  const prev = { location: "Kolkata, West Bengal, India", topic: "forecast" };
  const i = fallbackParseIntent("What about Mumbai?");
  const merged = resolveFollowUp(i, prev);
  assert.strictEqual(merged.location, "Mumbai");
}
{
  // No context at all -> unchanged.
  const i = fallbackParseIntent("Will it rain?");
  const merged = resolveFollowUp(i, null);
  assert.strictEqual(merged.location, null);
  assert.strictEqual(merged.topic, "rain");
}
console.log("✔ Follow-up context merge (resolveFollowUp) passed");

// sanitizeLocation: the safety net every extracted location passes through
// before reaching the geocoder.
assert.strictEqual(sanitizeLocation("Kolkata"), "Kolkata");
assert.strictEqual(sanitizeLocation('"Mumbai."'), "Mumbai");
assert.strictEqual(sanitizeLocation("New Delhi"), "New Delhi");
// Multi-word runaway captures (e.g. a clause a model or regex accidentally
// swallowed) must never reach the geocoder as-is.
assert.strictEqual(sanitizeLocation("coastal fishing safety zone report"), null);
assert.strictEqual(sanitizeLocation("Sector 5 2026"), null); // contains digits
assert.strictEqual(sanitizeLocation(null), null);
assert.strictEqual(sanitizeLocation(""), null);
console.log("✔ sanitizeLocation rejects implausible geocoder inputs");

console.log("ALL INTENT/LOCATION TESTS PASSED SUCCESSFULLY! 🎉");
