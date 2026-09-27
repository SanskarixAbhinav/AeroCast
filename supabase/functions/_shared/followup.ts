// Handles multi-turn follow-up questions ("What about the day after
// tomorrow?", "Will it rain?") that omit the place or topic because the
// person already said it earlier in the conversation.
//
// The chat function itself is stateless (no server-side session) - the
// caller (chat/index.ts) is expected to pass back whatever `context` the
// *previous* response's `meta.context` contained, round-tripped through the
// client. This module only does the pure merge: never network calls, never
// guesses at intent the current question doesn't support.
import type { Intent } from "./llm.ts";

export interface ChatContext {
  location: string | null;
  topic: string | null;
}

// `meta.context.location` is the full geocoded label ("Kolkata, West
// Bengal, India"), but the geocoder wants just the place name - take the
// first comma-separated segment.
function primaryName(label: string | null): string | null {
  if (!label) return null;
  const first = label.split(",")[0]?.trim();
  return first || null;
}

// Only fills in what THIS question left unspecified. If the question named
// its own place or was clearly about a topic, that always wins - context is
// exclusively a fallback for what's missing, never an override.
export function resolveFollowUp(intent: Intent, context: ChatContext | null | undefined): Intent {
  if (!context) return intent;

  const location = intent.location ?? primaryName(context.location);

  // topic === "other" means this question, on its own, gave no signal at
  // all about what kind of weather info is wanted (e.g. "What about the day
  // after tomorrow?") - inherit the previous turn's topic in that case only.
  // If the previous turn was itself unresolved ("other"), there's nothing
  // useful to inherit.
  const topic = intent.topic === "other" && context.topic && context.topic !== "other"
    ? context.topic
    : intent.topic;

  return { ...intent, location, topic: topic as Intent["topic"] };
}
