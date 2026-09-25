import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "http://localhost:54321";
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "dummy-key";

export const db = createClient(
  supabaseUrl,
  supabaseKey,
  { auth: { persistSession: false } },
);

export interface CacheHit<T> {
  value: T;
  fetchedAt: string;
  fresh: boolean;
}

export async function cacheGet<T>(key: string, maxAgeMs: number): Promise<CacheHit<T> | null> {
  try {
    const { data, error } = await db.from("api_cache").select("value, fetched_at").eq("key", key).maybeSingle();
    if (error || !data) return null;
    const age = Date.now() - new Date(data.fetched_at).getTime();
    return { value: data.value as T, fetchedAt: data.fetched_at, fresh: age <= maxAgeMs };
  } catch (_e) {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  try {
    await db.from("api_cache").upsert({ key, value, fetched_at: new Date().toISOString() });
  } catch (_e) {
    // Cache write is best effort; do not break caller if DB is down
  }
}

