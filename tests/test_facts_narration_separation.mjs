// Verifies the fact/narration separation contract:
//   question -> intent -> geocode -> Open-Meteo -> structured facts -> Gemini narration
// 1. The narration system prompt (llm.ts) carries the required no-invented-
//    numbers instruction, word for word.
// 2. `facts` is built entirely from Open-Meteo + deterministic advisory
//    logic BEFORE narrate() is ever called, and narrate()'s return value is
//    never written back into `facts` (chat/index.ts source inspection).
// 3. If narrate() throws, or the numbers guard trips, the response still
//    carries the full structured facts plus a deterministic, facts-only
//    fallback answer (numbersOk / templateAnswer, faithfully re-implemented
//    here the same way the other offline tests in this folder do, since the
//    real modules are Deno TypeScript and the network isn't reachable from
//    this sandbox).
import assert from "node:assert";
import fs from "node:fs";

console.log("Running facts/narration separation tests...");

// ---------------------------------------------------------------------
// 1. Required instruction text is present, verbatim, in the real source.
// ---------------------------------------------------------------------
const llmSrc = fs.readFileSync("supabase/functions/_shared/llm.ts", "utf8");
const REQUIRED_INSTRUCTION =
  "Use ONLY the supplied weather facts. Do not invent, estimate, replace, or contradict numerical weather values. If information is missing, say that it is unavailable.";
assert.ok(
  llmSrc.includes(REQUIRED_INSTRUCTION),
  "narrate()'s system prompt must contain the exact required no-invented-numbers instruction",
);
console.log("✔ Gemini narration instruction contains the required exact wording");

// ---------------------------------------------------------------------
// 2. Source-order check: in chat/index.ts, every `facts.*` assignment for
//    weather data happens before `narrate(facts, ...)` is called, and
//    narrate's result is only ever assigned to `answer`, never merged back
//    into `facts`.
// ---------------------------------------------------------------------
const chatSrc = fs.readFileSync("supabase/functions/chat/index.ts", "utf8");
const narrateCallIdx = chatSrc.indexOf("await narrate(facts");
assert.ok(narrateCallIdx > 0, "chat/index.ts must call narrate(facts, ...)");

const lastFactsAssignIdx = Math.max(
  chatSrc.lastIndexOf("facts.current ="),
  chatSrc.lastIndexOf("facts.day ="),
  chatSrc.lastIndexOf("facts.daily ="),
  chatSrc.lastIndexOf("facts.history ="),
  chatSrc.lastIndexOf("facts.marine ="),
  chatSrc.lastIndexOf("facts.flags ="),
  chatSrc.lastIndexOf("facts.model_comparison ="),
  chatSrc.lastIndexOf("facts.alerts ="),
);
assert.ok(
  lastFactsAssignIdx > 0 && lastFactsAssignIdx < narrateCallIdx,
  "all weather-fact assignments must happen before the Gemini narration call",
);

// narrate()'s return value must only ever be assigned to `answer`, never
// spliced back into `facts` (that would let LLM text masquerade as data).
assert.ok(!/facts(\.\w+)?\s*=\s*await narrate/.test(chatSrc), "narrate()'s output must never be written into facts");
assert.ok(/answer\s*=\s*await narrate/.test(chatSrc), "narrate()'s output must be assigned to `answer` only");
console.log("✔ facts are fully built before narration, and narration output never re-enters facts");

// The response object handed back to the frontend must always include the
// full facts (minus the internal alerts dup), regardless of narration
// outcome.
assert.ok(
  chatSrc.includes("return { answer, facts: factsOut, alerts, meta }"),
  "the chat response must always carry the real structured facts alongside the narrated answer",
);
console.log("✔ response always carries structured facts alongside the narrated answer");

// ---------------------------------------------------------------------
// 3. Deterministic fallback behaves correctly when narration is unusable
//    (Gemini throws, or invents a number the guard catches).
// ---------------------------------------------------------------------
const COMMON = new Set([0, 1, 2, 3, 4, 5, 6, 7, 12, 24, 48]);
function numbersOk(answer, facts) {
  const allowed = new Set(COMMON);
  for (const m of JSON.stringify(facts).match(/-?\d+(?:\.\d+)?/g) ?? []) {
    const n = Number(m);
    for (const v of [n, Math.abs(n), Math.round(n), Math.round(n * 10) / 10]) allowed.add(v);
  }
  for (const m of answer.match(/\d+(?:\.\d+)?/g) ?? []) {
    if (!allowed.has(Number(m))) return false;
  }
  return true;
}
function templateAnswer(f) {
  const parts = [];
  if (f.day) {
    parts.push(
      `${f.location} on ${f.day.date}: ${f.day.temp_min} to ${f.day.temp_max} C, rain ${f.day.rain_mm} mm (${f.day.rain_prob ?? "unknown"}% chance), wind up to ${f.day.wind_max_kmh} km/h.`,
    );
  }
  return parts.join(" ") || "Weather data is unavailable right now.";
}

// Simulates chat/index.ts's step 4: facts are already built from real
// Open-Meteo data; only the narration step is allowed to fail.
async function narrateWithFallback(facts, narrateImpl) {
  let answer = templateAnswer(facts);
  try {
    const candidate = await narrateImpl(facts);
    answer = numbersOk(candidate, facts) ? candidate : templateAnswer(facts);
  } catch (_e) {
    answer = templateAnswer(facts);
  }
  return { answer, facts };
}

const realFacts = {
  location: "Kolkata",
  day: { date: "2026-09-28", temp_min: 26, temp_max: 33, rain_mm: 4.2, rain_prob: 55, wind_max_kmh: 18 },
};

// 3a. Gemini throws (timeout, quota, network) -> facts survive, answer is
// the deterministic template built only from real numbers.
{
  const { answer, facts } = await narrateWithFallback(realFacts, async () => {
    throw new Error("Gemini unavailable");
  });
  assert.strictEqual(facts, realFacts, "facts must be returned unchanged when narration throws");
  assert.ok(answer.includes("33") && answer.includes("26"), "fallback answer must use the real fetched numbers");
  console.log("✔ narration failure after successful fetch still returns facts + deterministic fallback");
}

// 3b. Gemini responds but hallucinates a number not present in facts ->
// guard rejects it, falls back to the template (never surfaces the
// invented number to the user).
{
  const { answer, facts } = await narrateWithFallback(realFacts, async () => "Expect a scorching 51 C in Kolkata!");
  assert.strictEqual(facts, realFacts);
  assert.ok(!answer.includes("51"), "an invented number must never reach the user");
  assert.ok(answer.includes("33"), "fallback must fall back to the real facts-derived template");
  console.log("✔ guard rejects an invented number and falls back to the facts-only template");
}

// 3c. Gemini behaves and only uses numbers present in facts -> its text is
// used as-is.
{
  const { answer } = await narrateWithFallback(realFacts, async () => "Kolkata will see 33 C highs with light rain.");
  assert.ok(answer.includes("33"), "a well-behaved narration using only real numbers should be kept");
  console.log("✔ well-behaved narration (numbers grounded in facts) passes through");
}

console.log("ALL FACTS/NARRATION SEPARATION TESTS PASSED SUCCESSFULLY! 🎉");
