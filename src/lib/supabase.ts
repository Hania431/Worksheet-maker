import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) return null;
    return { url, key };
  } catch {
    return null;
  }
}

export function getSupabaseClient() {
  const config = getSupabaseConfig();
  if (!config) return null;
  if (!client) client = createClient(config.url, config.key);
  return client;
}

export function isSupabaseConfigured() {
  return getSupabaseConfig() !== null;
}
